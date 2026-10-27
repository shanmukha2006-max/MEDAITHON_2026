// Verify the backend before claiming connected mode works. Returns one of:
//   configuration-required | connection-error | setup-incomplete | connected-verified
// (local demo mode is a separate, explicit choice on the login screen).
import { validateConfig } from './config.js';

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function checkBackend({ url, key, fetchImpl = fetch, timeoutMs = 8000, runtimeError = '' }) {
  const problems = validateConfig(url, key);
  if (runtimeError) problems.push(runtimeError);
  if (problems.length) {
    return { state: 'configuration-required', title: 'Configuration required', detail: problems.join(' '),
      steps: ['Create a Supabase project and run supabase/setup_all.sql once in its SQL Editor (docs/BACKEND_SETUP.md, steps 1–2).',
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host BEFORE building, then rebuild and redeploy; or upload breatheguard-config.json next to index.html (no rebuild needed).'] };
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  // 1. Authentication service reachable and key accepted?
  let auth;
  try { auth = await withTimeout(fetchImpl(`${url}/auth/v1/health`, { headers }), timeoutMs); }
  catch (e) {
    return { state: 'connection-error', title: 'Cannot reach the backend', detail: `No response from ${safeHost(url)} (${e.message === 'timeout' ? 'timed out' : 'network error'}). Check the URL, your internet connection, and that the Supabase project is not paused.`, steps: ['Open the Supabase dashboard and confirm the project is running.', 'Check VITE_SUPABASE_URL matches Project Settings → API → Project URL.'] };
  }
  if (auth.status === 401 || auth.status === 403) return { state: 'connection-error', title: 'Backend rejected the app key', detail: 'The anon (public) key was not accepted by this project.', steps: ['Copy the anon public key again from Project Settings → API and update VITE_SUPABASE_ANON_KEY (then rebuild) or breatheguard-config.json.'] };
  if (!auth.ok) return { state: 'connection-error', title: 'Authentication service unavailable', detail: `The authentication service answered with status ${auth.status}.`, steps: ['Check the Supabase status page and your project’s Auth settings.'] };
  // 2. Database schema, row-level security and functions in place?
  let h;
  try { h = await withTimeout(fetchImpl(`${url}/rest/v1/rpc/bg_health`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }), timeoutMs); }
  catch (e) { return { state: 'connection-error', title: 'Database API unreachable', detail: `The database API did not respond (${e.message}).`, steps: [] }; }
  if (h.status === 404 || h.status === 400) {
    let code = ''; try { code = (await h.json()).code || ''; } catch { /* ignore */ }
    return { state: 'setup-incomplete', title: 'Database setup incomplete', detail: `Connected to the project, but the BreatheGuard database is not set up${code ? ` (${code})` : ''}: the migrations have not been run.`, steps: ['Run supabase/setup_all.sql (all migrations 0001 to 0005) in the SQL Editor (docs/BACKEND_SETUP.md, step 2).'] };
  }
  if (!h.ok) return { state: 'connection-error', title: 'Database API error', detail: `The database API answered with status ${h.status}.`, steps: [] };
  const j = await h.json();
  const issues = [];
  if (j.missing_tables?.length) issues.push(`missing tables: ${j.missing_tables.join(', ')}`);
  if (j.tables_without_rls?.length) issues.push(`row-level security OFF on: ${j.tables_without_rls.join(', ')}`);
  if (j.missing_functions?.length) issues.push(`missing functions: ${j.missing_functions.join(', ')}`);
  if (!j.ok || issues.length) return { state: 'setup-incomplete', title: 'Database setup incomplete', detail: `Connected, but ${issues.join('; ') || 'the health check failed'}.`, steps: ['Re-run supabase/setup_all.sql; it is safe to re-run.'] };
  const warnings = [];
  if (j.realtime_missing?.length) warnings.push(`Live updates will use 3-second polling: these tables are not in the real-time publication: ${j.realtime_missing.join(', ')}.`);
  if (!j.authority_accounts) warnings.push('No healthcare authority account exists yet, so applications cannot be reviewed. Create one with bootstrap_authority (docs/BACKEND_SETUP.md, step 4).');
  return { state: 'connected-verified', title: 'Connected and verified', detail: `Authentication service, database schema (v${j.schema_version}) and security rules checked just now.`, warnings, health: j };
}
const safeHost = (u) => { try { return new URL(u).host; } catch { return 'the configured URL'; } };
