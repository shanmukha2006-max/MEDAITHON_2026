// Part 8 database rules: connection requests, messaging, alert resolution, prescriptions,
// reminders, reviews. Real PostgreSQL + all three migrations; every actor goes through real flows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const URL = process.env.BG_TEST_DB;
const skip = !URL && 'set BG_TEST_DB to run database tests';
let pool; const U = {}; const X = {};
async function as(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[user], role: 'authenticated' })]);
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
  for (const [k, role] of [['A', 'patient'], ['B', 'patient'], ['staff', 'hospital_staff'], ['d1', 'doctor'], ['d2', 'doctor'], ['d3', 'doctor'], ['auth', 'patient']]) {
    U[k] = (await c.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${k}@rel.test`, { role, full_name: `Synthetic ${k}` }])).rows[0].id;
  }
  await c.query("select public.bootstrap_authority('auth@rel.test')"); c.release();
  X.h = (await q('staff', "insert into public.hospitals (name, city, registration_no) values ('Rel Hospital', 'T', 'DEMO-R') returning id"))[0].id;
  await q('auth', "select public.decide_hospital($1, 'approved', 'Demo documents checked.')", [X.h]);
  for (const k of ['d1', 'd2', 'd3']) {
    X[k] = (await q('staff', "insert into public.doctors (full_name, specialty, license_no) values ($1, 'Pulmonology', $2) returning id", [`Dr ${k}`, `DEMO-${k}`]))[0].id;
    await q('staff', 'select public.link_doctor_account($1, $2)', [X[k], `${k}@rel.test`]);
  }
  for (const k of ['d1', 'd2']) await q('auth', "select public.decide_doctor($1, 'approved', 'Licence checked in demo registry')", [X[k]]);
  X.s = (await q('A', "insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values (auth.uid(), 'care', '{chest,acoustic,motion}', 'irregular', 1) returning id"))[0].id;
});
after(async () => { if (pool) await pool.end(); });

test('a connection request reaches only the intended doctor', { skip }, async () => {
  X.r1 = (await q('A', "insert into public.care_requests (patient_id, doctor_id, message) values (auth.uid(), $1, 'Please review my simulated sessions') returning id, status", [X.d1]))[0];
  assert.equal(X.r1.status, 'pending'); X.r1 = X.r1.id;
  assert.equal((await q('d1', 'select id from public.care_requests')).length, 1, 'intended doctor sees it');
  for (const u of ['d2', 'staff', 'B']) assert.equal((await q(u, 'select id from public.care_requests')).length, 0, `${u} does not`);
  assert.equal((await q('d1', "select 1 from public.notifications where kind = 'connection'")).length, 1);
  assert.equal((await q('d2', "select 1 from public.notifications where kind = 'connection'")).length, 0);
});

test('duplicates, unverified doctors and non-patients are refused', { skip }, async () => {
  await denied(q('A', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [X.d1]), /duplicate key|uq_care_request_open/);
  await denied(q('A', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [X.d3]), /not currently verified/);
  await denied(q('staff', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1)', [X.d1]), /Only patients/);
});

test('only the intended doctor can decide; acceptance grants access, rejection does not', { skip }, async () => {
  await denied(q('d2', 'select public.respond_care_request($1, true, null)', [X.r1]), /not addressed to you/);
  await q('d1', "select public.respond_care_request($1, false, 'Not taking new patients this week')", [X.r1]);
  assert.equal((await q('A', 'select status from public.care_requests where id = $1', [X.r1]))[0].status, 'rejected');
  assert.equal((await q('d1', 'select 1 from public.monitoring_sessions where id = $1', [X.s])).length, 0, 'rejected: no access');
  X.r2 = (await q('A', 'insert into public.care_requests (patient_id, doctor_id) values (auth.uid(), $1) returning id', [X.d1]))[0].id;
  await q('d1', 'select public.respond_care_request($1, true, null)', [X.r2]);
  assert.equal((await q('d1', 'select 1 from public.monitoring_sessions where id = $1', [X.s])).length, 1, 'accepted: doctor can read');
  assert.equal((await q('d2', 'select 1 from public.monitoring_sessions where id = $1', [X.s])).length, 0, 'other doctor cannot');
  assert.equal((await q('A', "select 1 from public.notifications where kind = 'connection' and title = 'Connection accepted'")).length, 1);
});

test('messages: only between the two parties; server sets sender and recipient; read status', { skip }, async () => {
  const [m] = await q('A', "insert into public.messages (request_id, sender_id, recipient_id, body, client_id) values ($1, auth.uid(), $2, 'Hello doctor', 'c1') returning sender_id, recipient_id", [X.r2, U.B]);
  assert.equal(m.sender_id, U.A); assert.equal(m.recipient_id, U.d1, 'recipient set by the server, not the client');
  await q('A', "insert into public.messages (request_id, sender_id, recipient_id, body, client_id) values ($1, auth.uid(), $1, 'Hello doctor', 'c1') on conflict do nothing", [X.r2]);
  assert.equal((await q('d1', 'select id from public.messages')).length, 1, 'retried send stored once');
  for (const u of ['B', 'd2', 'staff']) assert.equal((await q(u, 'select id from public.messages')).length, 0, `${u} cannot read`);
  await denied(q('B', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'intrude')", [X.r2]), /not part of this conversation/);
  await denied(q('A', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'x')", [X.r1]), /accepted connection/);
  await q('d1', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'Hello, I can see your shared sessions')", [X.r2]);
  assert.equal((await q('A', 'select 1 from public.messages where recipient_id = auth.uid() and read_at is null')).length, 1, 'unread count 1');
  assert.equal((await q('A', 'select public.mark_messages_read($1) as n', [X.r2]))[0].n, 1);
  assert.equal((await q('d1', 'select read_at from public.messages where sender_id = auth.uid()'))[0].read_at !== null, true, 'doctor sees it was read');
  await denied(q('A', 'update public.messages set body = $1', ['edited']), /permission denied/);
});

test('alerts: delivered once to the connected doctor; only clinicians resolve, with a note', { skip }, async () => {
  for (const [w, o] of [[30, 'within'], [40, 'concerning'], [50, 'concerning']]) await q('A', "insert into public.analysis_results (session_id, window_end, outcome, reason, quality) values ($1, $2, $3, 'synthetic', 0.9)", [X.s, w, o]);
  const al = await q('d1', 'select id from public.alerts where session_id = $1', [X.s]);
  assert.equal(al.length, 1, 'one alert, on the change');
  assert.equal((await q('d1', "select 1 from public.notifications where kind = 'alert'")).length, 1, 'connected doctor notified once');
  await denied(q('A', "select public.resolve_alert($1, 'I feel fine')", [al[0].id]), /not permitted/);
  await denied(q('d1', "select public.resolve_alert($1, 'ok')", [al[0].id]), /at least 5/);
  const [r] = await q('d1', "select (public.resolve_alert($1, 'Reviewed with patient by message')).resolved_by as by", [al[0].id]);
  assert.equal(r.by, U.d1);
});

test('prescriptions: only a connected, verified doctor writes; patient reads; others see nothing', { skip }, async () => {
  await denied(q('A', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text) values (auth.uid(), $1, auth.uid(), 'Fake', '1')", [X.d1]), /Only a verified doctor connected/);
  await denied(q('d2', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text) values ($1, $2, auth.uid(), 'Rx', '1')", [U.A, X.d2]), /Only a verified doctor connected/);
  X.rx = (await q('d1', "insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text, instructions) values ($1, $2, auth.uid(), 'Salbutamol inhaler', '2 puffs as needed', 'Demo record') returning id, is_demo_record", [U.A, X.d2]))[0];
  assert.equal(X.rx.is_demo_record, true); X.rx = X.rx.id;
  assert.equal((await q('A', 'select doctor_id from public.prescriptions'))[0].doctor_id, X.d1, 'author fixed by the server');
  assert.equal((await q('B', 'select 1 from public.prescriptions')).length, 0);
  assert.equal((await q('A', "select 1 from public.notifications where kind = 'prescription'")).length, 1);
});

test('reminders: own prescriptions only, valid times, each dose recorded once', { skip }, async () => {
  const [rem] = await q('A', "insert into public.medication_reminders (patient_id, prescription_id, times) values (auth.uid(), $1, '{08:00,20:00}') returning id", [X.rx]);
  await denied(q('A', "update public.medication_reminders set times = '{25:00}' where id = $1", [rem.id]), /HH:MM/);
  await denied(q('B', "insert into public.medication_reminders (patient_id, prescription_id, times) values (auth.uid(), $1, '{08:00}')", [X.rx]), /own prescriptions/);
  await q('A', "insert into public.reminder_doses (reminder_id, due_date, slot) values ($1, current_date, '08:00')", [rem.id]);
  await denied(q('A', "insert into public.reminder_doses (reminder_id, due_date, slot) values ($1, current_date, '08:00')", [rem.id]), /duplicate key/);
  assert.equal((await q('B', 'select 1 from public.reminder_doses')).length, 0);
});

test('reviews: only for own completed appointments, one each', { skip }, async () => {
  const [ap] = await q('A', "insert into public.appointments (patient_id, doctor_id, hospital_id, requested_for) values (auth.uid(), $1, $2, now() + interval '1 day') returning id", [X.d1, X.h]);
  await denied(q('A', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 5)", [ap.id, X.d1]), /completed appointment/);
  await q('staff', "select public.set_appointment_status($1, 'confirmed')", [ap.id]);
  await q('staff', "select public.set_appointment_status($1, 'completed')", [ap.id]);
  await denied(q('B', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 1)", [ap.id, X.d1]), /your own appointments/);
  await q('A', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating, body) values ($1, auth.uid(), $2, 5, 'Clear explanations')", [ap.id, X.d2]);
  assert.equal((await q('B', 'select doctor_id from public.reviews'))[0].doctor_id, X.d1, 'visible to others; doctor fixed by the server');
  await denied(q('A', "insert into public.reviews (appointment_id, patient_id, doctor_id, rating) values ($1, auth.uid(), $2, 4)", [ap.id, X.d1]), /duplicate key/);
});

test('ending the connection stops the doctor’s access and messaging immediately', { skip }, async () => {
  await q('A', 'select public.end_care_request($1)', [X.r2]);
  assert.equal((await q('d1', 'select 1 from public.monitoring_sessions where id = $1', [X.s])).length, 0);
  assert.equal((await q('d1', 'select 1 from public.prescriptions')).length, 1, 'the doctor still sees prescriptions they wrote');
  await denied(q('d1', "insert into public.messages (request_id, sender_id, recipient_id, body) values ($1, auth.uid(), auth.uid(), 'still there?')", [X.r2]), /accepted connection/);
});
