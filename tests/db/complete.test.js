// Part 7 database tests: doctor accounts, administrator management, revocation, notifications,
// appointments, alert rules, AI history privacy and report metadata. Real PostgreSQL, real migrations.
// Skipped unless BG_TEST_DB is set (see rls.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BG_TEST_DB;
const skip = !URL && 'set BG_TEST_DB to run database tests';
let pool; const U = {};
async function as(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (user === 'admin-sql') { /* superuser, as in the Supabase SQL editor */ }
    else { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[user], role: 'authenticated' })]); }
    const r = await fn(c); await c.query('commit'); return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const q = async (u, sql, p) => (await as(u, (c) => c.query(sql, p))).rows;
const denied = (p, re) => assert.rejects(p, (e) => re.test(e.message));

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: URL });
  const c = await pool.connect();
  await c.query('truncate auth.users cascade'); await c.query('truncate public.hospitals, public.audit_log restart identity cascade');
  await c.query('update public.alert_settings set concerning_min_windows = 1, alert_on_insufficient = true');
  for (const [k, role] of [['pat', 'patient'], ['pat2', 'patient'], ['staff', 'hospital_staff'], ['doc', 'doctor'], ['docB', 'doctor'], ['admin', 'patient'], ['admin2', 'patient']]) {
    U[k] = (await c.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${k}@t.local`, { role, full_name: `Synthetic ${k}` }])).rows[0].id;
  }
  c.release();
});
after(async () => { if (pool) await pool.end(); });

test('initial administrator: only via the SQL editor, never from the app', { skip }, async () => {
  await denied(q('admin', "select public.bootstrap_authority('admin@t.local')"), /permission denied/);
  await q('admin-sql', "select public.bootstrap_authority('admin@t.local')");
  assert.equal((await q('admin', 'select role from public.profiles where id = auth.uid()'))[0].role, 'authority');
  const a = await q('admin-sql', "select action from public.audit_log where action = 'authority.bootstrap'");
  assert.equal(a.length, 1);
});

test('administrators can grant and revoke admin rights, with a reason, never leaving zero', { skip }, async () => {
  await denied(q('pat', "select public.set_authority('pat@t.local', true, 'promoting myself now')"), /Only the healthcare authority/);
  await denied(q('admin', "select public.set_authority('admin@t.local', false, 'removing my own rights')"), /cannot remove your own/);
  await q('admin', "select public.set_authority('admin2@t.local', true, 'Second reviewer for the demo')");
  assert.equal((await q('admin2', 'select role from public.profiles where id = auth.uid()'))[0].role, 'authority');
  await q('admin2', "select public.set_authority('admin2@t.local', false, 'x')").catch(() => {});
  await q('admin', "select public.set_authority('admin2@t.local', false, 'Second reviewer no longer needed')");
  assert.equal((await q('admin2', 'select role from public.profiles where id = auth.uid()'))[0].role, 'patient');
  assert.ok((await q('admin2', "select 1 from public.notifications where kind = 'account'")).length >= 2, 'affected user notified');
});

test('doctor accounts get care-team access only when linked, verified AND hospital approved', { skip }, async () => {
  U.h = (await q('staff', "insert into public.hospitals (name, city, registration_no) values ('Synthetic H', 'T', 'DEMO-1') returning id"))[0].id;
  await q('admin', "select public.decide_hospital($1, 'approved', 'Demo documents checked.')", [U.h]);
  U.d = (await q('staff', "insert into public.doctors (full_name, specialty, license_no) values ('Dr Synthetic', 'Pulmonology', 'DEMO-D-1') returning id"))[0].id;
  await denied(q('pat', "select public.link_doctor_account($1, 'doc@t.local')", [U.d]), /Only staff/);
  await denied(q('staff', "select public.link_doctor_account($1, 'pat@t.local')", [U.d]), /No doctor account/);
  await q('staff', "select public.link_doctor_account($1, 'doc@t.local')", [U.d]);
  // patient shares and records
  U.s = (await q('pat', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'quick', '{chest,motion}', 'walking', 1) returning id"))[0].id;
  await q('pat', "insert into public.consents (patient_id, hospital_id, scopes) values (auth.uid(), $1, '{reports,live}')", [U.h]);
  assert.equal((await q('doc', 'select 1 from public.monitoring_sessions where id = $1', [U.s])).length, 0, 'unverified doctor: no access');
  await q('admin', "select public.decide_doctor($1, 'approved', 'Licence checked in demo registry')", [U.d]);
  assert.equal((await q('doc', 'select 1 from public.monitoring_sessions where id = $1', [U.s])).length, 1, 'verified doctor at approved hospital: access');
  assert.equal((await q('docB', 'select 1 from public.monitoring_sessions where id = $1', [U.s])).length, 0, 'unlinked doctor: none');
  // revoke the doctor's approval -> access ends
  await q('admin', "select public.decide_doctor($1, 'rejected', 'Credential withdrawn in demo')", [U.d]);
  assert.equal((await q('doc', 'select 1 from public.monitoring_sessions where id = $1', [U.s])).length, 0, 'revoked doctor: no access');
  await q('admin', "select public.decide_doctor($1, 'approved', 'x')").catch(() => {});
});

test('authority can revoke a hospital approval outright', { skip }, async () => {
  const h2 = (await q('admin-sql', "select id from public.hospitals limit 1"))[0].id;
  await q('admin', "select public.decide_hospital($1, 'rejected', 'Approval revoked after demo audit')", [h2]);
  assert.equal((await q('staff', 'select 1 from public.monitoring_sessions where id = $1', [U.s])).length, 0, 'revoked hospital loses access');
  assert.ok((await q('staff', "select 1 from public.notifications where kind = 'application'")).length >= 1, 'staff notified of the decision');
});

test('alert rules are configurable by the authority and applied reproducibly', { skip }, async () => {
  await denied(q('pat', "select public.update_alert_settings(2, true, 'patients cannot do this')"), /Only the healthcare authority/);
  await q('admin', "select public.update_alert_settings(2, false, 'Require two windows for the demo')");
  const s = (await q('pat', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'care', '{chest,acoustic,motion}', 'irregular', 1) returning id"))[0].id;
  const ins = "insert into public.analysis_results (session_id, window_end, outcome, reason, quality) values ($1, $2, $3, 'synthetic', 0.9)";
  for (const [w, o] of [[30, 'within'], [40, 'concerning'], [50, 'within'], [60, 'concerning'], [70, 'concerning'], [80, 'concerning'], [90, 'insufficient']]) await q('pat', ins, [s, w, o]);
  const al = await q('pat', 'select category, window_end from public.alerts where session_id = $1 order by window_end', [s]);
  assert.deepEqual(al.map((a) => `${a.category}@${a.window_end}`), ['concerning@70'], 'one alert when two consecutive windows are concerning; none for a single blip; none for insufficient when switched off');
  const n = await q('pat', "select title from public.notifications where kind = 'alert'");
  assert.ok(n.some((x) => x.title.includes('concerning')), 'patient notified of the alert');
  await q('admin', "select public.update_alert_settings(1, true, 'Back to the default demo rules')");
});

test('appointments: request, reschedule, decisions, full history, notifications', { skip }, async () => {
  const h = (await q('admin-sql', "select id from public.hospitals limit 1"))[0].id;
  await q('admin', "select public.decide_hospital($1, 'approved', 'Reinstated after the demo audit')", [h]).catch(() => {});
  await q('admin-sql', "update public.hospitals set status = 'approved' where id = $1", [h]).catch(() => {});
  await q('admin-sql', "select set_config('breatheguard.internal','on',false); update public.hospitals set status='approved' where id = '" + h + "'");
  await q('admin-sql', "update public.doctors set status = 'approved' where id = $1", [U.d]);
  const a = (await q('pat', "insert into public.appointments (patient_id, doctor_id, hospital_id, requested_for, reason) values (auth.uid(), $1, $2, now() + interval '2 days', 'Review synthetic results') returning id", [U.d, h]))[0].id;
  await denied(q('pat', "update public.appointments set status = 'confirmed' where id = $1", [a]), /permission denied/);
  await denied(q('pat', "select public.reschedule_appointment($1, now() - interval '1 day', 'past')", [a]), /future/);
  await q('pat', "select public.reschedule_appointment($1, now() + interval '3 days', 'Prefer Thursday')", [a]);
  await q('staff', "select public.reschedule_appointment($1, now() + interval '4 days', 'Clinic moved to Friday')", [a]);
  await q('staff', "select public.set_appointment_status($1, 'completed')", [a]);
  await denied(q('pat2', 'select public.reschedule_appointment($1, now() + interval \'5 days\', \'not mine\')', [a]), /Not permitted/);
  const ev = await q('pat', 'select to_status, note from public.appointment_events where appointment_id = $1 order by id', [a]);
  assert.deepEqual(ev.map((e) => e.to_status), ['requested', 'requested', 'confirmed', 'completed']);
  assert.equal(ev[2].note, 'Clinic moved to Friday');
  assert.equal((await q('pat2', 'select 1 from public.appointment_events where appointment_id = $1', [a])).length, 0, 'history private to participants');
  assert.ok((await q('pat', "select 1 from public.notifications where kind = 'appointment'")).length >= 2, 'patient notified of hospital changes');
  assert.ok((await q('staff', "select 1 from public.notifications where kind = 'appointment'")).length >= 1, 'hospital notified of the request');
});

test('notifications are private and only the read flag can change', { skip }, async () => {
  const mine = await q('pat', 'select id from public.notifications');
  assert.ok(mine.length > 0);
  assert.equal((await q('pat2', 'select 1 from public.notifications where id = $1', [mine[0].id])).length, 0);
  await denied(q('pat', "update public.notifications set title = 'forged' where id = $1", [mine[0].id]), /permission denied/);
  await denied(q('pat', "insert into public.notifications (user_id, kind, title) values (auth.uid(), 'alert', 'fake')"), /permission denied/);
  await q('pat', 'update public.notifications set read_at = now() where id = $1', [mine[0].id]);
  assert.ok((await q('pat', 'select read_at from public.notifications where id = $1', [mine[0].id]))[0].read_at);
});

test('AI history is private to its owner and deletable', { skip }, async () => {
  await q('pat', "insert into public.ai_messages (user_id, role, content) values (auth.uid(), 'user', 'What does insufficient mean?')");
  assert.equal((await q('pat2', 'select 1 from public.ai_messages')).length, 0);
  assert.equal((await q('admin', 'select 1 from public.ai_messages')).length, 0, 'not even administrators can read it');
  await denied(q('pat2', "insert into public.ai_messages (user_id, role, content) values ($1, 'user', 'spoof')", [U.pat]), /row-level security/);
  await q('pat', 'delete from public.ai_messages');
  assert.equal((await q('pat', 'select 1 from public.ai_messages')).length, 0);
});

test('reports: record identifier instead of name, metadata logged and audited', { skip }, async () => {
  const r = (await q('pat', 'select public.session_report($1) as r', [U.s]))[0].r;
  assert.match(r.record_id, /^BG-[0-9A-F]{8}$/);
  assert.ok(!JSON.stringify(r).includes('Synthetic pat'), 'patient name not in the report payload');
  await q('pat', "insert into public.reports (session_id, generated_by, format, file_name, size_bytes) values ($1, auth.uid(), 'pdf', 'breatheguard_quick_walking.pdf', 12345)", [U.s]);
  assert.ok((await q('admin', "select 1 from public.audit_log where action = 'report.generated'")).length >= 1);
  await q('pat', "update public.monitoring_sessions set status = 'stopped' where id = $1", [U.s]);
  assert.ok((await q('pat', "select 1 from public.notifications where kind = 'report'")).length >= 1, 'report-available notification');
});
