#!/bin/sh
# TEST ONLY: start the local stack used by the database, API, AI and acceptance tests.
# Needs: PostgreSQL 16 (initialised at $PGDATA with auth_shim.sql + both migrations applied to bg_test),
# PostgREST at $POSTGREST, Deno at $DENO, Node 18+. See docs/TESTING.md.
# Run it directly (not under `timeout`), so the services stay up after the script exits.
PGDATA=${PGDATA:-/tmp/pgdata}; POSTGREST=${POSTGREST:-/tmp/postgrest}; DENO=${DENO:-/tmp/denobin/deno}
SECRET=test-only-secret-at-least-32-characters-long
ANON=$(node -e "const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',exp:2000000000});console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))")
echo "$ANON" > /tmp/anon.jwt
psql -h /tmp -p 54322 -U postgres -At -c 'select 1' >/dev/null 2>&1 || { su postgres -c "setsid nohup /usr/lib/postgresql/16/bin/postgres -D $PGDATA -p 54322 -k /tmp > /tmp/pg.log 2>&1 < /dev/null &"; sleep 4; }
curl -s -o /dev/null --max-time 2 http://localhost:3010/ || PGRST_DB_URI="postgres://authenticator:authpw@127.0.0.1:54322/bg_test" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET=$SECRET PGRST_SERVER_PORT=3010 setsid nohup $POSTGREST > /tmp/pgrst.log 2>&1 < /dev/null &
curl -s -o /dev/null --max-time 2 -X POST http://localhost:3030/ -d '{}' || setsid nohup node supabase/tests/fake_ai_provider.mjs > /tmp/fakeai.log 2>&1 < /dev/null &
curl -s -o /dev/null --max-time 2 -X OPTIONS http://localhost:3020/ || SUPABASE_URL=http://localhost:3011 SUPABASE_ANON_KEY=$ANON AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-test-key-not-real AI_API_URL=http://localhost:3030/v1/messages FN_PORT=3020 setsid nohup $DENO run --allow-net --allow-env --allow-read supabase/tests/serve_function.ts > /tmp/fn.log 2>&1 < /dev/null &
# Groq-format copy of the real function (TEST key, stand-in provider; never a real key)
curl -s -o /dev/null --max-time 2 -X OPTIONS http://localhost:3022/ || SUPABASE_URL=http://localhost:3011 SUPABASE_ANON_KEY=$ANON AI_PROVIDER=groq GROQ_API_KEY=gsk_test_key_not_real AI_TIMEOUT_SECONDS=5 AI_API_URL=http://localhost:3030/openai/v1/chat/completions FN_PORT=3022 setsid nohup $DENO run --allow-net --allow-env --allow-read supabase/tests/serve_function.ts > /tmp/fn3.log 2>&1 < /dev/null &
curl -s -o /dev/null --max-time 2 -X OPTIONS http://localhost:3021/ || SUPABASE_URL=http://localhost:3011 SUPABASE_ANON_KEY=$ANON FN_PORT=3021 setsid nohup $DENO run --allow-net --allow-env --allow-read supabase/tests/serve_function.ts > /tmp/fn2.log 2>&1 < /dev/null &
curl -s -o /dev/null --max-time 2 http://localhost:3011/rest/v1/ -X OPTIONS || BG_TEST_DB="postgres://postgres@/bg_test?host=/tmp&port=54322" FN_PORT=3020 setsid nohup node supabase/tests/proxy.mjs > /tmp/proxy.log 2>&1 < /dev/null &
curl -s -o /dev/null --max-time 2 http://localhost:4180/ || setsid nohup npx vite preview --outDir dist-cloud --port 4180 --strictPort > /tmp/prev_cloud.log 2>&1 < /dev/null &
sleep 10
for s in "db:$(psql -h /tmp -p 54322 -U postgres -At -c 'select 1' 2>/dev/null)" "postgrest:$(curl -s -o /dev/null -w %{http_code} --max-time 3 http://localhost:3011/rest/v1/hospitals)" "fn:$(curl -s -o /dev/null -w %{http_code} --max-time 3 -X OPTIONS http://localhost:3020/)" "ai:$(curl -s -o /dev/null -w %{http_code} --max-time 3 -X POST http://localhost:3030/ -d '{}')" "app:$(curl -s -o /dev/null -w %{http_code} --max-time 3 http://localhost:4180/)"; do echo "  $s"; done
