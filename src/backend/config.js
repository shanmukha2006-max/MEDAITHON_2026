// Backend configuration.
// 1. Build time: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (read by Vite when `npm run build` runs,
//    so they must be set in the host BEFORE building).
// 2. Runtime (no rebuild): a public file `/breatheguard-config.json` next to index.html:
//    { "supabaseUrl": "https://xxxx.supabase.co", "supabaseAnonKey": "eyJ..." }
// Build-time values win when both exist. Both values are PUBLIC by design: the anon key grants nothing
// by itself, because row-level security decides every read and write. Never put the service-role key
// or an AI key in either place.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const cfg = { url: env.VITE_SUPABASE_URL || '', key: env.VITE_SUPABASE_ANON_KEY || '', source: env.VITE_SUPABASE_URL ? 'build' : 'none', runtimeError: '' };

export const SYNTHETIC_LABEL = 'SYNTHETIC DATA — NOT FOR CLINICAL USE';
export const getConfig = () => ({ ...cfg });
export const isConfigured = () => Boolean(cfg.url && cfg.key);

export function validateConfig(url, key) {
  const problems = [];
  if (!url) problems.push('Supabase project URL is missing (VITE_SUPABASE_URL).');
  else if (!/^https?:\/\/[^\s/]+/.test(url)) problems.push(`Supabase URL “${url}” is not a web address.`);
  if (!key) problems.push('Supabase anon (public) key is missing (VITE_SUPABASE_ANON_KEY).');
  else if (/service_role/.test(atobSafe(key.split('.')[1] || ''))) problems.push('The key provided is a SERVICE-ROLE key. Never put it in the app; use the anon (public) key.');
  return problems;
}
function atobSafe(s) { try { return typeof atob === 'function' ? atob(s.replace(/-/g, '+').replace(/_/g, '/')) : Buffer.from(s, 'base64').toString(); } catch { return ''; } }

// Load /breatheguard-config.json when no build-time values exist. Never throws.
export async function loadRuntimeConfig(fetchImpl = typeof fetch === 'function' ? fetch : null, base = '') {
  if (cfg.source === 'build' || !fetchImpl) return getConfig();
  cfg.runtimeError = ''; // a fresh load starts clean
  try {
    const r = await fetchImpl(`${base}/breatheguard-config.json`, { cache: 'no-store' });
    if (!r.ok) return getConfig(); // no file: not configured (normal for local demo)
    // Many hosts answer a missing file with the app's index.html (single-page-app fallback).
    // That is "no config file", not a broken one.
    const text = await r.text();
    if (!text.trim().startsWith('{')) return getConfig();
    const j = JSON.parse(text);
    const url = String(j.supabaseUrl || '').trim().replace(/\/+$/, ''), key = String(j.supabaseAnonKey || '').trim();
    const problems = validateConfig(url, key);
    if (problems.some((p) => p.includes('SERVICE-ROLE'))) { cfg.runtimeError = problems.join(' '); return getConfig(); }
    Object.assign(cfg, { url, key, source: 'runtime' });
  } catch { cfg.runtimeError = '/breatheguard-config.json exists but is not valid JSON.'; }
  return getConfig();
}
