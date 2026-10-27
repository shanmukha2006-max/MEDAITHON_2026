// The REAL AI Edge Function, configured for Groq (AI_PROVIDER=groq), against a TEST STAND-IN that speaks
// Groq's chat-completions format. A genuine Groq request is NOT made here (no network access to Groq).
// Skipped unless BG_TEST_FN_GROQ and BG_TEST_DB are set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
const FN = process.env.BG_TEST_FN_GROQ, DB = process.env.BG_TEST_DB;
const LOG = process.env.FAKE_AI_LOG || '/tmp/fake_ai_requests.jsonl';
const SECRET = process.env.BG_TEST_JWT_SECRET || 'test-only-secret-at-least-32-characters-long';
const skip = (!FN || !DB) && 'set BG_TEST_FN_GROQ and BG_TEST_DB';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let pool; const U = {};
const ask = async (who, body) => { const r = await fetch(FN, { method: 'POST', headers: { Authorization: `Bearer ${jwt(U[who])}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: DB });
  for (const k of ['ga', 'gb']) {
    await pool.query('delete from auth.users where email = $1', [`${k}@groq.test`]);
    U[k] = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, '{\"role\":\"patient\",\"full_name\":\"Synthetic Groq Patient\"}') returning id", [`${k}@groq.test`])).rows[0].id;
  }
  U.s = (await pool.query("insert into public.monitoring_sessions (patient_id, patch, channels, scenario_id, seed) values ($1, 'care', '{chest,acoustic,motion}', 'walking', 1) returning id", [U.ga])).rows[0].id;
});
after(async () => { if (pool) { await pool.query("delete from auth.users where email like '%@groq.test'"); await pool.end(); } });

test('Groq mode: answer comes back through the server function in Groq’s format', { skip }, async () => {
  const { status, body } = await ask('ga', { question: 'What is a movement artefact?' });
  assert.equal(status, 200); assert.equal(body.configured, true); assert.equal(body.provider, 'Groq');
  assert.match(body.answer, /TEST STAND-IN REPLY, Groq format/); assert.equal(body.model, 'stand-in-groq-format-not-a-real-ai');
  const c = calls().at(-1);
  assert.equal(c.format, 'openai'); assert.equal(c.bearer, true, 'Bearer key sent (value never logged)'); assert.equal(c.xApiKey, false);
  assert.equal(c.body.model, 'llama-3.3-70b-versatile'); assert.equal(c.body.messages[0].role, 'system'); assert.match(c.body.messages[0].content, /Never diagnose/);
  assert.ok(!JSON.stringify(body).includes('gsk_'), 'key never returned to the browser');
});
test('Groq mode: invalid key, rate limit, missing model and outage give clear, safe errors', { skip }, async () => {
  for (const [trigger, re, retry] of [['SIMULATE-INVALID-KEY', /rejected the server’s API key/, false], ['SIMULATE-RATE-LIMIT', /rate limit/, true], ['SIMULATE-MODEL-MISSING', /model “llama-3.3-70b-versatile” is not available/, false], ['SIMULATE-PROVIDER-FAILURE', /unavailable or overloaded/, true]]) {
    const { status, body } = await ask('ga', { question: `${trigger} test` });
    assert.equal(status, 502, trigger); assert.match(body.error, re, trigger); assert.equal(body.retryable, retry, trigger);
    assert.ok(!JSON.stringify(body).includes('gsk_'), 'no key in errors');
  }
});
test('Groq mode: another patient’s session is refused before anything reaches the provider', { skip }, async () => {
  const n = calls().length;
  const { status, body } = await ask('gb', { question: 'Explain this session', sessionId: U.s });
  assert.equal(status, 403); assert.match(body.error, /do not have access/);
  assert.equal(calls().length, n, 'nothing sent to the provider');
});

test('ported rule replies: instant, labelled not AI, nothing sent to the provider', { skip }, async () => {
  const n = calls().length;
  const { status, body } = await ask('ga', { question: '  Hello!  ' });
  assert.equal(status, 200); assert.equal(body.generatedBy, 'rules'); assert.match(body.label, /not AI/); assert.match(body.answer, /BreatheGuard AI/);
  assert.equal(calls().length, n);
});
test('provider timeout (AI_TIMEOUT_SECONDS) gives a clear, retryable error', { skip }, async () => {
  const t0 = Date.now();
  const { status, body } = await ask('ga', { question: 'SIMULATE-SLOW please' });
  assert.equal(status, 502); assert.match(body.error, /did not answer within 5 seconds/); assert.equal(body.retryable, true);
  assert.ok(Date.now() - t0 < 7500, 'gave up at the timeout, did not wait for the slow provider');
});
