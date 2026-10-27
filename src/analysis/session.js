// Runs the engine over a generated session: a 30 s window every 10 s.
import { analyzeWindow, DEFAULT_BASELINE } from './engine.js';

export const WINDOW_SEC = 30;
export const STEP_SEC = 10;

export function sliceWindow(data, tEnd, windowSec = WINDOW_SEC) {
  const fs = data.fs;
  const i1 = Math.round(tEnd * fs), i0 = Math.max(0, i1 - windowSec * fs);
  return {
    fs, t0: i0 / fs, t1: i1 / fs,
    chest: data.chest.slice(i0, i1), acoustic: data.acoustic.slice(i0, i1),
    accel: data.accel.slice(i0, i1), tilt: data.tilt.slice(i0, i1),
  };
}

export function analyzeUpTo(data, tNow, baseline = DEFAULT_BASELINE, opts = {}) {
  const results = [];
  for (let t = WINDOW_SEC; t <= tNow + 1e-9; t += STEP_SEC) results.push(analyzeWindow(sliceWindow(data, t), baseline, opts));
  return results;
}

export const analyzeSession = (data, baseline, opts) => analyzeUpTo(data, data.durationSec, baseline, opts);

// Derive a personal baseline from windows confidently "within" and at rest.
export function deriveBaseline(results) {
  const ok = results.filter((r) => r.outcome === 'within' && r.activity.dominant === 'rest' && r.confidence > 0.5);
  if (ok.length < 3) return null;
  const rates = ok.map((r) => r.rate);
  const m = rates.reduce((s, v) => s + v, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, rates.length - 1));
  return { rate: +m.toFixed(1), sd: +Math.max(1, sd).toFixed(1), source: `Derived from ${ok.length} reliable resting windows` };
}
