import { createSeed } from './seed.js';

// Repair saved data from older versions or interrupted saves: every section the
// app expects must exist with the right type. If the core records are unusable,
// start again from the demo seed rather than showing broken pages.
export function repairState(raw) {
  const seed = createSeed();
  if (!raw || typeof raw !== 'object') return { state: seed, repaired: true };
  const core = ['users', 'hospitals', 'doctors'];
  if (core.some((k) => !Array.isArray(raw[k]) || raw[k].length === 0)) return { state: seed, repaired: true };
  const out = { ...raw };
  let repaired = false;
  for (const [k, v] of Object.entries(seed)) {
    const ok = Array.isArray(v) ? Array.isArray(out[k]) : typeof v === 'object' && v !== null ? out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) : out[k] !== undefined;
    if (!ok) { out[k] = Array.isArray(v) ? [] : typeof v === 'object' && v !== null ? {} : v; repaired = true; }
  }
  return { state: out, repaired };
}

