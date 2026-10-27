import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBackend } from '../src/backend/status.js';
import { validateConfig, loadRuntimeConfig, getConfig } from '../src/backend/config.js';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const fakeFetch = (routes) => async (url) => { for (const [k, v] of Object.entries(routes)) if (url.includes(k)) { if (v instanceof Error) throw v; return typeof v === 'function' ? v() : v; } throw new Error('unexpected ' + url); };
const healthy = { ok: true, schema_version: 4, missing_tables: [], tables_without_rls: [], missing_functions: [], realtime_missing: [], authority_accounts: true };
const URL = 'https://abc.supabase.co', KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';

test('no settings → configuration required, naming what is missing', async () => {
  const r = await checkBackend({ url: '', key: '' });
  assert.equal(r.state, 'configuration-required');
  assert.match(r.detail, /VITE_SUPABASE_URL/); assert.match(r.detail, /VITE_SUPABASE_ANON_KEY/);
  assert.ok(r.steps.some((s) => /BEFORE building/.test(s)));
});

test('a service-role key is refused, never used', () => {
  const svc = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig';
  assert.match(validateConfig(URL, svc).join(' '), /SERVICE-ROLE/);
});

test('unreachable backend → connection error (network and timeout)', async () => {
  assert.equal((await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': new TypeError('Failed to fetch') }) })).state, 'connection-error');
  const slow = () => new Promise(() => {});
  const r = await checkBackend({ url: URL, key: KEY, timeoutMs: 50, fetchImpl: fakeFetch({ '/auth/v1/health': slow }) });
  assert.equal(r.state, 'connection-error'); assert.match(r.detail, /timed out/);
});

test('rejected key → connection error telling you to fix the key', async () => {
  const r = await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': res(401, {}) }) });
  assert.equal(r.state, 'connection-error'); assert.match(r.title, /rejected/);
});

test('migrations not run → database setup incomplete', async () => {
  const r = await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': res(200, {}), bg_health: res(404, { code: 'PGRST202' }) }) });
  assert.equal(r.state, 'setup-incomplete'); assert.match(r.detail, /PGRST202/); assert.match(r.steps[0], /0001 to 0005/);
});

test('security rules switched off → setup incomplete, naming the tables', async () => {
  const r = await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': res(200, {}), bg_health: res(200, { ...healthy, ok: false, tables_without_rls: ['messages'] }) }) });
  assert.equal(r.state, 'setup-incomplete'); assert.match(r.detail, /row-level security OFF on: messages/);
});

test('healthy backend → connected and verified, with warnings for real-time and missing authority', async () => {
  const ok = await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': res(200, {}), bg_health: res(200, healthy) }) });
  assert.equal(ok.state, 'connected-verified'); assert.deepEqual(ok.warnings, []);
  const warn = await checkBackend({ url: URL, key: KEY, fetchImpl: fakeFetch({ '/auth/v1/health': res(200, {}), bg_health: res(200, { ...healthy, realtime_missing: ['messages'], authority_accounts: false }) }) });
  assert.equal(warn.state, 'connected-verified'); assert.equal(warn.warnings.length, 2);
});

test('runtime config file is loaded when there are no build-time values; a service-role key in it is refused', async () => {
  const svc = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig';
  const c1 = await loadRuntimeConfig(async () => res(200, { supabaseUrl: URL, supabaseAnonKey: svc }));
  assert.equal(c1.url, ''); assert.match(c1.runtimeError, /SERVICE-ROLE/);
  const c2 = await loadRuntimeConfig(async () => res(200, { supabaseUrl: URL + '/', supabaseAnonKey: KEY }));
  assert.equal(c2.url, URL); assert.equal(c2.source, 'runtime'); assert.equal(getConfig().key, KEY);
});

test('a host that answers the missing config file with index.html is treated as “no file”, not an error', async () => {
  const c = await loadRuntimeConfig(async () => res(200, '<!doctype html><html><body>app</body></html>'));
  assert.equal(c.runtimeError, '');
});
