// Part 8 database rules (migration 0003), run as real users on real PostgreSQL.
// Skipped unless BG_TEST_DB is set (database with auth_shim + migrations 0001–0003).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BG_TEST_DB;
const skip = !URL && 'set BG_TEST_DB to run Part 8 database tests';
let pool; const U = {};
async function as(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[user], role: 'authenticated' })]);
    const r = await fn(c); await c.query('commit'); return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const q = async (u, sql, p) => (await as(u, (c) => c.query(sql, p))).rows;
const denied = (p, re = /./) => assert.rejects(p, (e) => re.test(e.message) || re.test(e.code));

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: URL });
  const c = await pool.connect();
  await c.query('truncate auth.users cascade'); await c.query('truncate public.hospitals, public.audit_log restart identity cascade');
  for (const [k, role] of [['pa', 'patient'], ['pb', 'patient'], ['staff', 'hospital_staff'], ['d1', 'doctor'], ['d2', 'doctor'], ['au', 'patient']]) {
    U[k] = (await c.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${k}@p8.test`, { role, full_name: `Synthetic ${k}` }])).rows[0].id;
  }
  await c.query("select public.bootstrap_authority('au@p8.test')");
  c.release();
  // real workflow: application -> approval -> doctors -> account links -> separate verification
  U.h = (await q('staff', "insert into public.hospitals (name, city, registration_no) values ('P8 Hospital', 'X', 'DEMO-P8') returning id"))[0].id;
  await q('au', "select public.decide_hospital($1, 'approved', 'Demo documents checked.')", [U.h]);
  for (const [k, lic] of [['D1', 'DEMO-D-81'], ['D2', 'DEMO-D-82'], ['D3', 'DEMO-D-83']]) {
    U[k] = (await q('staff', "insert into public.doctors (full_name, specialty, license_no) values ($1, 'Pulmonology', $2) returning id", [`Dr ${k}`, lic]))[0].id;
  }
  await q('staff', 'select public.link_doctor_account($1, $2)', [U.D1, 'd1@p8.test']);
  await q('staff', 'select public.link_doctor_account($1, $2)', [U.D2, 'd2@p8.test']);
  for (const k of ['D1', 'D2', 'D3']) await q('au', "select public.decide_doctor($1, 'approved', 'Licence checked in demo registry.')", [U[k]]);
  U.s = (await q('pa', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'care', '{chest,acoustic,motion}', 'irregular', 1) returning id"))[0].id;
});
after(async () => { if (pool) await pool.end(); });

test('connection request reaches only the intended doctor', { skip }, async () => {
  const [r] = await q('pa', "insert into public.care_requests (patient_id, doctor_id, message, status) values (auth.uid(), $1, 'Please review my simulated sessions', 'accepted') returning id, status", [U.D1]);
  U.r = r.id;
  assert.equal(r.status, 'pending', 'status forced to pending');
  assert.equal((await q('d1', 'select id from public.care_requests')).length, 1, 'intended doctor sees it');
  assert.equal((await q('d2', 'select id from public.care_requests')).length, 0, 'another doctor at the same hospital does not');
  assert.equal((await q('staff', 'select id from public.care_requests')).length, 0, 'hospital admin does not');
  assert.equal((await q('pb', 'select id from public.care_requests')).length, 0, 'another patient does not');
  const n = await q('d1', "select title from public.notifications where kind = 'connection'");
  assert.equal(n.length, 1);
});

test('duplicate, unverified-doctor and non-patient requests are refused', { skip }, async () => {
  await denied(q('pa', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [U.D1]), /duplicate|uq_care_request_open/);
  await denied(q('pa', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [U.D3]), /not currently verified/);
  await denied(q('d2', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [U.D1]), /Only patients/);
});

test('before acceptance the doctor has no access and cannot message', { skip }, async () => {
  assert.equal((await q('d1', 'select id from public.monitoring_sessions where id = $1', [U.s])).length, 0);
  await denied(q('pa', 'insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), $2)', [U.r, 'hello']), /accepted connection/);
});

test('only the intended doctor can accept; acceptance grants access and notifies the patient', { skip }, async () => {
  await denied(q('d2', 'select public.respond_care_request($1, true, null)', [U.r]), /not addressed to you/);
  await denied(q('pa', 'select public.respond_care_request($1, true, null)', [U.r]), /not addressed to you/);
  await q('d1', "select public.respond_care_request($1, true, 'Happy to help')", [U.r]);
  await denied(q('d1', 'select public.respond_care_request($1, false, null)', [U.r]), /already been accepted/);
  assert.equal((await q('d1', 'select id from public.monitoring_sessions where id = $1', [U.s])).length, 1, 'connected doctor can read the session');
  assert.equal((await q('d2', 'select id from public.monitoring_sessions where id = $1', [U.s])).length, 0, 'other doctor still cannot');
  assert.ok((await q('pa', "select title from public.notifications where kind = 'connection'")).some((x) => x.title === 'Connection accepted'));
});

test('messages: only between the two parties; sender and recipient set by the server', { skip }, async () => {
  const [m] = await q('pa', "insert into public.messages (request_id, sender_id, recipient_id, body, client_id) values ($1, auth.uid(), $2, '  Is my result normal?  ', 'c-1') returning sender_id, recipient_id, body", [U.r, U.pb]);
  assert.equal(m.recipient_id, U.d1, 'forged recipient replaced with the doctor');
  assert.equal(m.body, 'Is my result normal?');
  await denied(q('pa', "insert into public.messages (request_id, sender_id, recipient_id, body, client_id) values ($1, auth.uid(), $2, 'retry', 'c-1')", [U.r, U.d1]), /duplicate|messages_sender_id_client_id_key/);
  await denied(q('pb', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'intrude')", [U.r]), /not part of this conversation/);
  await denied(q('d2', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'intrude')", [U.r]), /not part of this conversation/);
  assert.equal((await q('pb', 'select id from public.messages')).length, 0);
  assert.equal((await q('staff', 'select id from public.messages')).length, 0, 'hospital admin cannot read the conversation');
  await q('d1', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'It is a simulated result; let us discuss.')", [U.r]);
  assert.equal((await q('d1', 'select public.mark_messages_read($1) as n', [U.r]))[0].n, 1, 'doctor marks the patient’s message read');
  assert.equal((await q('pa', 'select count(*)::int as n from public.messages where recipient_id = auth.uid() and read_at is null'))[0].n, 1, 'patient still has one unread');
  await denied(q('pa', 'update public.messages set read_at = now()'), /permission denied/);
  assert.ok((await q('d1', "select 1 from public.notifications where kind = 'message'")).length >= 1);
});

test('prescriptions: only the connected doctor can enter them; patient reads, cannot write', { skip }, async () => {
  const [rx] = await q('d1', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text, instructions) values ($1, $2, $1, 'Salbutamol inhaler', '2 puffs when breathless', 'Demo record') returning id, prescribed_by, doctor_id, is_demo_record", [U.pa, U.D3]);
  U.rx = rx.id;
  assert.equal(rx.prescribed_by, U.d1); assert.equal(rx.doctor_id, U.D1, 'doctor id set by the server, not the request'); assert.equal(rx.is_demo_record, true);
  await denied(q('pa', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text) values (auth.uid(), $1, auth.uid(), 'Fake', 'x')", [U.D1]), /Only a verified doctor connected/);
  await denied(q('d2', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text) values ($1, $2, auth.uid(), 'X med', '1 tab')", [U.pa, U.D2]), /Only a verified doctor connected/);
  assert.equal((await q('pa', 'select id from public.prescriptions')).length, 1);
  assert.equal((await q('pb', 'select id from public.prescriptions')).length, 0);
  await denied(q('d2', 'select public.stop_prescription($1)', [U.rx]), /not yours/);
});

test('reminders: own prescriptions only, valid times, each dose logged once', { skip }, async () => {
  const [rem] = await q('pa', "insert into public.medication_reminders (patient_id, prescription_id, times) values (auth.uid(), $1, '{08:00,20:00}') returning id", [U.rx]);
  await denied(q('pa', "update public.medication_reminders set times = '{25:00}' where id = $1", [rem.id]), /HH:MM/);
  await denied(q('pb', "insert into public.medication_reminders (patient_id, prescription_id, times) values (auth.uid(), $1, '{09:00}')", [U.rx]), /own prescriptions/);
  await q('pa', "insert into public.reminder_doses (reminder_id, due_date, slot) values ($1, current_date, '08:00')", [rem.id]);
  await denied(q('pa', "insert into public.reminder_doses (reminder_id, due_date, slot) values ($1, current_date, '08:00')", [rem.id]), /duplicate|pkey/);
  assert.equal((await q('pb', 'select 1 from public.reminder_doses')).length, 0);
});

test('reviews: only after the patient’s own completed appointment, once', { skip }, async () => {
  const [ap] = await q('pa', "insert into public.appointments (patient_id, doctor_id, hospital_id, requested_for) values (auth.uid(), $1, $2, now() + interval '2 days') returning id", [U.D1, U.h]);
  await denied(q('pa', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 5)", [ap.id, U.D1]), /completed appointment/);
  await q('staff', "select public.set_appointment_status($1, 'confirmed')", [ap.id]);
  await q('staff', "select public.set_appointment_status($1, 'completed')", [ap.id]);
  await denied(q('pb', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 1)", [ap.id, U.D1]), /own appointments/);
  const [rv] = await q('pa', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating, body) values ($1, auth.uid(), $2, 4, 'Clear explanation') returning doctor_id", [ap.id, U.D2]);
  assert.equal(rv.doctor_id, U.D1, 'doctor taken from the appointment, not the request');
  await denied(q('pa', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 5)", [ap.id, U.D1]), /duplicate|reviews_appointment_id_key/);
  assert.equal((await q('pb', 'select rating from public.reviews'))[0].rating, 4, 'published review visible to other users');
  await denied(q('pa', 'update public.reviews set rating = 5'), /permission denied/);
});

test('alerts: connected doctor is notified and can resolve with a note; others cannot', { skip }, async () => {
  await q('pa', "insert into public.analysis_results (session_id, window_end, outcome, reason, quality) values ($1, 30, 'concerning', 'Breathing faster than baseline at rest; both sensors agree.', 0.9)", [U.s]);
  const [al] = await q('d1', 'select id from public.alerts where session_id = $1', [U.s]);
  assert.ok(al, 'connected doctor can read the alert');
  assert.equal((await q('d1', "select 1 from public.notifications where kind = 'alert' and link = $1", [`/alerts/${al.id}`])).length, 1, 'notified once');
  await denied(q('pa', "select public.resolve_alert($1, 'I feel fine')", [al.id]), /not permitted/);
  await denied(q('d2', "select public.resolve_alert($1, 'Reviewed remotely')", [al.id]), /not permitted/);
  await denied(q('d1', "select public.resolve_alert($1, 'ok')", [al.id]), /resolution note/);
  const [res] = await q('d1', "select (public.resolve_alert($1, 'Reviewed: simulated pattern, discussed with patient')).resolved_by as by", [al.id]);
  assert.equal(res.by, U.d1);
  assert.ok((await q('pa', "select 1 from public.notifications where title like 'A clinician reviewed%'")).length === 1);
});

test('ending the relationship removes access and messaging immediately', { skip }, async () => {
  await denied(q('d1', 'select public.end_care_request($1)', [U.r]), /not found/);
  await q('pa', 'select public.end_care_request($1)', [U.r]);
  assert.equal((await q('d1', 'select id from public.monitoring_sessions where id = $1', [U.s])).length, 0);
  assert.equal((await q('d1', 'select id from public.prescriptions where patient_id = $1 and prescribed_by <> auth.uid()', [U.pa])).length, 0);
  await denied(q('d1', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'still there?')", [U.r]), /accepted connection/);
  const [again] = await q('pa', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1) returning status', [U.D1]);
  assert.equal(again.status, 'pending', 'a new request is possible after ending');
});

test('AI rate limit counts per user and refuses beyond the limit', { skip }, async () => {
  assert.equal((await q('pb', 'select public.ai_rate_check(2) as n'))[0].n, 1);
  assert.equal((await q('pb', 'select public.ai_rate_check(2) as n'))[0].n, 2);
  await denied(q('pb', 'select public.ai_rate_check(2)'), /limit reached/);
  assert.equal((await q('pa', 'select public.ai_rate_check(2) as n'))[0].n, 1, 'other users unaffected');
  await denied(q('pb', 'select * from public.ai_usage'), /permission denied/);
});

test('health check: anonymous, data-free, and detects security switched off', { skip }, async () => {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role anon');
    const h = (await c.query('select public.bg_health() as h')).rows[0].h;
    await c.query('commit');
    assert.equal(h.ok, true); assert.equal(h.schema_version, 5);
    assert.deepEqual(Object.keys(h).sort(), ['authority_accounts', 'checked_at', 'missing_functions', 'missing_tables', 'ok', 'realtime_missing', 'schema_version', 'tables_without_rls']);
    await c.query('begin'); await c.query('alter table public.messages disable row level security');
    const bad = (await c.query('select public.bg_health() as h')).rows[0].h;
    await c.query('rollback');
    assert.equal(bad.ok, false); assert.deepEqual(bad.tables_without_rls, ['messages']);
  } finally { c.release(); }
});

test('authority access: only while the patient shares; read-only; revocable; audited', { skip }, async () => {
  const seeSession = async (u) => (await q(u, 'select id from public.monitoring_sessions where id = $1', [U.s])).length;
  assert.equal(await seeSession('au'), 0, 'no sharing: the authority sees nothing');
  await denied(q('staff', 'insert into public.authority_access (patient_id) values ($1)', [U.pa]), /Only the patient/);
  await q('pa', 'insert into public.authority_access (patient_id) values (auth.uid())');
  assert.equal(await seeSession('au'), 1, 'patient shared: authority can read the session');
  assert.ok((await q('au', 'select 1 from public.analysis_results where session_id = $1', [U.s])).length >= 1, 'and its analysis');
  const [al] = await q('au', 'select id from public.alerts where session_id = $1', [U.s]);
  assert.ok(al, 'and its alerts');
  assert.equal((await q('au', 'select full_name from public.profiles where id = $1', [U.pa]))[0].full_name, 'Synthetic pa', 'and who the patient is');
  assert.equal((await q('au', 'select public.session_report($1) as r', [U.s]))[0].r.label, 'SYNTHETIC DATA — NOT FOR CLINICAL USE', 'and the report');
  await denied(q('au', 'select public.acknowledge_alert($1)', [al.id]), /not permitted/);
  await denied(q('au', "select public.resolve_alert($1, 'Reviewed by authority')", [al.id]), /not permitted/);
  await denied(q('au', 'insert into public.observations (session_id, seq, t_start) values ($1, 900, 900)', [U.s]), /row-level security/);
  const sb = (await q('pb', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'quick', '{chest,motion}', 'walking', 1) returning id"))[0].id;
  assert.equal((await q('au', 'select id from public.monitoring_sessions where id = $1', [sb])).length, 0, 'other patients stay private');
  await q('pa', 'update public.authority_access set active = false where patient_id = auth.uid()');
  assert.equal(await seeSession('au'), 0, 'revoked: access ends immediately');
  const acts = (await q('au', "select action from public.audit_log where action like 'consent.authority%' order by id")).map((r) => r.action);
  assert.deepEqual(acts.slice(-2), ['consent.authority_granted', 'consent.authority_revoked']);
});
