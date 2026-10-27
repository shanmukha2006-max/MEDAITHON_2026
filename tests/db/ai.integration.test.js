// AI assistant integration: the real Edge Function code (run under Deno) behind a Supabase-style
// proxy, the real database, and a STAND-IN AI provider (no real model is called; the stand-in's
// replies are marked and it records what it was sent). Skipped unless BG_TEST_FN is set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as api from '../../src/backend/api.js';

const BASE = process.env.BG_TEST_API, DB = process.env.BG_TEST_DB, FN = process.env.BG_TEST_FN;
const LOG = process.env.FAKE_AI_LOG || '/tmp/fake_ai_requests.jsonl';
const SECRET = 'test-only-secret-at-least-32-characters-long';
const skip = (!BASE || !DB || !FN) && 'set BG_TEST_API, BG_TEST_DB and BG_TEST_FN to run AI integration tests';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (c) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const ANON = jwt({ role: 'anon' });
const client = (uid) => createClient(BASE, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${uid ? jwt({ sub: uid, role: 'authenticated' }) : ANON}` } } });
const providerCalls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let pool; const U = {};

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: DB });
  const c = await pool.connect();
  await c.query('truncate auth.users cascade');
  for (const k of ['alice', 'bob']) U[k] = (await c.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`${k}@private.test`, { role: 'patient', full_name: `Private Name ${k}` }])).rows[0].id;
  U.s = (await api.startSession(client(U.alice), { patientId: U.alice, patch: 'care', channels: ['chest', 'acoustic', 'motion'], scenarioId: 'irregular', seed: 1 })).id;
  // a clinician-entered prescription for alice (setup only: written directly, bypassing the app's triggers)
  await c.query('set session_replication_role = replica');
  const h = (await c.query("insert into public.hospitals (name, city, registration_no, status, created_by) values ('AI Test Hospital', 'X', 'DEMO-AI', 'approved', $1) returning id", [U.alice])).rows[0].id;
  const d = (await c.query("insert into public.doctors (hospital_id, full_name, specialty, license_no, status, submitted_by) values ($1, 'Dr AI Test', 'Pulmonology', 'DEMO-D-AI', 'approved', $2) returning id", [h, U.alice])).rows[0].id;
  U.rx = (await c.query("insert into public.prescriptions (patient_id, doctor_id, prescribed_by, medicine, dose_text, instructions) values ($1, $2, $1, 'Salbutamol inhaler', '2 puffs as needed', 'Use when breathless') returning id", [U.alice, d])).rows[0].id;
  await c.query('set session_replication_role = origin');
  c.release();
  await api.writeAnalysis(client(U.alice), [{ session_id: U.s, window_end: 30, outcome: 'concerning', reason: 'Breathing faster than baseline at rest; both sensors agree.', quality: 0.9 }]);
});
after(async () => { if (pool) await pool.end(); });

test('patient asks about their own session through the server-side function', { skip }, async () => {
  const before = providerCalls().length;
  const out = await api.askAssistant(client(U.alice), { question: 'Why was my session flagged?', sessionId: U.s });
  assert.equal(out.configured, true);
  assert.match(out.answer, /TEST STAND-IN REPLY/);
  assert.equal(out.model, 'stand-in-model-not-a-real-ai', 'the response names the model that actually answered');
  const call = providerCalls().at(-1);
  assert.equal(providerCalls().length, before + 1);
  assert.equal(call.xApiKey, true, 'provider key added on the server (its value is never logged)');
  assert.match(call.body.system, /Never diagnose/);
  assert.match(call.body.messages.at(-1).content, /potentially concerning simulated pattern/);
});

test('no names or emails are sent to the AI provider', { skip }, async () => {
  const sent = JSON.stringify(providerCalls());
  assert.ok(!sent.includes('Private Name') && !sent.includes('@private.test'));
});

test('history is NOT saved without opt-in; with opt-in it is private and used for follow-ups', { skip }, async () => {
  const { data: none } = await client(U.alice).from('ai_messages').select('id');
  assert.deepEqual(none, [], 'default: nothing stored');
  const { error } = await client(U.alice).from('profiles').update({ ai_history_opt_in: true }).eq('id', U.alice);
  assert.equal(error, null);
  const first = await api.askAssistant(client(U.alice), { question: 'What does signal quality mean?' });
  assert.equal(first.historySaved, true);
  await api.askAssistant(client(U.alice), { question: 'And what should I look at next?' });
  const msgs = providerCalls().at(-1).body.messages;
  assert.ok(msgs.length >= 3 && msgs[0].role === 'user', 'previous turns included');
  const { data } = await client(U.alice).from('ai_messages').select('role');
  assert.equal(data.length, 4);
  const { data: bobSees } = await client(U.bob).from('ai_messages').select('id');
  assert.deepEqual(bobSees, []);
});

test('a selected prescription is used only by its owner; others are refused before the provider', { skip }, async () => {
  const before = providerCalls().length;
  const out = await api.askAssistant(client(U.alice), { question: 'What does this prescription mean?', prescriptionId: U.rx });
  assert.equal(out.configured, true);
  const sent = JSON.stringify(providerCalls().at(-1).body);
  assert.match(sent, /Salbutamol/); assert.match(sent, /clinician-entered/); assert.match(sent, /never prescribe/);
  const mid = providerCalls().length;
  assert.equal(mid, before + 1);
  await assert.rejects(api.askAssistant(client(U.bob), { question: 'Explain this', prescriptionId: U.rx }), /do not have access to that prescription/);
  assert.equal(providerCalls().length, mid, 'nothing was sent to the AI provider');
});

test('rate limit: a user over the hourly limit is refused before the provider is called', { skip }, async () => {
  const c = await pool.connect();
  await c.query('insert into public.ai_usage (user_id) select $1 from generate_series(1, 20)', [U.bob]);
  c.release();
  const before = providerCalls().length;
  await assert.rejects(api.askAssistant(client(U.bob), { question: 'Explain signal quality, please' }), /limit reached/);
  assert.equal(providerCalls().length, before);
  const c2 = await pool.connect(); await c2.query('delete from public.ai_usage where user_id = $1', [U.bob]); c2.release(); // leave bob usable for later tests
});

test('another patient cannot get the assistant to read someone else’s session', { skip }, async () => {
  const before = providerCalls().length;
  await assert.rejects(api.askAssistant(client(U.bob), { question: 'Summarise this session', sessionId: U.s }), /do not have access/);
  assert.equal(providerCalls().length, before, 'nothing was sent to the AI provider');
});

test('unauthenticated calls are refused', { skip }, async () => {
  await assert.rejects(api.askAssistant(client(null), { question: 'hello' }), /Sign in/);
});

test('without a provider key the function says so instead of answering', { skip }, async () => {
  const r = await fetch(process.env.BG_TEST_FN_NOKEY || 'http://localhost:3021/', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt({ sub: U.alice, role: 'authenticated' })}` }, body: JSON.stringify({ question: 'hi' }) });
  const body = await r.json();
  assert.equal(r.status, 503);
  assert.equal(body.configured, false);
  assert.match(body.message, /ANTHROPIC_API_KEY/);
  assert.equal(body.answer, undefined);
});

test('provider failure → honest, retryable error; no answer fabricated, nothing saved', { skip }, async () => {
  const before = (await client(U.alice).from('ai_messages').select('id')).data.length;
  await assert.rejects(api.askAssistant(client(U.alice), { question: 'SIMULATE-PROVIDER-FAILURE please' }), /AI provider returned an error \(503\)/);
  assert.equal((await client(U.alice).from('ai_messages').select('id')).data.length, before);
});
