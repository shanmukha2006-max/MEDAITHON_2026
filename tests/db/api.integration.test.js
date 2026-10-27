// Integration tests: the app's real data layer (src/backend/api.js + recorder.js) through the
// official supabase-js client -> PostgREST -> PostgreSQL with the real migration and RLS.
// Skipped unless BG_TEST_API (Supabase-style base URL) and BG_TEST_DB are set. Auth (GoTrue) and
// Realtime are NOT part of this stack: tokens are signed here exactly as Supabase signs them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as api from '../../src/backend/api.js';
import { SessionRecorder } from '../../src/backend/recorder.js';
import { generateSession } from '../../src/sim/generator.js';
import { getScenario } from '../../src/sim/scenarios.js';
import { analyzeUpTo } from '../../src/analysis/session.js';

const BASE = process.env.BG_TEST_API, DB = process.env.BG_TEST_DB;
const SECRET = process.env.BG_TEST_JWT_SECRET || 'test-only-secret-at-least-32-characters-long';
const skip = (!BASE || !DB) && 'set BG_TEST_API and BG_TEST_DB to run API integration tests';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const ANON = jwt({ role: 'anon' });
const U = {}, C = {};
const clientFor = (uid) => createClient(BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt({ sub: uid, role: 'authenticated' })}` } } });
let pool;

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: DB });
  const c = await pool.connect();
  await c.query('truncate auth.users cascade'); await c.query('truncate public.hospitals, public.audit_log restart identity cascade');
  for (const [k, role, name] of [['pa', 'patient', 'Synthetic Patient A'], ['pb', 'patient', 'Synthetic Patient B'], ['st', 'hospital_staff', 'Synthetic Staff'], ['au', 'patient', 'Demo Authority']]) {
    U[k] = (await c.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${k}@test.local`, { role, full_name: name }])).rows[0].id;
    C[k] = clientFor(U[k]);
  }
  await c.query("select set_config('breatheguard.internal','on',false)"); await c.query("update public.profiles set role='authority' where id=$1", [U.au]); c.release();
});
after(async () => { if (pool) await pool.end(); });

test('profiles load through the API with the role set by the database', { skip }, async () => {
  assert.equal((await api.getProfile(C.pa, U.pa)).role, 'patient');
  assert.equal((await api.getProfile(C.au, U.au)).role, 'authority');
});

test('hospital application → authority decision via the API; friendly errors', { skip }, async () => {
  const h = await api.createHospital(C.st, { name: 'Synthetic Riverside', city: 'Testville', registrationNo: 'DEMO-H-1' });
  assert.equal(h.status, 'pending'); U.h = h.id;
  await assert.rejects(api.decideHospital(C.st, h.id, 'approved', 'Approving my own hospital'), /Only the healthcare authority/);
  await assert.rejects(api.decideHospital(C.au, h.id, 'approved', 'short'), /reason of at least 10/);
  await api.decideHospital(C.au, h.id, 'approved', 'Demo documents checked.');
  assert.deepEqual((await api.listApprovedHospitals(C.pa)).map((x) => x.id), [h.id]);
  const d = await api.submitDoctor(C.st, { fullName: 'Dr Synthetic', specialty: 'Pulmonology', licenseNo: 'DEMO-D-1' });
  assert.equal(d.status, 'pending');
});

test('simulator data persists via the recorder: retries and duplicates stored once', { skip }, async () => {
  const s = await api.startSession(C.pa, { patientId: U.pa, patch: 'care', channels: ['chest', 'acoustic', 'motion'], scenarioId: 'irregular', seed: 1 });
  U.s = s.id;
  assert.equal(s.label, 'SYNTHETIC DATA — NOT FOR CLINICAL USE');
  let failures = 2;
  const flaky = async (rows) => { if (failures-- > 0) throw new Error('fetch failed'); return api.writeObservations(C.pa, rows); };
  const statuses = [];
  const rec = new SessionRecorder({ writeObservations: flaky, writeAnalysis: (r) => api.writeAnalysis(C.pa, r), baseDelay: 5, onStatus: (x) => statuses.push(x.status) });
  const data = generateSession(getScenario('irregular'), 1);
  for (let sec = 0; sec < 160; sec++) rec.addObservation(api.observationRow(s.id, data, sec, s.channels));
  rec.addObservation(api.observationRow(s.id, data, 5, s.channels)); // duplicate event
  for (const r of analyzeUpTo(data, 160)) rec.addAnalysis(api.analysisRow(s.id, r, { source: 'engine' }));
  assert.ok(await rec.drain(20000), 'recorder drained');
  assert.ok(statuses.includes('retrying') && statuses.at(-1) === 'saved');
  // a second recorder replaying the same rows (e.g. after a reconnect) must not duplicate
  const rec2 = new SessionRecorder({ writeObservations: (r) => api.writeObservations(C.pa, r), writeAnalysis: (r) => api.writeAnalysis(C.pa, r) });
  for (let sec = 0; sec < 20; sec++) rec2.addObservation(api.observationRow(s.id, data, sec, s.channels));
  assert.ok(await rec2.drain());
  const obs = await api.fetchObservations(C.pa, s.id);
  assert.equal(obs.length, 160, 'each second stored exactly once');
  assert.equal(obs[0].chest.length, 10);
  const an = await api.fetchAnalysis(C.pa, s.id);
  assert.equal(an.length, 14);
  const alerts = await api.fetchAlerts(C.pa, s.id);
  assert.ok(alerts.length >= 1 && alerts.some((a) => a.category === 'concerning'), 'alert created from the engine’s concerning result');
  assert.ok(alerts.length < an.length, 'not one alert per result');
});

test('another patient is refused through the API', { skip }, async () => {
  assert.deepEqual(await api.fetchObservations(C.pb, U.s), []);
  await assert.rejects(api.writeObservations(C.pb, [{ session_id: U.s, seq: 999, t_start: 999 }]), /permission/);
  await assert.rejects(api.fetchReport(C.pb, { sessionId: U.s, userId: U.pb }), /not permitted|permission/i);
});

test('consent through the API grants and revokes hospital access', { skip }, async () => {
  assert.deepEqual(await api.fetchObservations(C.st, U.s), [], 'no consent');
  await api.setConsent(C.pa, { patientId: U.pa, hospitalId: U.h, scopes: ['reports', 'live'] });
  assert.equal((await api.fetchObservations(C.st, U.s)).length, 160);
  const sessions = await api.listSessions(C.st);
  assert.equal(sessions[0].profiles.full_name, 'Synthetic Patient A');
  const rep = await api.fetchReport(C.st, { sessionId: U.s, userId: U.st });
  assert.equal(rep.label, 'SYNTHETIC DATA — NOT FOR CLINICAL USE');
  assert.equal(rep.session.patch, 'care');
  const a = (await api.fetchAlerts(C.st, U.s))[0];
  const ack = await api.acknowledgeAlert(C.st, a.id);
  assert.equal(ack.acknowledged_by, U.st);
  await api.setConsent(C.pa, { patientId: U.pa, hospitalId: U.h, scopes: [] });
  assert.deepEqual(await api.fetchObservations(C.st, U.s), [], 'revoked');
});

test('stopping a session; anonymous API calls refused', { skip }, async () => {
  await api.stopSession(C.pa, U.s);
  await assert.rejects(api.writeObservations(C.pa, [{ session_id: U.s, seq: 500, t_start: 500 }]), /permission/);
  const anon = createClient(BASE, ANON, { auth: { persistSession: false } });
  await assert.rejects(api.listSessions(anon), /permission/);
  const audit = await api.listAudit(C.au);
  assert.ok(audit.some((x) => x.action === 'hospital.decision') && audit.some((x) => x.action.startsWith('consent.')));
});
