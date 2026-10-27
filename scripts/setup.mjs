#!/usr/bin/env node
// BreatheGuard guided setup for connected mode.
//   npm run setup                                   (asks for the values)
//   npm run setup -- --url https://x.supabase.co --anon-key eyJ... [--yes]
//   SUPABASE_SERVICE_ROLE_KEY=... npm run setup -- --url ... --anon-key ... --authority admin@example.com
// It never stores the service-role key or any AI key. It writes only the two PUBLIC values to .env.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout, argv, env, exit } from 'node:process';
import { checkBackend } from '../src/backend/status.js';
import { validateConfig } from '../src/backend/config.js';

const arg = (name) => { const i = argv.indexOf(`--${name}`); return i > 0 ? argv[i + 1] : undefined; };
const flag = (name) => argv.includes(`--${name}`);
const role = (jwt) => { try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString()).role; } catch { return null; } };
const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (q, def) => (arg(q.key) ?? (flag('yes') ? def : (await rl.question(`${q.text}${def ? ` [${def}]` : ''}: `)).trim())) || def || '';

console.log('\nBreatheGuard connected-mode setup\n----------------------------------');
console.log('You need: a Supabase project with supabase/setup_all.sql run once in its SQL Editor.');
console.log('Find the values in Supabase → Project Settings → API.\n');
const url = (await ask({ key: 'url', text: 'Project URL (https://xxxx.supabase.co)' })).replace(/\/+$/, '');
const key = await ask({ key: 'anon-key', text: 'anon public key' });

const problems = validateConfig(url, key);
if (problems.length) { console.error('\n✗ ' + problems.join('\n✗ ')); rl.close(); exit(1); }

console.log('\nChecking the backend for real…');
const status = await checkBackend({ url, key });
console.log(`\n${status.state === 'connected-verified' ? '✓' : '✗'} ${status.title}\n  ${status.detail}`);
(status.steps || []).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
(status.warnings || []).forEach((w) => console.log(`  ⚠ ${w}`));

if (status.state !== 'connection-error' && !flag('no-write')) {
  if (fs.existsSync('.env')) fs.copyFileSync('.env', '.env.backup');
  fs.writeFileSync('.env', `# Written by npm run setup. PUBLIC values only.\nVITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`);
  console.log('\n✓ Wrote .env (previous .env saved as .env.backup). Restart `npm run dev`; rebuild before deploying.');
}

const authorityEmail = arg('authority');
if (authorityEmail) {
  const svc = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc || role(svc) !== 'service_role') {
    console.error('\n✗ To create the authority, set SUPABASE_SERVICE_ROLE_KEY in THIS terminal only (Project Settings → API → service_role). It is used for one call and never saved.');
  } else if (status.state !== 'connected-verified') {
    console.error('\n✗ Fix the backend first (see above), then run again to create the authority.');
  } else {
    const r = await fetch(`${url}/rest/v1/rpc/bootstrap_authority`, { method: 'POST', headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_email: authorityEmail }) });
    const body = await r.json().catch(() => ({}));
    if (r.ok) console.log(`\n✓ ${typeof body === 'string' ? body : 'Authority role granted'}. Sign in on the login screen with the “Healthcare authority” tile.`);
    else console.error(`\n✗ Could not create the authority: ${body.message || r.status}. The account must be registered in the app first (as a patient), then run this again.`);
  }
}

console.log(`\nAI assistant (server-side; the key never goes in the app or in .env):
  Groq key (starts with gsk_):
    supabase login && supabase link --project-ref ${(() => { try { return new URL(url).host.split('.')[0]; } catch { return 'YOUR-REF'; } })()}
    supabase secrets set AI_PROVIDER=groq GROQ_API_KEY=<your key> AI_MODEL=<the model your chatbot uses>
    supabase functions deploy ai-assistant
  Anthropic key (starts with sk-ant-): use AI_PROVIDER=anthropic ANTHROPIC_API_KEY=<your key> instead.
  Then ask the BreatheGuard AI a question as a patient: the answer names the model that replied.
`);
rl.close();
exit(status.state === 'connected-verified' ? 0 : 2);
