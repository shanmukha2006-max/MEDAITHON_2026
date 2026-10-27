// BreatheGuard analysis engine (rule-based, transparent, NOT clinically validated).
//
// Pipeline for one analysis window (default 30 s):
//   1. Activity context from accelerometer + tilt  → per-second labels, exclusion mask
//   2. Per-channel processing (chest, acoustic)     → rate, variability, quality (SQI)
//   3. Quality-weighted fusion + conflict check     → fused rate or "no reliable estimate"
//   4. Expected range from personal baseline + activity
//   5. Two competing explanations scored as evidence (movement artefact vs genuine change)
//   6. Outcome: within | concerning | insufficient
// Signal quality and respiratory concern are computed separately: poor quality can
// only ever lead to "insufficient", never to "within".
import { mean, std, median, clamp, fillGaps, breathingBand, powerSpectrum, breathOnsets } from './dsp.js';

export const OUTCOMES = {
  within: { key: 'within', label: 'Within expected simulated range' },
  concerning: { key: 'concerning', label: 'Potentially concerning respiratory pattern' },
  insufficient: { key: 'insufficient', label: 'Insufficient reliable data' },
};

export const DEFAULT_BASELINE = { rate: 14, sd: 1.5, source: 'Default demo baseline' };

export const CONFIG = {
  sqiReliable: 0.45,          // min quality to use a channel when both channels are available
  sqiSingle: 0.75,            // stricter minimum when a conclusion rests on one channel alone
  corroboration: 0.6,         // chest–acoustic correlation above this = they see the same breaths
  conflictBpm: 4,              // channels disagreeing by more than this = conflict
  conflictRel: 0.2,
  minBreaths: 4,               // need at least this many clean intervals
  restIrregularCv: 0.25,       // breath-interval CV above this at rest is notable
  restHalfWidth: 6,            // expected range at rest: baseline ± max(6, 3·sd)
  walkLow: 4, walkHigh: 10,    // expected range while walking: baseline −4 … +10
  motionPenalty: { chest: { walking: 0.4, fidget: 0.55 }, acoustic: { walking: 0.9, fidget: 0.85 } },
};

// ---------- 1. Activity context ----------
export function activityContext(accel, tilt, acoustic, fs) {
  const secs = Math.floor(accel.length / fs);
  const labels = [];
  const segStd = [], segMax = [], segZc = [];
  for (let s = 0; s < secs; s++) {
    const seg = accel.slice(s * fs, (s + 1) * fs);
    segStd.push(std(seg));
    segMax.push(Math.max(...seg.map(Math.abs)));
  }
  const acMed = median(acoustic.filter(Number.isFinite)) || 0;
  for (let s = 0; s < secs; s++) {
    const a = Math.max(0, s - 1), b = Math.min(secs, s + 2);
    const seg3 = accel.slice(a * fs, b * fs);
    const sd3 = std(seg3);
    let zc = 0;
    const m3 = mean(seg3);
    for (let i = 1; i < seg3.length; i++) if ((seg3[i - 1] - m3) * (seg3[i] - m3) < 0) zc++;
    const zcRate = zc / ((b - a) || 1);
    segZc.push(zcRate);
    const tPrev = tilt[Math.max(0, (s - 1) * fs)], tNext = tilt[Math.min(tilt.length - 1, (s + 2) * fs - 1)];
    const acSeg = acoustic.slice(s * fs, (s + 1) * fs).filter(Number.isFinite);
    const acBurst = acSeg.length ? Math.max(...acSeg) > Math.max(1.0, acMed * 4) : false;
    let label = 'rest';
    if (Math.abs(tNext - tPrev) > 15) label = 'posture';
    else if (sd3 > 0.08 && zcRate >= 2 && zcRate <= 6) label = 'walking';
    else if (segMax[s] > 0.3 && sd3 < 0.25) label = acBurst ? 'cough' : 'impact';
    else if (sd3 > 0.03) label = 'fidget';
    labels.push(label);
  }
  // Cough/impact seconds inside a walking run are part of the gait
  for (let s = 1; s < secs - 1; s++) {
    if ((labels[s] === 'impact') && labels[s - 1] === 'walking' && labels[s + 1] === 'walking') labels[s] = 'walking';
  }
  // Exclusion mask: transient events corrupt nearby samples
  const exclude = new Array(accel.length).fill(false);
  labels.forEach((l, s) => {
    const pad = l === 'posture' ? 1 : l === 'cough' || l === 'impact' ? 1 : 0;
    if (pad) {
      for (let i = Math.max(0, (s - pad) * fs); i < Math.min(accel.length, (s + 1 + pad) * fs); i++) exclude[i] = true;
    }
  });
  const count = (k) => labels.filter((l) => l === k).length;
  const frac = (k) => count(k) / (secs || 1);
  // events = runs of identical transient labels
  const events = [];
  labels.forEach((l, s) => {
    if (l !== 'rest' && l !== 'walking' && l !== 'fidget' && labels[s - 1] !== l) events.push({ t: s, type: l });
  });
  const dominant = frac('walking') > 0.3 ? 'walking' : frac('fidget') > 0.3 ? 'fidget' : 'rest';
  return { labels, exclude, dominant, walkingFrac: frac('walking'), fidgetFrac: frac('fidget'), events, excludedFrac: exclude.filter(Boolean).length / (exclude.length || 1) };
}

// ---------- 2. Per-channel processing ----------
export function analyzeChannel(raw, exclude, fs, name) {
  const n = raw.length;
  const missingMask = raw.map((v) => !Number.isFinite(v));
  const missingFrac = missingMask.filter(Boolean).length / n;
  const issues = [];
  if (missingFrac > 0.3) {
    issues.push(`${Math.round(missingFrac * 100)}% of samples missing (signal dropout)`);
    return { name, usable: false, sqi: 0, rate: null, cv: null, missingFrac, flatline: false, bandRatio: 0, issues, processed: [] };
  }
  // flatline: fraction of 1-s segments with essentially no variation
  let flatSegs = 0, segs = 0;
  for (let s = 0; s + fs <= n; s += fs) {
    const seg = raw.slice(s, s + fs).filter(Number.isFinite);
    if (seg.length > fs / 2) { segs++; if (std(seg) < 0.01) flatSegs++; }
  }
  const flatline = segs > 0 && flatSegs / segs > 0.3;
  if (flatline) {
    issues.push(`Signal flat for ${Math.round((flatSegs / segs) * 100)}% of the window (sensor detached or failed)`);
    return { name, usable: false, sqi: 0, rate: null, cv: null, missingFrac, flatline, bandRatio: 0, issues, processed: [] };
  }
  const masked = raw.map((v, i) => (exclude[i] ? NaN : v));
  const filled = fillGaps(masked);
  const bp = breathingBand(filled, fs);
  const invalid = masked.map((v) => !Number.isFinite(v));
  const bpZeroed = bp.map((v, i) => (invalid[i] ? 0 : v));

  // spectral purity: share of power inside 0.1–0.7 Hz (6–42 breaths/min)
  const spec = powerSpectrum(bpZeroed, fs, 0.05, 3, 1 / 30);
  let inBand = 0, outBand = 0, peak = { f: 0, p: 0 };
  for (const { f, p } of spec) {
    if (f >= 0.1 && f <= 0.7) { inBand += p; if (p > peak.p) peak = { f, p }; }
    else if (f > 0.7) outBand += p;
  }
  const bandRatio = inBand / (inBand + outBand || 1);

  // breath intervals, discarding any interval that spans excluded/missing data
  const onsets = breathOnsets(bp, 0.3, Math.round(1.4 * fs));
  const intervals = [];
  for (let k = 1; k < onsets.length; k++) {
    let clean = true;
    for (let i = onsets[k - 1]; i <= onsets[k]; i++) if (invalid[i]) { clean = false; break; }
    if (clean) intervals.push((onsets[k] - onsets[k - 1]) / fs);
  }
  // periodicity: best normalised autocorrelation at breathing lags (1.4–7.5 s).
  // Quasi-periodic breathing scores high; in-band noise (fidgeting, talking) scores low.
  let periodicity = 0;
  {
    const x = bpZeroed, m = mean(x);
    let den = 0; for (const v of x) den += (v - m) ** 2;
    for (let lag = Math.round(1.4 * fs); lag <= Math.round(7.5 * fs); lag++) {
      let num = 0; for (let i = 0; i + lag < x.length; i++) num += (x[i] - m) * (x[i + lag] - m);
      const r = den ? (num / den) * (x.length / (x.length - lag)) : 0;
      if (r > periodicity) periodicity = r;
    }
  }
  const rate = intervals.length ? 60 / median(intervals) : null;
  const cv = intervals.length >= 3 ? std(intervals) / mean(intervals) : null;
  const spectralRate = peak.f * 60;

  const invalidFrac = invalid.filter(Boolean).length / n;
  let baseQ = (1 - invalidFrac) * clamp((bandRatio - 0.35) / 0.45);
  const perQ = clamp((periodicity - 0.3) / 0.45); // clean breathing ≈ 1.0; noise-corrupted ≈ 0.4–0.6
  let sqi = baseQ * perQ;
  if (periodicity < 0.5) issues.push(`Weak breathing rhythm (periodicity ${periodicity.toFixed(2)}); signal may be dominated by noise`);
  if (bandRatio < 0.6) issues.push(`Only ${Math.round(bandRatio * 100)}% of signal power is in the breathing band (likely movement contamination)`);
  if (intervals.length < CONFIG.minBreaths) {
    const pen = intervals.length >= 3 ? 0.6 : 0.3;
    sqi *= pen; baseQ *= pen;
    issues.push(`Only ${intervals.length} clean breath intervals detected`);
  }
  if (invalidFrac > 0.15) issues.push(`${Math.round(invalidFrac * 100)}% of window excluded or missing`);

  return { name, usable: true, sqi, baseQ, perQ, rate, cv, spectralRate, periodicity, missingFrac, invalidFrac, flatline, bandRatio, nIntervals: intervals.length, issues, processed: bp };
}

// Naive comparator: chest sensor only, no quality checks, no activity context.
export function naiveEstimate(chest, fs) {
  const filled = fillGaps(chest);
  const bp = breathingBand(filled, fs);
  const on = breathOnsets(bp, 0.3, Math.round(1.4 * fs));
  const iv = [];
  for (let k = 1; k < on.length; k++) iv.push((on[k] - on[k - 1]) / fs);
  const rate = iv.length ? 60 / median(iv) : null;
  const flag = rate == null ? 'no reading' : rate > 20 || rate < 8 ? 'alarm' : 'normal';
  return { rate, flag };
}

// ---------- 3–6. Full window analysis ----------
// channels: which sensors the selected patch has fitted (Care: all three; Quick: chest + motion)
export const ALL_CHANNELS = { chest: true, acoustic: true, motion: true };

const notFitted = (name) => ({ name, fitted: false, usable: false, reliable: false, sqi: 0, baseQ: 0, perQ: 0, rate: null, cv: null, issues: ['Not fitted on this patch'], processed: [] });

export function analyzeWindow(win, baseline = DEFAULT_BASELINE, opts = {}) {
  const fitted = { ...ALL_CHANNELS, ...(opts.channels || {}) };
  const { fs, chest, acoustic, accel, tilt } = win;
  // Movement context needs a working motion sensor. Without it we cannot tell
  // whether a disturbance comes from movement, so the engine must say so.
  const motionMissing = accel.filter((v) => !Number.isFinite(v)).length / (accel.length || 1);
  const motionOk = fitted.motion && motionMissing <= 0.3;
  const ctx = motionOk
    ? activityContext(fillGaps(accel), fillGaps(tilt), acoustic, fs)
    : { labels: new Array(Math.floor(accel.length / fs)).fill('unknown'), exclude: new Array(accel.length).fill(false), dominant: 'unknown', walkingFrac: 0, fidgetFrac: 0, events: [], excludedFrac: 0 };
  ctx.motionOk = motionOk;
  const ch = {
    chest: fitted.chest ? { fitted: true, ...analyzeChannel(chest, ctx.exclude, fs, 'chest') } : notFitted('chest'),
    acoustic: fitted.acoustic ? { fitted: true, ...analyzeChannel(acoustic, ctx.exclude, fs, 'acoustic') } : notFitted('acoustic'),
  };
  // cross-sensor corroboration: independent sensors seeing the same breaths is strong
  // evidence that an irregular rhythm is real breathing rather than noise
  const corr = crossCorrelation(ch.chest, ch.acoustic, fs);
  ctx.corroboration = corr;
  if (corr != null && corr >= CONFIG.corroboration) {
    for (const c of [ch.chest, ch.acoustic]) c.sqi = c.baseQ * Math.max(c.perQ, clamp((corr - 0.4) / 0.4));
  }
  // context-dependent quality: chest-wall motion is very sensitive to body movement
  for (const k of ['chest', 'acoustic']) {
    const c = ch[k];
    c.rawSqi = c.sqi;
    const pen = CONFIG.motionPenalty[k];
    const w = ctx.walkingFrac, f = ctx.fidgetFrac;
    let mult = 1 - w * (1 - pen.walking) - f * (1 - pen.fidget);
    if (!motionOk) {
      mult = k === 'chest' ? 0.6 : 0.9; // unknown movement: chest motion cannot be trusted as much
      if (c.usable) c.issues.push('Movement sensor unavailable, so movement artefacts cannot be ruled out');
    }
    c.sqi = c.sqi * clamp(mult);
    if (c.usable && motionOk && mult < 0.8) c.issues.push(`Quality reduced: ${k === 'chest' ? 'chest motion' : 'acoustic'} is affected by ${ctx.dominant === 'walking' ? 'walking' : 'body movement'}`);
    c.reliable = c.usable && c.sqi >= CONFIG.sqiReliable && c.rate != null;
  }
  // a conclusion from one channel alone needs stronger quality
  const prelim = Object.values(ch).filter((c) => c.reliable);
  if (prelim.length === 1 && prelim[0].sqi < CONFIG.sqiSingle) {
    prelim[0].reliable = false;
    prelim[0].issues.push(`Quality ${prelim[0].sqi.toFixed(2)} is too low to rely on this channel alone (needs ${CONFIG.sqiSingle})`);
  }

  // expected range from personal baseline + activity
  const hw = Math.max(CONFIG.restHalfWidth, 3 * baseline.sd);
  const range = ctx.dominant === 'walking'
    ? { lo: Math.max(8, baseline.rate - CONFIG.walkLow), hi: baseline.rate + CONFIG.walkHigh, context: 'walking' }
    : { lo: Math.max(8, baseline.rate - hw), hi: baseline.rate + hw, context: ctx.dominant === 'fidget' ? 'restless' : ctx.dominant === 'unknown' ? 'unknown activity' : 'rest' };
  // with unknown activity, a moderate rise could just be activity: track the walking ceiling too
  const activityCeiling = baseline.rate + CONFIG.walkHigh;

  const rangeFor = range;
  const reliable = Object.values(ch).filter((c) => c.reliable);
  const evidence = { artefact: [], genuine: [], uncertainty: [] };
  let fusedRate = null, fusedCv = null, conflict = false;

  if (reliable.length === 2) {
    const [a, b] = reliable;
    const diff = Math.abs(a.rate - b.rate);
    const tol = Math.max(CONFIG.conflictBpm, CONFIG.conflictRel * Math.min(a.rate, b.rate));
    if (diff > tol) {
      if (Math.abs(a.sqi - b.sqi) >= 0.25) {
        const best = a.sqi > b.sqi ? a : b, worst = best === a ? b : a;
        fusedRate = best.rate; fusedCv = best.cv;
        evidence.artefact.push(`${cap(worst.name)} reads ${worst.rate.toFixed(1)}/min but ${best.name} (higher quality) reads ${best.rate.toFixed(1)}/min; lower-quality reading discarded`);
      } else if (sideOf(a.rate, rangeFor) === sideOf(b.rate, rangeFor)) {
        const ws = a.sqi + b.sqi;
        fusedRate = (a.rate * a.sqi + b.rate * b.sqi) / ws;
        fusedCv = Math.max(a.cv ?? 0, b.cv ?? 0) || null;
        evidence.uncertainty.push(`Channels differ on the exact rate (${a.rate.toFixed(1)} vs ${b.rate.toFixed(1)}/min) but agree on the conclusion; exact value is uncertain`);
      } else {
        conflict = true;
        evidence.uncertainty.push(`Chest (${ch.chest.rate.toFixed(1)}/min) and acoustic (${ch.acoustic.rate.toFixed(1)}/min) disagree by ${diff.toFixed(1)}/min with similar quality`);
      }
    } else {
      const ws = a.sqi + b.sqi;
      fusedRate = (a.rate * a.sqi + b.rate * b.sqi) / ws;
      fusedCv = a.cv != null && b.cv != null ? (a.cv * a.sqi + b.cv * b.sqi) / ws : a.cv ?? b.cv;
      evidence.genuine.push(`Chest and acoustic channels agree (${a.rate.toFixed(1)} vs ${b.rate.toFixed(1)}/min)`);
    }
  } else if (reliable.length === 1) {
    fusedRate = reliable[0].rate; fusedCv = reliable[0].cv;
    const other = reliable[0].name === 'chest' ? ch.acoustic : ch.chest;
    evidence.uncertainty.push(`Only the ${reliable[0].name} channel is reliable; ${other.name} unusable (${other.issues[0] || 'low quality'})`);
  }

  // movement evidence (explains distortions, not breathing itself)
  if (!motionOk) evidence.uncertainty.push(fitted.motion ? 'Movement sensor has failed: the engine cannot tell whether the person is moving' : 'No movement sensor fitted');
  if (ctx.walkingFrac > 0.1) evidence.artefact.push(`Walking detected for ${Math.round(ctx.walkingFrac * 100)}% of the window`);
  if (ctx.fidgetFrac > 0.1) evidence.artefact.push(`Unstructured movement for ${Math.round(ctx.fidgetFrac * 100)}% of the window`);
  const coughs = ctx.events.filter((e) => e.type === 'cough').length;
  const postures = ctx.events.filter((e) => e.type === 'posture').length;
  if (corr != null && corr >= CONFIG.corroboration) evidence.genuine.push(`Chest and acoustic sensors show the same breath pattern (correlation ${corr.toFixed(2)})`);
  else if (corr != null && corr < 0.3 && ch.chest.usable && ch.acoustic.usable) evidence.uncertainty.push(`Chest and acoustic sensors do not show the same breath pattern (correlation ${corr.toFixed(2)})`);
  if (coughs) evidence.artefact.push(`${coughs} cough event${coughs > 1 ? 's' : ''} detected (motion + sound burst); surrounding samples excluded`);
  if (postures) evidence.artefact.push(`Posture change detected; transition excluded and baseline shift removed`);
  if (ch.chest.usable && ch.chest.bandRatio < 0.6) evidence.artefact.push(`Chest signal has ${Math.round((1 - ch.chest.bandRatio) * 100)}% of its power outside the breathing band`);

  const naive = naiveEstimate(chest, fs);
  if (naive.flag === 'alarm' && fusedRate != null && fusedRate >= range.lo && fusedRate <= range.hi) {
    evidence.artefact.push(`A chest-only reading (${naive.rate.toFixed(1)}/min) would look abnormal, but higher-quality evidence does not support it`);
  }

  // genuine-change evidence
  let deviation = 0;
  if (fusedRate != null) {
    if (fusedRate > range.hi) deviation = fusedRate - range.hi;
    else if (fusedRate < range.lo) deviation = range.lo - fusedRate;
    if (deviation > 0) {
      evidence.genuine.push(`Breathing rate ${fusedRate.toFixed(1)}/min is outside the expected ${range.context} range (${range.lo.toFixed(0)}–${range.hi.toFixed(0)}/min, baseline ${baseline.rate}/min)`);
      if (range.context === 'walking') evidence.genuine.push('The rise exceeds what walking alone is expected to explain');
    }
    if (range.context !== 'walking' && fusedCv != null && fusedCv > CONFIG.restIrregularCv) {
      evidence.genuine.push(`Breath-to-breath timing is irregular (variability ${(fusedCv * 100).toFixed(0)}%) without movement to explain it`);
    }
  }

  // ---- decision ----
  let outcome, reason;
  if (conflict) {
    outcome = 'insufficient';
    reason = 'The sensors disagree and neither is clearly more trustworthy, so a movement artefact cannot be separated from a real change.';
  } else if (fusedRate == null) {
    outcome = 'insufficient';
    const why = Object.values(ch).map((c) => `${c.name}: ${c.fitted === false ? 'not fitted on this patch' : (c.issues[0] || 'quality too low').replace(/^./, (m) => m.toLowerCase())}`);
    reason = `No breathing sensor gave a trustworthy reading (${why.join('; ')}). This is not a normal result.`;
    if (ch.acoustic.fitted === false && ctx.dominant !== 'rest') reason += ' This patch has no second breathing sensor to cross-check against movement.';
  } else if (!motionOk && fusedRate > range.hi && fusedRate <= activityCeiling) {
    outcome = 'insufficient';
    reason = `Breathing reads ${fusedRate.toFixed(1)}/min, above the resting range, but the movement sensor is unavailable, so ordinary activity cannot be ruled out.`;
  } else {
    const irregular = range.context !== 'walking' && fusedCv != null && fusedCv > CONFIG.restIrregularCv;
    if (deviation > 1 || (deviation > 0 && irregular) || (irregular && fusedRate > baseline.rate + 3)) {
      outcome = 'concerning';
      reason = range.context === 'walking'
        ? 'Breathing is higher than activity explains, and the evidence comes from a channel that is robust to movement.'
        : 'Breathing differs from the personal baseline while at rest; movement does not explain it.';
    } else {
      outcome = 'within';
      reason = evidence.artefact.length
        ? 'Distortions in the window are explained by movement; reliable measurements are within the expected range.'
        : 'Reliable measurements are within the expected range.';
    }
  }

  // explanatory scores (heuristic weights, NOT probabilities)
  const artefactScore = clamp(0.35 * ctx.walkingFrac / 0.5 + 0.25 * ctx.fidgetFrac / 0.5 + 0.15 * (coughs + postures) + (ch.chest.usable ? 0.35 * (1 - ch.chest.bandRatio) : 0));
  const genuineScore = fusedRate == null ? 0 : clamp(deviation / 6 + (range.context !== 'walking' && fusedCv > CONFIG.restIrregularCv ? 0.35 : 0) + (reliable.length === 2 && !conflict ? 0.1 : 0));
  const quality = clamp(Math.max(0, ...Object.values(ch).map((c) => (c.reliable ? c.sqi : 0))) * (reliable.length === 2 ? 1 : 0.85));
  const confidence = outcome === 'insufficient' ? 0 : clamp(quality * (1 - (ctx.excludedFrac > 0.3 ? 0.3 : 0)));

  return {
    t0: win.t0, t1: win.t1,
    outcome, outcomeLabel: OUTCOMES[outcome].label, reason,
    rate: fusedRate, cv: fusedCv,
    quality, confidence,
    channels: {
      chest: strip(ch.chest), acoustic: strip(ch.acoustic),
      motion: { usable: true, sqi: 1, note: 'Motion sensor provides context only; it cannot measure breathing.' },
    },
    corroboration: corr,
    fitted, motionOk,
    activity: { dominant: ctx.dominant, labels: ctx.labels, events: ctx.events, walkingFrac: ctx.walkingFrac, fidgetFrac: ctx.fidgetFrac, excludedFrac: ctx.excludedFrac },
    range, baseline,
    hypotheses: { artefact: artefactScore, genuine: genuineScore },
    evidence, naive,
  };
}

function crossCorrelation(a, b, fs) {
  if (!a.usable || !b.usable || !a.processed.length || !b.processed.length) return null;
  const x = a.processed, y = b.processed, n = Math.min(x.length, y.length);
  const mx = mean(x), my = mean(y);
  let best = 0;
  const maxLag = Math.round(1.5 * fs);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = Math.max(0, -lag); i < Math.min(n, n - lag); i++) {
      const dx = x[i] - mx, dy = y[i + lag] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    if (r > best) best = r;
  }
  return best;
}
const sideOf = (r, rg) => (r > rg.hi ? 'above' : r < rg.lo ? 'below' : 'in');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const strip = ({ processed, ...rest }) => rest;
