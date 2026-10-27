# Testing BreatheGuard

## Quick (no services needed)

```bash
npm test        # 60 unit tests; 45 database/API/AI tests skip without the stack below
```

## Full stack (Linux, as used for the reported results)

Needs PostgreSQL 16, PostgREST 12.2.3 (binary from its GitHub releases), Deno 2.1.4, Node 18+, and Python with Playwright for browser tests.

1. Create a test database `bg_test`, then apply, in order: `supabase/tests/auth_shim.sql` (TEST ONLY: stands in for Supabase’s auth schema), `supabase/migrations/0001_breatheguard_init.sql`, `supabase/migrations/0002_breatheguard_complete.sql`, `supabase/migrations/0003_breatheguard_relationships.sql`. Create the PostgREST login role: `create role authenticator login password 'authpw' noinherit; grant anon, authenticated to authenticator;`
2. Start everything (run it directly, not under `timeout`; re-run it whenever the environment has been reset, because background services stop): `DENO=/path/to/deno sh supabase/tests/start_stack.sh`. It starts PostgREST, `supabase/tests/proxy.mjs` (TEST-ONLY stand-in for Supabase Auth, no email delivery), `fake_ai_provider.mjs` (TEST-ONLY stand-in AI that marks its replies), the real AI Edge Function under Deno (with and without a key), and a preview of `dist-cloud`.
3. Build the connected-mode app against the stack: write `VITE_SUPABASE_URL=http://localhost:3011` and `VITE_SUPABASE_ANON_KEY=$(cat /tmp/anon.jwt)` to `.env.cloudtest`, run `npx vite build --mode cloudtest --outDir dist-cloud`, then delete `.env.cloudtest`.
4. Run:

```bash
BG_TEST_API=http://localhost:3011 BG_TEST_DB="postgres://postgres@/bg_test?host=/tmp&port=54322" \
BG_TEST_FN=http://localhost:3020 BG_TEST_FN_NOKEY=http://localhost:3021 npm test   # 126 tests
python scripts/e2e_acceptance.py      # acceptance A–J, connected mode (51 checks)
python scripts/e2e_cloud.py           # Part 6 two-session flow
python scripts/e2e_part8.py           # Part 8: connections, messaging, alerts, sensor failure, prescriptions, AI
python scripts/e2e_sensor_toggle.py   # Test 5 with the live sensor-disable controls
python scripts/e2e_part9.py           # backend status (4 builds on ports 4174/4190/4191/4192), authority sign-in, floating AI
python scripts/e2e_part8.py           # Part 8: connections, messaging, live alerts and resolution, sensor failure, prescriptions
# NOTE: database tests and browser suites share the test database and reset it: never run them at the same time.
npm run build && npx vite preview --port 4174
BG_URL=http://localhost:4174/ python scripts/e2e_judge.py        # local mode: Judge Demo and simulator (56)
BG_URL=http://localhost:4174/ python scripts/e2e_flow.py         # local mode: original flow (18)
BG_URL=http://localhost:4174/ python scripts/e2e_workflows.py    # local mode: edge cases (29)
```

## What the stack cannot test

Supabase Auth itself (email confirmation, password-reset email delivery, token refresh), Supabase Realtime WebSockets (the app’s 3-second polling fallback is what gets exercised), a real AI model, and separate physical devices. Follow `docs/BACKEND_SETUP.md`, section 7, with a real project for those.
