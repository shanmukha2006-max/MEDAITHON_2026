import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, getScenario } from '../src/sim/scenarios.js';
import { generateSession } from '../src/sim/generator.js';
import { analyzeSession, analyzeUpTo } from '../src/analysis/session.js';
import { PATCHES } from '../src/sim/patches.js';
import { JUDGE_STEPS } from '../src/sim/judgeDemo.js';
import { explainResult } from '../src/analysis/explain.js';

const QUICK = { channels: PATCHES.quick.channels };

test('Quick reports the acoustic channel as not fitted, not as a failure', () => {
  const r = analyzeSession(generateSession(getScenario('normal_rest'), 1), undefined, QUICK).at(-1);
  assert.equal(r.channels.acoustic.fitted, false);
  assert.equal(r.channels.acoustic.issues[0], 'Not fitted on this patch');
  assert.equal(r.outcome, 'within');
});

test('SAFETY (Quick): never reports "within" when the label needs attention, across scenarios', () => {
  let unsafe = 0, n = 0;
  for (const sc of SCENARIOS) for (let seed = 1; seed <= 10; seed++) {
    for (const r of analyzeSession(generateSession(sc, seed), undefined, QUICK)) {
      const e = sc.expected(r.t1); if (e === 'any' || e === 'within') continue;
      n++; if (r.outcome === 'within') unsafe++;
    }
  }
  assert.ok(unsafe / n < 0.01, `${unsafe}/${n}`);
});

test('Quick is not confident while walking: it says insufficient rather than guessing', () => {
  const rs = analyzeSession(generateSession(getScenario('walking'), 1), undefined, QUICK).filter((r) => r.t1 >= 90 && r.t1 <= 160);
  assert.ok(rs.filter((r) => r.outcome === 'insufficient').length / rs.length > 0.6);
  assert.ok(!rs.some((r) => r.outcome === 'concerning'));
});

test('SAFETY: losing the motion sensor on Quick never yields reassurance', () => {
  for (const id of ['normal_rest', 'walking', 'hidden_change']) {
    for (const r of analyzeSession(generateSession(getScenario(id), 1, { failures: [{ sensor: 'motion', from: 0 }] }), undefined, QUICK)) {
      assert.equal(r.outcome, 'insufficient');
    }
  }
});

test('SAFETY: heavy noise shifts results to insufficient, never to false reassurance', () => {
  for (const id of ['irregular', 'hidden_change']) {
    const sc = getScenario(id);
    for (let seed = 1; seed <= 10; seed++) for (const r of analyzeSession(generateSession(sc, seed, { noise: 2 }))) {
      const e = sc.expected(r.t1);
      if (e === 'concerning') assert.notEqual(r.outcome, 'within', `${id} seed ${seed} t=${r.t1}`);
    }
  }
});

test('injected failures do not change signals before the failure', () => {
  const sc = getScenario('walking');
  const a = generateSession(sc, 5), b = generateSession(sc, 5, { failures: [{ sensor: 'acoustic', from: 100 }], noise: 0 });
  assert.deepEqual(a.chest.slice(0, 1000), b.chest.slice(0, 1000));
  assert.ok(Number.isNaN(b.acoustic[1200]));
});

test('every Judge Demo step lands on the outcome its narration claims', () => {
  for (const s of JUDGE_STEPS.filter((x) => !x.summary && !x.portal)) {
    const data = generateSession(getScenario(s.scenario), 1, { failures: s.failures || [] });
    const r = analyzeUpTo(data, s.to, undefined, { channels: PATCHES[s.patch].channels }).at(-1);
    assert.equal(r.outcome, s.expect, `step ${s.id}`);
  }
});

test('Judge Demo walking step: movement is detected and the chest-only monitor alarms', () => {
  const s = JUDGE_STEPS.find((x) => x.id === 'walk');
  const r = analyzeUpTo(generateSession(getScenario(s.scenario), 1), s.to).at(-1);
  assert.equal(r.activity.dominant, 'walking');
  assert.equal(r.channels.chest.reliable, false);
  assert.equal(r.naive.flag, 'alarm');
});

test('explanations exist for every outcome and mention the missing sensor on Quick', () => {
  const r = analyzeUpTo(generateSession(getScenario('walking'), 1), 120, undefined, QUICK).at(-1);
  const ex = explainResult(r, 'BreatheGuard Quick');
  assert.equal(ex.steps.length, 5);
  assert.match(ex.steps[0].a, /no second breathing sensor/);
  assert.ok(ex.verdict.length > 20);
});

test('Judge Demo portal steps: the narration’s claims are true in the demo data', async () => {
  const { createSeed } = await import('../src/data/seed.js');
  const A = await import('../src/data/actions.js');
  const st = createSeed();
  for (const s of JUDGE_STEPS.filter((x) => x.portal)) assert.ok(st.users.some((u) => u.id === s.portal.user), `${s.id} account exists`);
  // patient step: Dr. Priya Nair pending, hospital approved, not listed
  const nair = st.doctors.find((d) => d.name === 'Dr. Priya Nair');
  assert.equal(nair.status, 'pending');
  assert.equal(st.hospitals.find((h) => h.id === nair.hospitalId).status, 'approved');
  assert.ok(!A.visibleDoctors(st).some((d) => d.id === nair.id));
  // hospital step: Asha shared reports (and has one), Ben did not
  assert.ok(A.hasConsent(st, 'u_pat1', 'h_riverside', 'reports'));
  assert.ok(!A.hasConsent(st, 'u_pat2', 'h_riverside', 'reports'));
  assert.ok(st.reports.some((r) => r.patientId === 'u_pat1' && r.simulated));
  // authority step: Northgate pending
  assert.equal(st.hospitals.find((h) => h.id === 'h_northgate').status, 'pending');
});

test('Judge Demo covers the requested sequence in order', () => {
  const ids = JUDGE_STEPS.map((s) => s.id);
  const order = ['intro', 'rest', 'walk', 'irregular', 'failures', 'quick', 'portal-patient', 'portal-hospital', 'portal-authority', 'roadmap', 'summary'];
  let last = -1;
  for (const id of order) { const i = ids.indexOf(id); assert.ok(i > last, `${id} after previous`); last = i; }
});

test('inconclusive results say what evidence would help, matched to the cause', async () => {
  const { neededEvidence } = await import('../src/analysis/explain.js');
  const flat = analyzeUpTo(generateSession(getScenario('multi_failure'), 1), 190).at(-1);
  const n1 = neededEvidence(flat, 'BreatheGuard Care');
  assert.ok(n1.some((x) => x.includes('chest-motion') && x.includes('flat')));
  assert.ok(n1.some((x) => x.includes('acoustic') && x.includes('no data')));
  const qw = analyzeUpTo(generateSession(getScenario('walking'), 1), 120, undefined, QUICK).at(-1);
  assert.equal(qw.outcome, 'insufficient');
  assert.ok(neededEvidence(qw, 'BreatheGuard Quick').some((x) => x.includes('still') && x.includes('second breathing sensor')));
  const nm = analyzeUpTo(generateSession(getScenario('normal_rest'), 1, { failures: [{ sensor: 'motion', from: 0 }] }), 120, undefined, QUICK).at(-1);
  assert.ok(neededEvidence(nm, 'BreatheGuard Quick').some((x) => x.includes('movement data')));
  const ok = analyzeUpTo(generateSession(getScenario('normal_rest'), 1), 120).at(-1);
  assert.deepEqual(neededEvidence(ok), [], 'nothing suggested when the result is conclusive');
});
