// Small, dependency-free signal-processing helpers.
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
export const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
export const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Linear interpolation over NaN gaps (edges filled with nearest valid value).
export function fillGaps(x) {
  const y = x.slice();
  const n = y.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(y[i])) {
      if (last === -1 && i > 0) for (let j = 0; j < i; j++) y[j] = y[i];
      else if (last >= 0 && i - last > 1) {
        for (let j = last + 1; j < i; j++) y[j] = y[last] + ((y[i] - y[last]) * (j - last)) / (i - last);
      }
      last = i;
    }
  }
  if (last === -1) return y.fill(0);
  for (let j = last + 1; j < n; j++) y[j] = y[last];
  return y;
}

// Centred moving average with shrinking edges.
export function movingAverage(x, w) {
  const n = x.length, h = Math.floor(w / 2), out = new Array(n);
  const cs = [0];
  for (let i = 0; i < n; i++) cs.push(cs[i] + x[i]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
    out[i] = (cs[b] - cs[a]) / (b - a);
  }
  return out;
}

// Band-limit to the breathing band: remove slow baseline (8 s MA) and smooth (0.5 s MA).
export function breathingBand(x, fs) {
  const base = movingAverage(x, Math.round(8 * fs));
  const hp = x.map((v, i) => v - base[i]);
  return movingAverage(hp, Math.round(0.5 * fs));
}

// Power at a list of frequencies via direct DFT (windows are short, so this is cheap).
export function powerSpectrum(x, fs, fMin = 0.05, fMax = 3, df = null) {
  const n = x.length;
  const step = df || fs / n;
  const m = mean(x);
  const out = [];
  for (let f = fMin; f <= fMax + 1e-9; f += step) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      // Hann window to limit leakage
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += (x[i] - m) * h * Math.cos(w * i);
      im -= (x[i] - m) * h * Math.sin(w * i);
    }
    out.push({ f, p: (re * re + im * im) / n });
  }
  return out;
}

// Breath detection: upward crossings of zero with hysteresis (±k·σ).
// Returns indices of breath onsets. `valid[i]===false` marks excluded samples;
// intervals spanning excluded samples are discarded by the caller.
export function breathOnsets(x, k = 0.3, minGapSamples = 12) {
  const s = std(x);
  const hi = k * s, lo = -k * s;
  const onsets = [];
  let armed = false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < lo) armed = true;
    if (armed && x[i] > hi) {
      if (!onsets.length || i - onsets[onsets.length - 1] >= minGapSamples) onsets.push(i);
      armed = false;
    }
  }
  return onsets;
}
