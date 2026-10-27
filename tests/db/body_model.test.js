// Body model for the 3D view: chosen by the patient (never inferred from a name), stored on the profile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const URL = process.env.BG_TEST_DB; const skip = !URL && 'set BG_TEST_DB';
let pool; const U = {};
const as = async (uid, sql, params) => { const c = await pool.connect(); try { await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]); const r = await c.query(sql, params); await c.query('commit'); return r.rows; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
before(async () => {
  if (skip) return; pool = new pg.Pool({ connectionString: URL });
  await pool.query("delete from auth.users where email like '%@body.test'");
  for (const [k, meta] of [['m', { role: 'patient', full_name: 'Synthetic Alex', body_model: 'male' }], ['bad', { role: 'patient', full_name: 'Synthetic Sam', body_model: 'robot' }], ['none', { role: 'patient', full_name: 'Synthetic Jordan' }]]) {
    U[k] = (await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${k}@body.test`, meta])).rows[0].id;
  }
});
after(async () => { if (pool) { await pool.query("delete from auth.users where email like '%@body.test'"); await pool.end(); } });
test('sign-up choice is stored; invalid or missing choices are left empty (not guessed from the name)', { skip }, async () => {
  const bm = async (id) => (await pool.query('select body_model from public.profiles where id = $1', [id])).rows[0].body_model;
  assert.equal(await bm(U.m), 'male'); assert.equal(await bm(U.bad), null); assert.equal(await bm(U.none), null);
});
test('a patient can change only their own body model, to an allowed value', { skip }, async () => {
  await as(U.none, "update public.profiles set body_model = 'female' where id = auth.uid()");
  assert.equal((await pool.query('select body_model from public.profiles where id = $1', [U.none])).rows[0].body_model, 'female');
  const r = await as(U.none, "update public.profiles set body_model = 'female' where id = $1 returning id", [U.m]);
  assert.equal(r.length, 0, 'another patient’s profile is not changed');
  await assert.rejects(as(U.none, "update public.profiles set body_model = 'robot' where id = auth.uid()"), /check constraint/);
});
