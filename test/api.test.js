import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO users (username, name, role, turma, password_hash) VALUES (?, ?, ?, ?, ?)');
  ins.run('prof', 'Professor', 'professor', '', hashPassword('segredo1'));
  ins.run('ana', 'Ana', 'aluno', 'T1', hashPassword('senha-ana'));
  ins.run('beto', 'Beto', 'aluno', 'T1', hashPassword('senha-beto'));
  server = createApp({ db }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Cliente mínimo que guarda o cookie de sessão
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

const login = async (u, p) => {
  const c = client();
  const r = await c('POST', '/api/auth/login', { username: u, password: p });
  assert.equal(r.status, 200, `login ${u}`);
  return c;
};

test('login, sessão e logout', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/auth/me')).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { username: 'ana', password: 'errada' })).status, 401);
  const r = await c('POST', '/api/auth/login', { username: 'ANA', password: 'senha-ana' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await c('GET', '/api/auth/me')).body.user.username, 'ana');
  await c('POST', '/api/auth/logout', {});
  assert.equal((await c('GET', '/api/auth/me')).status, 401);
});

test('programas são privados de cada aluno', async () => {
  const ana = await login('ana', 'senha-ana');
  const beto = await login('beto', 'senha-beto');
  const created = await ana('POST', '/api/programs', { name: 'EIXO_01.MPF', code: 'G0 X10\nM30' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await ana('POST', '/api/programs', { name: 'eixo_01.mpf', code: '' })).status, 409);
  assert.equal((await ana('POST', '/api/programs', { name: '../x', code: '' })).status, 400);
  assert.equal((await beto('GET', `/api/programs/${id}`)).status, 404);
  assert.equal((await beto('PUT', `/api/programs/${id}`, { code: 'x' })).status, 404);
  assert.equal((await beto('DELETE', `/api/programs/${id}`)).status, 404);
  assert.deepEqual((await beto('GET', '/api/programs')).body.mine, []);
  const upd = await ana('PUT', `/api/programs/${id}`, { code: 'G1 X5\nM30' });
  assert.equal(upd.body.code, 'G1 X5\nM30');
  const lst = await ana('GET', '/api/programs');
  assert.ok(lst.body.examples.includes('01_basico.mpf'));
  assert.equal(lst.body.mine.length, 1);
  assert.equal((await ana('DELETE', `/api/programs/${id}`)).status, 200);
});

test('CSRF: alterações exigem JSON e mesma origem', async () => {
  const ana = await login('ana', 'senha-ana');
  const form = await ana('POST', '/api/programs', undefined, { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const cross = await ana('POST', '/api/programs', { name: 'A', code: '' }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
});

test('configurações: só chaves e valores válidos', async () => {
  const ana = await login('ana', 'senha-ana');
  const r = await ana('PUT', '/api/settings', { lang: 'en', dialect: 'x', hack: 1, stock: { diameter: 40, length: 80, faceZ: 1 } });
  assert.deepEqual(r.body, { lang: 'en', stock: { diameter: 40, length: 80, faceZ: 1 } });
  assert.equal((await ana('GET', '/api/settings')).body.lang, 'en');
});

test('painel do professor', async () => {
  const ana = await login('ana', 'senha-ana');
  assert.equal((await ana('GET', '/api/admin/users')).status, 403);
  const prof = await login('prof', 'segredo1');
  const nu = await prof('POST', '/api/admin/users', { username: 'carla', name: 'Carla', turma: 'T2', password: 'senha-carla' });
  assert.equal(nu.status, 201);
  assert.equal((await prof('POST', '/api/admin/users', { username: 'carla', name: 'C', password: 'xxxxxx' })).status, 409);
  const carla = await login('carla', 'senha-carla');
  const p = await carla('POST', '/api/programs', { name: 'P1', code: 'M30' });
  const view = await prof('GET', `/api/admin/programs/${p.body.id}`);
  assert.equal(view.body.code, 'M30');
  assert.equal(view.body.username, 'carla');
  // desativar encerra a sessão do aluno
  await prof('PATCH', `/api/admin/users/${nu.body.id}`, { active: false });
  assert.equal((await carla('GET', '/api/auth/me')).status, 401);
  const me = (await prof('GET', '/api/auth/me')).body.user;
  assert.equal((await prof('PATCH', `/api/admin/users/${me.id}`, { active: false })).status, 400);
});

test('trocar senha', async () => {
  const beto = await login('beto', 'senha-beto');
  assert.equal((await beto('POST', '/api/auth/password', { current: 'x', next: 'nova-senha' })).status, 400);
  assert.equal((await beto('POST', '/api/auth/password', { current: 'senha-beto', next: 'nova-senha' })).status, 200);
  assert.equal((await beto('GET', '/api/auth/me')).status, 200);
  await login('beto', 'nova-senha');
});
