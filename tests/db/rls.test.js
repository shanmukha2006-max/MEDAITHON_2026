// Database security tests: run the real migration's rules on real PostgreSQL as different users.
// Skipped unless BG_TEST_DB is set, e.g. BG_TEST_DB=postgres://postgres@/bg_test?host=/tmp&port=54322
// The test database must have supabase/tests/auth_shim.sql and the migration applied.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BG_TEST_DB;
const skip = !URL && 'set BG_TEST_DB to run database security tests';
let pool;
const U = {};

// Run fn inside a transaction as a given user, exactly as Supabase does per request.
async function as(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (user === 'anon') await c.query("set local role anon");
    else {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[user], role: 'authenticated' })]);
    }
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const denied = async (p, re = /./) => { await assert.rejects(p, (e) => re.test(e.message) || re.test(e.code)); };
const rows = async (user, sql, params) => (await as(user, (c) => c.query(sql, params))).rows;

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: URL });
  const c = await pool.connect();
  await c.query('truncate auth.users cascade');
  await c.query('truncate public.hospitals, public.audit_log restart identity cascade');
  const mk = async (key, email, meta) => {
    U[key] = (await c.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta])).rows[0].id;
  };
  await mk('patientA', 'a@test.local', { role: 'patient', full_name: 'Synthetic Patient A' });
  await mk('patientB', 'b@test.local', { role: 'patient', full_name: 'Synthetic Patient B' });
  await mk('staff1', 's1@test.local', { role: 'hospital_staff', full_name: 'Staff One' });
  await mk('staff2', 's2@test.local', { role: 'hospital_staff', full_name: 'Staff Two' });
  await mk('sneaky', 'x@test.local', { role: 'authority', full_name: 'Self-declared authority' });
  await mk('authority', 'auth@test.local', { role: 'patient', full_name: 'Demo Authority' });
  // Authority accounts are created by an administrator (service role), never self-registered:
  await c.query("select set_config('breatheguard.internal','on',false)");
  await c.query("update public.profiles set role = 'authority' where id = $1", [U.authority]);
  await c.query("select set_config('breatheguard.internal','off',false)");
  c.release();
});
after(async () => { if (pool) await pool.end(); });

test('self-registration cannot create an authority account', { skip }, async () => {
  const [p] = await rows('sneaky', 'select role from public.profiles where id = auth.uid()');
  assert.equal(p.role, 'patient');
});

test('users cannot change their own role', { skip }, async () => {
  await denied(as('patientA', (c) => c.query("update public.profiles set role = 'authority' where id = auth.uid()")), /authority can change roles/);
  await as('patientA', (c) => c.query("update public.profiles set full_name = 'Renamed' where id = auth.uid()")); // allowed
});

test('anonymous requests see nothing', { skip }, async () => {
  await denied(as('anon', (c) => c.query('select * from public.monitoring_sessions')), /permission denied/);
});

test('hospital applications start pending and cannot be self-approved', { skip }, async () => {
  const [h] = await rows('staff1', "insert into public.hospitals (name, city, registration_no, status) values ('Synthetic H1', 'Testville', 'DEMO-1', 'approved') returning id, status");
  U.h1 = h.id;
  assert.equal(h.status, 'pending', 'status forced to pending');
  const [p] = await rows('staff1', 'select hospital_id from public.profiles where id = auth.uid()');
  assert.equal(p.hospital_id, U.h1, 'creator linked to the hospital');
  await denied(as('staff1', (c) => c.query("update public.hospitals set status = 'approved' where id = $1", [U.h1])), /only be changed by the healthcare authority/);
  await denied(as('staff1', (c) => c.query("select public.decide_hospital($1, 'approved', 'I approve myself today')", [U.h1])), /Only the healthcare authority/);
  await denied(as('patientA', (c) => c.query("insert into public.hospitals (name, city, registration_no) values ('Fake', 'X', 'DEMO-9')")), /Only hospital staff/);
  const [h2] = await rows('staff2', "insert into public.hospitals (name, city, registration_no) values ('Synthetic H2', 'Testville', 'DEMO-2') returning id");
  U.h2 = h2.id;
});

test('authority decisions need a reason, follow allowed transitions, and are audited', { skip }, async () => {
  await denied(as('authority', (c) => c.query("select public.decide_hospital($1, 'approved', 'ok')", [U.h1])), /reason of at least 10/);
  await as('authority', (c) => c.query("select public.decide_hospital($1, 'approved', 'Demo documents checked.')", [U.h1]));
  await denied(as('authority', (c) => c.query("select public.decide_hospital($1, 'pending', 'Going backwards here')", [U.h1])), /Cannot change status/);
  const a = await rows('authority', "select action, detail from public.audit_log where target_id = $1 and action = 'hospital.decision'", [U.h1]);
  assert.equal(a.length, 1);
  assert.equal(a[0].detail.reason, 'Demo documents checked.');
});

test('doctors are verified separately from their hospital', { skip }, async () => {
  await denied(as('staff2', (c) => c.query("insert into public.doctors (full_name, specialty, license_no) values ('Dr Two', 'Pulmonology', 'DEMO-D-2')")), /must be approved/);
  const [d] = await rows('staff1', "insert into public.doctors (full_name, specialty, license_no, status) values ('Dr One', 'Pulmonology', 'DEMO-D-1', 'approved') returning id, status, hospital_id");
  U.d1 = d.id;
  assert.equal(d.status, 'pending', 'hospital approval does not verify the doctor');
  assert.equal(d.hospital_id, U.h1);
  assert.equal((await rows('patientA', 'select id from public.doctors where id = $1', [U.d1])).length, 0, 'unverified doctor hidden from patients');
  await as('authority', (c) => c.query("select public.decide_doctor($1, 'approved', 'Licence checked in demo registry')", [U.d1]));
  assert.equal((await rows('patientA', 'select id from public.doctors where id = $1', [U.d1])).length, 1, 'verified doctor visible');
});

test('patient session: observations are idempotent, alerts only on outcome changes', { skip }, async () => {
  const [s] = await rows('patientA', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'care', '{chest,acoustic,motion}', 'irregular', 1) returning id, label, is_synthetic");
  U.sA = s.id;
  assert.equal(s.label, 'SYNTHETIC DATA — NOT FOR CLINICAL USE');
  const ins = "insert into public.observations (session_id, seq, t_start, chest) values ($1, $2, $3, '{0.1,0.2}') on conflict do nothing";
  for (const seq of [0, 1, 2, 1, 2]) await as('patientA', (c) => c.query(ins, [U.sA, seq, seq])); // duplicates retried
  assert.equal((await rows('patientA', 'select seq from public.observations where session_id = $1', [U.sA])).length, 3, 'duplicate events stored once');
  await denied(as('patientA', (c) => c.query('update public.observations set chest = null where session_id = $1', [U.sA])), /permission denied/);
  const ar = "insert into public.analysis_results (session_id, window_end, outcome, reason, quality) values ($1, $2, $3, $4, 0.9) on conflict do nothing";
  const seqOut = [[30, 'within'], [40, 'within'], [50, 'concerning'], [60, 'concerning'], [70, 'insufficient'], [80, 'within'], [80, 'within']];
  for (const [w, o] of seqOut) await as('patientA', (c) => c.query(ar, [U.sA, w, o, `synthetic window ${w}`]));
  const alerts = await rows('patientA', 'select category, window_end, label from public.alerts where session_id = $1 order by window_end', [U.sA]);
  assert.deepEqual(alerts.map((a) => `${a.category}@${a.window_end}`), ['concerning@50', 'insufficient@70', 'within@80']);
  assert.ok(alerts.every((a) => a.label.includes('NOT A CLINICAL WARNING')));
  await denied(as('patientA', (c) => c.query("insert into public.alerts (session_id, patient_id, window_end, category, explanation) values ($1, auth.uid(), 999, 'within', 'forged')", [U.sA])), /permission denied/);
});

test('other patients cannot read or write someone else’s session', { skip }, async () => {
  for (const t of ['monitoring_sessions where id', 'observations where session_id', 'analysis_results where session_id', 'alerts where session_id']) {
    assert.equal((await rows('patientB', `select 1 from public.${t} = $1`, [U.sA])).length, 0, t);
  }
  await denied(as('patientB', (c) => c.query("insert into public.observations (session_id, seq, t_start) values ($1, 50, 50)", [U.sA])), /row-level security/);
  await denied(as('patientB', (c) => c.query('select public.session_report($1)', [U.sA])), /not permitted/);
});

test('hospital access requires consent AND an approved hospital; revoking stops it', { skip }, async () => {
  const count = async (u) => (await rows(u, 'select 1 from public.observations where session_id = $1', [U.sA])).length;
  assert.equal(await count('staff1'), 0, 'no consent yet');
  await as('patientA', (c) => c.query("insert into public.consents (patient_id, hospital_id, scopes) values (auth.uid(), $1, '{reports,live}')", [U.h1]));
  await as('patientA', (c) => c.query("insert into public.consents (patient_id, hospital_id, scopes) values (auth.uid(), $1, '{reports,live}')", [U.h2]));
  assert.equal(await count('staff1'), 3, 'approved hospital with consent can read');
  assert.equal(await count('staff2'), 0, 'consent to an unapproved hospital grants nothing');
  assert.equal((await rows('staff1', 'select 1 from public.alerts where session_id = $1', [U.sA])).length, 3);
  const rep = (await rows('staff1', 'select public.session_report($1) as r', [U.sA]))[0].r;
  assert.equal(rep.label, 'SYNTHETIC DATA — NOT FOR CLINICAL USE');
  assert.equal(rep.analysis.length, 6);
  // revoke
  await as('patientA', (c) => c.query("update public.consents set active = false where hospital_id = $1", [U.h1]));
  assert.equal(await count('staff1'), 0, 'revoked consent stops reads immediately');
  await denied(as('staff1', (c) => c.query('select public.session_report($1)', [U.sA])), /not permitted/);
  const audit = await rows('patientA', "select action from public.audit_log where action like 'consent.%' and actor_id = auth.uid()");
  assert.ok(audit.length >= 3, 'consent changes audited');
  await denied(as('staff1', (c) => c.query("insert into public.consents (patient_id, hospital_id, scopes) values ($1, $2, '{reports}')", [U.patientA, U.h1])), /row-level security|violates/);
});

test('suspending a hospital removes its access even with consent', { skip }, async () => {
  await as('patientA', (c) => c.query("update public.consents set active = true, scopes = '{reports}' where hospital_id = $1", [U.h1]));
  assert.equal((await rows('staff1', 'select 1 from public.monitoring_sessions where id = $1', [U.sA])).length, 1);
  await as('authority', (c) => c.query("select public.decide_hospital($1, 'suspended', 'Demo investigation opened.')", [U.h1]));
  assert.equal((await rows('staff1', 'select 1 from public.monitoring_sessions where id = $1', [U.sA])).length, 0);
  await as('authority', (c) => c.query("select public.decide_hospital($1, 'approved', 'Investigation closed, reinstated.')", [U.h1]));
});

test('alert acknowledgement only by permitted users', { skip }, async () => {
  const [a] = await rows('staff1', 'select id from public.alerts where session_id = $1 limit 1', [U.sA]);
  const [ack] = await rows('staff1', 'select (public.acknowledge_alert($1)).acknowledged_by as by', [a.id]);
  assert.equal(ack.by, U.staff1);
  await denied(as('staff2', (c) => c.query('select public.acknowledge_alert($1)', [a.id])), /not permitted/);
});

test('stopped sessions accept no further data', { skip }, async () => {
  await as('patientA', (c) => c.query("update public.monitoring_sessions set status = 'stopped', stopped_at = now() where id = $1", [U.sA]));
  await denied(as('patientA', (c) => c.query("insert into public.observations (session_id, seq, t_start) values ($1, 99, 99)", [U.sA])), /row-level security/);
});

test('appointments: only verified doctors; transitions enforced server-side', { skip }, async () => {
  const [ap] = await rows('patientA', "insert into public.appointments (patient_id, doctor_id, hospital_id, requested_for) values (auth.uid(), $1, $2, now() + interval '3 days') returning id, status", [U.d1, U.h1]);
  assert.equal(ap.status, 'requested');
  await denied(as('patientA', (c) => c.query("select public.set_appointment_status($1, 'confirmed')", [ap.id])), /Cannot move/);
  await as('staff1', (c) => c.query("select public.set_appointment_status($1, 'confirmed')", [ap.id]));
  await denied(as('staff2', (c) => c.query("select public.set_appointment_status($1, 'completed')", [ap.id])), /Not permitted/);
  await as('patientA', (c) => c.query("select public.set_appointment_status($1, 'cancelled')", [ap.id]));
});
