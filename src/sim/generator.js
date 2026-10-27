// Synthetic multi-sensor generator. Produces, at FS Hz:
//  chest    – chest-wall displacement (arbitrary units), breathing + artefacts
//  acoustic – breath-sound energy envelope (arbitrary units)
//  accel    – dynamic acceleration magnitude (g, gravity removed)
//  tilt     – trunk tilt from upright (degrees)
// plus per-second ground truth (true rate, activity label) for the timeline/tests.
// NaN = no sample (dropout). All values are synthetic, not physiological recordings.
//
// Options (all optional, used by the interactive simulator controls):
//   movement: 0–2   scales every movement artefact (walking, fidgeting, coughs, posture jolts). 1 = scenario default.
//   noise:    0–2   adds extra sensor noise to chest and acoustic channels (0 = none).
//   failures: [{ sensor: 'chest'|'acoustic'|'motion', from: seconds, to?: seconds }]  extra failures injected live (to = reconnected).
// Extra noise and failure noise use separate random streams, so changing them never
// alters the underlying breathing or movement that came before.
import { createRng } from './rng.js';

export const FS = 10;

const inRanges = (t, ranges = []) => ranges.find((r) => t >= r.from && t < r.to);

export function generateSession(scenario, seed = 1, opts = {}) {
  const movement = opts.movement ?? 1;
  const noise = opts.noise ?? 0;
  const failures = [...(scenario.failures || []), ...(opts.failures || [])];
  const rng = createRng(seed * 7919 + scenario.id.length * 131);
  const noiseRng = createRng(seed * 104729 + 17);
  const failRng = createRng(seed * 15485863 + 29);
  let cn1 = 0, cn2 = 0;
  const n = Math.round(scenario.durationSec * FS);
  const dt = 1 / FS;
  const chest = new Array(n), acoustic = new Array(n), accel = new Array(n), tilt = new Array(n);
  const trueRate = [], truthActivity = [];

  let phase = rng.next() * Math.PI * 2;
  let breathMult = 1, breathAmpMult = 1;
  let sway = 0, fidget = 0, ambient = 0, drift = 0;
  let tiltNow = 0, chestOffset = 0, frozenChest = null;
  const gaitPhase0 = rng.next() * Math.PI * 2;
  const armPhase0 = rng.next() * Math.PI * 2;

  // posture state machine
  const postures = (scenario.postures || []).slice().sort((a, b) => a.t - b.t);

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const irr = scenario.irregularity ? scenario.irregularity(t) : 0;
    const rr = scenario.rr(t);
    const prevPhase = phase;
    phase += 2 * Math.PI * (rr / 60) * breathMult * dt;
    if (Math.floor(phase / (2 * Math.PI)) !== Math.floor(prevPhase / (2 * Math.PI))) {
      // new breath: irregular breathing varies each breath's duration and depth
      breathMult = irr > 0 ? Math.min(1.8, Math.max(0.55, 1 + irr * 0.35 * rng.normal())) : 1;
      breathAmpMult = irr > 0 ? Math.min(1.6, Math.max(0.4, 1 + irr * 0.3 * rng.normal())) : 1;
    }
    const A = scenario.amp(t) * breathAmpMult;
    const breath = A * Math.sin(phase);

    const act = inRanges(t, scenario.activity);
    const walking = act?.type === 'walking';
    const fidgeting = act?.type === 'fidget';

    // slow coloured noise sources
    sway = sway * 0.9 + rng.normal() * 0.33; // ~0.2–0.5 Hz in-band sway
    drift = drift * 0.999 + rng.normal() * 0.004;
    fidget = fidget * 0.85 + rng.normal() * (rng.next() < 0.04 ? 3 : 0.25);
    ambient = ambient * 0.8 + rng.normal() * 0.6;

    // posture transitions (2 s ramps)
    let postureTransient = 0;
    for (const p of postures) {
      if (t >= p.t + 2) {
        // transition finished: settle exactly on the new posture
        tiltNow = p.tilt;
        chestOffset = (p.tilt / 70) * 3.0;
      }
      if (t >= p.t && t < p.t + 2) {
        const frac = (t - p.t) / 2;
        const from = postures.indexOf(p) > 0 ? postures[postures.indexOf(p) - 1].tilt : 0;
        tiltNow = from + (p.tilt - from) * frac;
        postureTransient = 0.35 * Math.sin(Math.PI * frac);
        chestOffset = (p.tilt / 70) * 3.0 * frac + (from / 70) * 3.0 * (1 - frac);
      }
    }

    // coughs: 0.6 s bursts
    let cough = 0;
    for (const c of scenario.coughs || []) {
      if (t >= c && t < c + 0.6) cough = Math.exp(-(t - c) * 6);
    }

    // ---- chest motion ----
    let c = breath + chestOffset + drift + 0.04 * rng.normal();
    let art = 0; // movement artefact on chest, scaled by movement intensity
    if (walking) {
      art += 2.2 * Math.sin(2 * Math.PI * 0.9 * t + armPhase0) + 1.1 * Math.sin(2 * Math.PI * 1.8 * t + gaitPhase0) + 1.4 * sway;
    }
    if (fidgeting) art += 1.6 * fidget + 1.0 * sway;
    art += cough * 4.5 * (rng.next() > 0.5 ? 1 : -1) * 0.6 + cough * 2.2;
    art += postureTransient * 3;
    c += movement * art;

    // ---- acoustic envelope ----
    let a = 0.6 * A * (0.5 + 0.5 * Math.sin(phase - 0.4)) + 0.05 + 0.03 * Math.abs(rng.normal());
    if (walking) {
      const step = Math.max(0, Math.sin(2 * Math.PI * 1.8 * t + gaitPhase0));
      a += movement * 0.12 * step ** 8 + 0.04 * Math.abs(rng.normal());
    }
    const amb = inRanges(t, scenario.ambientNoise);
    if (amb) a += amb.level * (0.45 * Math.abs(ambient) + 0.35 * Math.abs(sway));
    a += movement * cough * 3.0;

    // ---- accelerometer ----
    let g = 0.008 * rng.normal();
    let ga = 0;
    if (walking) ga += 0.22 * Math.sin(2 * Math.PI * 1.8 * t + gaitPhase0) + 0.07 * Math.sin(2 * Math.PI * 0.9 * t + armPhase0) + 0.04 * rng.normal();
    if (fidgeting) ga += 0.12 * fidget;
    ga += cough * 0.55 + postureTransient;
    g += movement * ga;

    // ---- extra sensor noise (separate random stream) ----
    cn1 = cn1 * 0.85 + noiseRng.normal() * 0.3;
    cn2 = cn2 * 0.85 + noiseRng.normal() * 0.3;
    const w1 = noiseRng.normal(), w2 = noiseRng.normal();
    if (noise > 0) {
      c += noise * (1.1 * cn1 + 0.3 * w1);
      a += noise * (0.32 * Math.abs(cn2) + 0.08 * Math.abs(w2));
    }

    // ---- sensor failures ----
    let tiltOut = tiltNow + 0.5 * rng.normal();
    const fJitter = failRng.normal();
    let chestFailed = false;
    for (const f of failures) {
      if (t >= f.from && (f.to == null || t < f.to)) {
        if (f.sensor === 'chest') {
          chestFailed = true;
          if (frozenChest === null) frozenChest = c;
          c = frozenChest + 0.002 * fJitter;
        }
        if (f.sensor === 'acoustic') a = NaN;
        if (f.sensor === 'motion') { g = NaN; tiltOut = NaN; }
      }
    }
    if (!chestFailed) frozenChest = null; // sensor reconnected

    chest[i] = c;
    acoustic[i] = a;
    accel[i] = g;
    tilt[i] = tiltOut;

    if (i % FS === 0) {
      trueRate.push(+rr.toFixed(1));
      let label = 'rest';
      if (walking) label = 'walking';
      else if (fidgeting) label = 'fidget';
      if ((scenario.coughs || []).some((cc) => t >= cc - 0.5 && t < cc + 1)) label = 'cough';
      if (postures.some((p) => t >= p.t - 0.5 && t < p.t + 2.5)) label = 'posture';
      truthActivity.push(label);
    }
  }

  return {
    scenarioId: scenario.id,
    seed,
    fs: FS,
    durationSec: scenario.durationSec,
    chest, acoustic, accel, tilt,
    truth: { rate: trueRate, activity: truthActivity, failures },
    options: { movement, noise },
  };
}
