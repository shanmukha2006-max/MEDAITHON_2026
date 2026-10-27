// TEST ONLY — never deploy. Stands in for the parts of Supabase that cannot run in the test
// environment, so the real app can be exercised end to end:
//   /rest/v1/*  -> forwarded to a real PostgREST (real database, real row-level security)
//   /auth/v1/*  -> minimal sign-up / sign-in issuing HS256 JWTs like Supabase Auth (passwords kept in memory)
//   /functions/v1/* -> 404 (Edge Functions not deployed), /realtime/v1/* -> not available
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
const SECRET = process.env.JWT_SECRET || 'test-only-secret-at-least-32-characters-long';
const pool = new pg.Pool({ connectionString: process.env.BG_TEST_DB });
const passwords = new Map();
const recoveries = [];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const verify = (t) => { const [h, p, s] = String(t).split('.'); if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null; return JSON.parse(Buffer.from(p, 'base64url')); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': '*' };
const send = (res, code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data, app_metadata: { provider: 'email' }, created_at: u.created_at });
const sessionFor = (u) => { const now = Math.floor(Date.now() / 1000); return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp: now + 3600 }), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `r.${u.id}`, user: userObj(u) }; };
const byEmail = async (e) => (await pool.query('select * from auth.users where email = $1', [e])).rows[0];
const byId = async (id) => (await pool.query('select * from auth.users where id = $1', [id])).rows[0];

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/auth/v1/')) {
      const route = url.pathname.slice(9);
      if (route === 'health') return req.headers.apikey ? send(res, 200, { name: 'GoTrue (TEST STAND-IN)' }) : send(res, 401, { message: 'No API key found in request' });
      if (route === 'signup' && req.method === 'POST') {
        const b = await readBody(req);
        if (await byEmail(b.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const u = (await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *', [b.email, b.data || {}])).rows[0];
        passwords.set(b.email, b.password);
        return send(res, 200, sessionFor(u));
      }
      if (route === 'token') {
        const b = await readBody(req);
        if (url.searchParams.get('grant_type') === 'password') {
          const u = await byEmail(b.email);
          if (!u || passwords.get(b.email) !== b.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return send(res, 200, sessionFor(u));
        }
        const u = await byId(String(b.refresh_token || '').slice(2));
        return u ? send(res, 200, sessionFor(u)) : send(res, 400, { msg: 'Invalid Refresh Token' });
      }
      if (route === 'user') {
        const c = verify((req.headers.authorization || '').replace('Bearer ', '')); const u = c && await byId(c.sub);
        if (!u) return send(res, 401, { msg: 'invalid JWT' });
        if (req.method === 'PUT') { const b = await readBody(req); if (b.password) passwords.set(u.email, b.password); }
        return send(res, 200, userObj(u));
      }
      if (route === 'recover') { const b = await readBody(req); recoveries.push(b.email); return send(res, 200, {}); } // a real service would email a link
      if (route === 'logout') return send(res, 204);
      if (route === 'admin/set-password') { const b = await readBody(req); passwords.set(b.email, b.password); return send(res, 200, { ok: true }); } // test setup only
      return send(res, 404, { msg: 'not implemented in test stand-in' });
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      if (!process.env.FN_PORT || url.pathname !== '/functions/v1/ai-assistant') return send(res, 404, { message: 'Function not found' });
      const p = http.request({ host: '127.0.0.1', port: Number(process.env.FN_PORT), path: '/', method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
      p.on('error', (e) => send(res, 502, { message: String(e) }));
      return req.pipe(p);
    }
    if (url.pathname.startsWith('/rest/v1')) {
      const path = req.url.replace(/^\/rest\/v1/, '') || '/';
      const p = http.request({ host: '127.0.0.1', port: Number(process.env.PGRST_PORT || 3010), path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
      p.on('error', (e) => send(res, 502, { message: String(e) }));
      return req.pipe(p);
    }
    return send(res, 404, { message: 'not found' });
  } catch (e) { return send(res, 500, { msg: String(e) }); }
}).listen(Number(process.env.PROXY_PORT || 3011), () => console.log('test stand-in ready'));
