// Checks that generated waveforms follow each scenario's definition (not random),
// that the simulator controls change the signals, and that Care and Quick give
// the engine different evidence from the SAME signals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/sim/scenarios.js';
import { generateSession, FS } from '../src/sim/generator.js';
import { analyzeUpTo } from '../src/analysis/session.js';
import { PATCHES } from '../src/sim/patches.js';
import { std, mean } from '../src/analysis/dsp.js';

const seg = (arr, t0, t1) => arr.slice(Math.round(t0 * FS), Math.round(t1 * FS));
const gen = (id, seed = 1, opts) => generateSession(getScenario(id), seed, opts);
const at = (data, t, patch = 'care') => analyzeUpTo(data, t, undefined, { channels: PATCHES[patch].channels }).at(-1);

test('walking shows in the movement signal only while walking (40–170 s)', () => {
  for (const seed of [1, 2, 3]) {
    const d = gen('walking', seed);
    const rest = std(seg(d.accel, 5, 35)), walk = std(seg(d.accel, 60, 160)), after = std(seg(d.accel, 180, 215));
    assert.ok(walk > 8 * rest && walk > 8 * after, `seed ${seed}: rest ${rest.toFixed(3)} walk ${walk.toFixed(3)} after ${after.toFixed(3)}`);
  }
});

test('coughs produce motion and sound bursts at the scripted times only', () => {
  const d = gen('coughing');
  for (const c of getScenario('coughing').coughs) {
    assert.ok(Math.max(...seg(d.accel, c, c + 0.5)) > 0.3, `motion burst at ${c}s`);
    assert.ok(Math.max(...seg(d.acoustic, c, c + 0.5)) > 1.5, `sound burst at ${c}s`);
  }
  assert.ok(Math.max(...seg(d.accel, 80, 105).map(Math.abs)) < 0.1, 'quiet between coughs');
});

test('posture change shows as a tilt step at 60 s and back at 125 s', () => {
  const d = gen('posture');
  assert.ok(Math.abs(mean(seg(d.tilt, 10, 55))) < 3);
  assert.ok(Math.abs(mean(seg(d.tilt, 70, 120)) - 70) < 3);
  assert.ok(Math.abs(mean(seg(d.tilt, 135, 175))) < 3);
});

test('engine rate tracks the simulator’s true rate when signals are clean', () => {
  const rest = at(gen('normal_rest'), 150);
  assert.ok(Math.abs(rest.rate - 14) < 1.5, `rest ${rest.rate}`);
  const rec = at(gen('recovery'), 230);
  assert.ok(Math.abs(rec.rate - 15) < 2, `recovered ${rec.rate}`);
  const early = at(gen('recovery'), 60);
  assert.ok(early.rate > 22, `before recovery ${early.rate}`);
});

test('irregular scenario: breath timing becomes more variable after 60 s', () => {
  const d = gen('irregular');
  const before = at(d, 60), after = at(d, 160);
  assert.ok(after.cv > before.cv * 4 && after.rate > before.rate + 6, `cv ${before.cv?.toFixed(2)}→${after.cv?.toFixed(2)} rate ${before.rate.toFixed(1)}→${after.rate.toFixed(1)}`);
});

test('hidden change: rate rises while still walking', () => {
  const r = at(gen('hidden_change'), 180);
  assert.equal(r.activity.dominant, 'walking');
  assert.ok(r.rate > 24, `rate ${r.rate}`);
});

test('failures: chest goes flat, acoustic goes missing, at the scripted times', () => {
  const d = gen('multi_failure');
  assert.ok(std(seg(d.chest, 10, 45)) > 0.3, 'chest alive before 50 s');
  assert.ok(std(seg(d.chest, 60, 190)) < 0.01, 'chest flat after 50 s');
  assert.ok(seg(d.acoustic, 10, 95).every(Number.isFinite), 'acoustic present before 100 s');
  assert.ok(seg(d.acoustic, 105, 195).every((v) => Number.isNaN(v)), 'acoustic missing after 100 s');
});

test('ambiguous scenario has weak rhythm on both breathing sensors', () => {
  const r = at(gen('ambiguous'), 120);
  assert.ok(r.channels.chest.periodicity < 0.6 || r.channels.acoustic.periodicity < 0.6);
  assert.equal(r.outcome, 'insufficient');
});

test('same scenario, different seeds: different noise, same structure', () => {
  const a = gen('walking', 1), b = gen('walking', 9);
  assert.notDeepEqual(seg(a.chest, 0, 5), seg(b.chest, 0, 5));
  const ra = std(seg(a.accel, 60, 160)), rb = std(seg(b.accel, 60, 160));
  assert.ok(Math.abs(ra - rb) / ra < 0.25, `walking movement similar across seeds (${ra.toFixed(3)} vs ${rb.toFixed(3)})`);
});

test('movement control scales movement artefacts and lowers chest quality', () => {
  const lo = gen('walking', 1, { movement: 0.5 }), hi = gen('walking', 1, { movement: 2 });
  assert.ok(std(seg(hi.accel, 60, 160)) > 3 * std(seg(lo.accel, 60, 160)));
  assert.ok(at(hi, 120).channels.chest.sqi <= at(lo, 120).channels.chest.sqi);
  // breathing itself is not changed by the movement control
  assert.deepEqual(seg(gen('normal_rest', 1, { movement: 0.5 }).chest, 0, 30), seg(gen('normal_rest', 1, { movement: 2 }).chest, 0, 30));
});

test('noise control degrades signal quality and never creates reassurance', () => {
  const clean = at(gen('normal_rest', 2), 120), noisy = at(gen('normal_rest', 2, { noise: 2 }), 120);
  assert.ok(noisy.channels.chest.periodicity < clean.channels.chest.periodicity);
  assert.ok(noisy.quality < clean.quality);
  const mf = at(gen('multi_failure', 2, { noise: 2 }), 190);
  assert.equal(mf.outcome, 'insufficient');
});

test('Care and Quick receive different evidence from identical signals', () => {
  const d = gen('walking', 1);
  const care = at(d, 120, 'care'), quick = at(d, 120, 'quick');
  assert.equal(care.channels.acoustic.fitted, true);
  assert.equal(quick.channels.acoustic.fitted, false);
  assert.ok(care.channels.acoustic.reliable);
  assert.equal(quick.corroboration, null);
  assert.notEqual(care.outcome, quick.outcome);
});
