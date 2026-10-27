import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, getScenario } from '../src/sim/scenarios.js';
import { generateSession } from '../src/sim/generator.js';
import { analyzeSession, deriveBaseline } from '../src/analysis/session.js';

const run = (id, seed = 1) => analyzeSession(generateSession(getScenario(id), seed));

test('generator is reproducible for the same seed', () => {
  const a = generateSession(getScenario('walking'), 7), b = generateSession(getScenario('walking'), 7);
  assert.deepEqual(a.chest.slice(0, 500), b.chest.slice(0, 500));
  const c = generateSession(getScenario('walking'), 8);
  assert.notDeepEqual(a.chest.slice(0, 500), c.chest.slice(0, 500));
});

test('normal rest is within range with a rate near 14/min', () => {
  for (const r of run('normal_rest')) {
    assert.equal(r.outcome, 'within');
    assert.ok(Math.abs(r.rate - 14) < 1.5, `rate ${r.rate}`);
  }
});

test('walking: naive chest-only estimate alarms, engine does not', () => {
  const rs = run('walking', 3).filter((r) => r.t1 >= 80 && r.t1 <= 160);
  assert.ok(rs.some((r) => r.naive.flag === 'alarm'), 'naive should be fooled at least once');
  for (const r of rs) assert.notEqual(r.outcome, 'concerning');
  for (const r of rs) assert.equal(r.activity.dominant, 'walking');
});

test('hidden change during walking is flagged while still walking', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const during = run('hidden_change', seed).filter((r) => r.t1 >= 150 && r.t1 <= 200);
    assert.ok(during.length > 0);
    for (const r of during) {
      assert.equal(r.activity.dominant, 'walking');
      assert.equal(r.outcome, 'concerning', `seed ${seed} t=${r.t1}`);
    }
  }
});

test('coughs are detected and excluded rather than counted', () => {
  const r = run('coughing').find((x) => x.t1 === 50);
  assert.ok(r.activity.events.some((e) => e.type === 'cough'));
  assert.equal(r.outcome, 'within');
});

test('single sensor failure degrades gracefully to the remaining channel', () => {
  for (const r of run('single_failure').filter((x) => x.t1 > 90)) {
    assert.equal(r.channels.chest.usable, false);
    assert.equal(r.outcome, 'within');
    assert.ok(r.evidence.uncertainty.some((e) => e.includes('Only the acoustic channel')));
  }
});

test('SAFETY: losing all breathing sensors never produces reassurance', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const r of run('multi_failure', seed).filter((x) => x.t1 > 130)) {
      assert.equal(r.outcome, 'insufficient', `seed ${seed} t=${r.t1}`);
      assert.equal(r.confidence, 0);
    }
  }
});

test('SAFETY: ambiguous signals are reported as within range in <2% of windows', () => {
  let within = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) for (const r of run('ambiguous', seed)) { n++; if (r.outcome === 'within') within++; }
  assert.ok(within / n < 0.02, `${within}/${n}`);
});

test('quality is reported separately from concern', () => {
  const r = run('multi_failure').at(-1);
  assert.equal(r.rate, null);
  assert.equal(r.outcome, 'insufficient');
  assert.ok(r.channels.chest.issues.length && r.channels.acoustic.issues.length);
});

test('recovery goes concerning → within', () => {
  const rs = run('recovery');
  assert.equal(rs[0].outcome, 'concerning');
  assert.equal(rs.at(-1).outcome, 'within');
});

test('a personal baseline can be derived from reliable resting windows', () => {
  const b = deriveBaseline(run('normal_rest'));
  assert.ok(b && Math.abs(b.rate - 14) < 1);
});

test('every scenario agrees with its labels in at least 95% of windows (seeds 1–10)', () => {
  for (const sc of SCENARIOS) {
    let agree = 0, n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const r of analyzeSession(generateSession(sc, seed))) {
        const e = sc.expected(r.t1);
        if (e === 'any') continue;
        n++; if (r.outcome === e) agree++;
      }
    }
    assert.ok(agree / n >= 0.95, `${sc.id}: ${agree}/${n}`);
  }
});
