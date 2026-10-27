import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderedStream } from '../src/backend/realtime.js';
import { SessionRecorder } from '../src/backend/recorder.js';
import { friendly, analysisRow, observationRow, signUp } from '../src/backend/api.js';
import { buildReportHtml } from '../src/backend/report.js';
import { buildAssistantRequest, summarizeReport } from '../supabase/functions/ai-assistant/prompt.js';
import { generateSession } from '../src/sim/generator.js';
import { getScenario } from '../src/sim/scenarios.js';
import { analyzeUpTo } from '../src/analysis/session.js';

test('real-time stream: out-of-order and duplicate events delivered once, in order', () => {
  const got = [];
  const s = new OrderedStream((items) => got.push(...items.map((i) => i.seq)));
  s.push([{ seq: 0 }, { seq: 2 }, { seq: 1 }, { seq: 1 }, { seq: 4 }]);
  assert.deepEqual(got, [0, 1, 2]);
  assert.ok(s.hasGap(), 'waiting for 3');
  s.push([{ seq: 3 }, { seq: 0 }]);
  assert.deepEqual(got, [0, 1, 2, 3, 4]);
  assert.equal(s.duplicates, 2);
});

test('real-time stream: a gap that never fills does not stall delivery forever', () => {
  const got = [];
  const s = new OrderedStream((items) => got.push(...items.map((i) => i.seq)), { maxBuffer: 3 });
  s.push([{ seq: 0 }, { seq: 5 }, { seq: 6 }, { seq: 7 }, { seq: 8 }]);
  assert.deepEqual(got, [0, 5, 6, 7, 8]);
});

test('recorder keeps data through failures and reports its status', async () => {
  let calls = 0; const stored = new Map(); const statuses = [];
  const write = async (rows) => { calls++; if (calls <= 3) throw new Error('fetch failed'); rows.forEach((r) => stored.set(r.seq, r)); };
  const rec = new SessionRecorder({ writeObservations: write, writeAnalysis: async () => {}, baseDelay: 1, sleep: () => Promise.resolve(), onStatus: (x) => statuses.push(x.status) });
  for (let i = 0; i < 30; i++) rec.addObservation({ seq: i });
  rec.addObservation({ seq: 3 });
  assert.ok(await rec.drain(2000));
  assert.equal(stored.size, 30);
  assert.ok(statuses.includes('retrying'));
  assert.equal(statuses.at(-1), 'saved');
});

test('error messages are plain and specific', () => {
  assert.equal(friendly({ message: 'new row violates row-level security policy' }).message, 'You do not have permission to do that.');
  assert.match(friendly({ message: 'Only the healthcare authority can decide applications', code: '42501' }).message, /Only the healthcare authority/);
  assert.match(friendly(new TypeError('Failed to fetch')).message, /Cannot reach the server/);
  assert.match(friendly({ message: 'Invalid login credentials' }).message, /incorrect/);
});

test('sign-up refuses privileged roles before contacting the server', async () => {
  await assert.rejects(signUp({}, { email: 'a@b.c', password: 'longenough', role: 'authority' }), /Only patient, hospital staff or doctor/);
});

test('rows built from the engine carry patch channels and NaN as null', () => {
  const d = generateSession(getScenario('multi_failure'), 1);
  const o = observationRow('s1', d, 150, ['chest', 'motion']);
  assert.equal(o.acoustic, null);
  assert.equal(o.chest.length, 10);
  const r = analyzeUpTo(d, 190).at(-1);
  const row = analysisRow('s1', r, {});
  assert.equal(row.outcome, 'insufficient');
  assert.equal(row.channel_quality.chest.usable, false);
});

test('report is marked synthetic and lists alerts and analysis', () => {
  const html = buildReportHtml({ session: { id: 'abcdef12', patch: 'quick', channels: ['chest', 'motion'], scenario_id: 'walking', seed: 1, started_at: '2026-10-26T10:00:00Z', stopped_at: null }, analysis: [{ window_end: 30, outcome: 'insufficient', rate: null, activity: 'walking', quality: 0.2, reason: 'No trustworthy reading' }], alerts: [{ created_at: '2026-10-26T10:00:30Z', category: 'insufficient', window_end: 30, explanation: 'x', acknowledged_at: null }], observation_seconds: 30, generated_at: '2026-10-26T10:01:00Z' });
  assert.ok(html.split('SYNTHETIC DATA — NOT FOR CLINICAL USE').length >= 3);
  assert.match(html, /BreatheGuard Quick/);
  assert.match(html, /not clinical warnings/);
});

test('AI request: guarded system prompt, minimal synthetic summary, input limits', () => {
  const sum = summarizeReport({ session: { patch: 'care', channels: ['chest'], scenario_id: 'walking' }, analysis: [{ window_end: 30, outcome: 'within', rate: 14, reason: 'ok' }], alerts: [] });
  const req = buildAssistantRequest({ question: 'What does this mean?', summary: sum, model: 'm' });
  assert.match(req.system, /SYNTHETIC/); assert.match(req.system, /Never diagnose/); assert.match(req.system, /emergency services or a clinician/); assert.match(req.system, /never prescribe/);
  assert.match(req.messages[0].content, /synthetic/);
  assert.throws(() => buildAssistantRequest({ question: 'x'.repeat(900), model: 'm' }), /under 800/);
  assert.throws(() => buildAssistantRequest({ question: '  ', model: 'm' }), /Ask a question/);
});

test('AI request: history is kept in alternating order, starting with the user', () => {
  const req = buildAssistantRequest({ question: 'next?', model: 'm', history: [{ role: 'assistant', content: 'orphan' }, { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2-unanswered' }] });
  assert.deepEqual(req.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(req.messages.at(-1).content, /q2-unanswered[\s\S]*next\?/);
});
