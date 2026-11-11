import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';

let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  server = createApp({ db, admins: new Set(['root']), signupsPerHour: 1000 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

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

const signup = async (username, extra = {}) => {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { name: username.toUpperCase(), username, password: `senha-${username}`, ...extra });
  assert.equal(r.status, 201, `signup ${username}: ${JSON.stringify(r.body)}`);
  return c;
};
const login = async (u, p) => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { username: u, password: p })).status, 200);
  return c;
};

test('cadastro aberto, login e logout', async () => {
  const ana = await signup('ana', { email: 'ana@exemplo.com' });
  const me = (await ana('GET', '/api/auth/me')).body.user;
  assert.equal(me.username, 'ana');
  assert.equal(me.email, 'ana@exemplo.com');
  assert.equal(me.isAdmin, false);
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', username: 'ANA', password: 'xxxxxx' })).status, 409);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', username: 'ana2', password: 'xxxxxx', email: 'ANA@exemplo.com' })).status, 409);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', username: 'a', password: 'xxxxxx' })).status, 400);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', username: 'ana3', password: '123' })).status, 400);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', username: 'ana4', password: 'xxxxxx', email: 'nao-email' })).status, 400);
  assert.equal((await c('POST', '/api/auth/login', { username: 'ana', password: 'errada' })).status, 401);
  const l = await login('ANA', 'senha-ana');
  await l('POST', '/api/auth/logout', {});
  assert.equal((await l('GET', '/api/auth/me')).status, 401);
});

test('limite de cadastros por IP', async () => {
  const db = openDb(':memory:');
  const srv = createApp({ db, signupsPerHour: 2 }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/auth/signup`;
  const post = (u) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: u, username: u, password: 'xxxxxx' }) });
  try {
    assert.equal((await post('user1')).status, 201);
    assert.equal((await post('user2')).status, 201);
    assert.equal((await post('user3')).status, 429);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('programas são privados', async () => {
  const bia = await signup('bia');
  const caio = await signup('caio');
  const created = await bia('POST', '/api/programs', { name: 'EIXO_01.MPF', code: 'G0 X10\nM30' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await bia('POST', '/api/programs', { name: 'eixo_01.mpf', code: '' })).status, 409);
  assert.equal((await bia('POST', '/api/programs', { name: '../x', code: '' })).status, 400);
  assert.equal((await caio('GET', `/api/programs/${id}`)).status, 404);
  assert.equal((await caio('PUT', `/api/programs/${id}`, { code: 'x' })).status, 404);
  assert.equal((await caio('DELETE', `/api/programs/${id}`)).status, 404);
  assert.deepEqual((await caio('GET', '/api/programs')).body.mine, []);
  assert.equal((await bia('PUT', `/api/programs/${id}`, { code: 'G1 X5\nM30' })).body.code, 'G1 X5\nM30');
  assert.ok((await bia('GET', '/api/programs')).body.examples.includes('01_basico.mpf'));
  assert.equal((await bia('DELETE', `/api/programs/${id}`)).status, 200);
});

test('CSRF: alterações exigem JSON e mesma origem', async () => {
  const c = await signup('dani');
  assert.equal((await c('POST', '/api/programs', undefined, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await c('POST', '/api/programs', { name: 'A', code: '' }, { Origin: 'https://evil.example' })).status, 403);
});

test('configurações: só chaves e valores válidos', async () => {
  const c = await signup('edu');
  const r = await c('PUT', '/api/settings', { lang: 'en', dialect: 'x', hack: 1, stock: { diameter: 40, length: 80, faceZ: 1 } });
  assert.deepEqual(r.body, { lang: 'en', stock: { diameter: 40, length: 80, faceZ: 1 } });
  // torre: tipos válidos, posição vazia permitida, tipo desconhecido volta ao padrão
  const tr = await c('PUT', '/api/settings', { turret: { 1: 'ext_finish_55', 2: '', 3: 'xxx' } });
  assert.equal(tr.body.turret[1], 'ext_finish_55');
  assert.equal(tr.body.turret[2], '');
  assert.equal(tr.body.turret[3], 'groove_3');
  assert.equal(tr.body.turret[8], 'thread_int_60');
});

test('turmas: convite, entrega e privacidade', async () => {
  const prof = await signup('prof');
  const aluno = await signup('aluno');
  const outro = await signup('outro');

  const t = (await prof('POST', '/api/turmas', { name: 'Torno T1' })).body;
  assert.match(t.invite_code, /^[A-Z2-9]{8}$/);

  // pré-visualização e entrada pelo código (sem diferenciar maiúsculas)
  assert.equal((await aluno('GET', `/api/turmas/invite/${t.invite_code}`)).body.name, 'Torno T1');
  assert.equal((await aluno('POST', '/api/turmas/join', { code: t.invite_code.toLowerCase() })).status, 200);
  assert.equal((await prof('POST', '/api/turmas/join', { code: t.invite_code })).status, 400, 'dono não entra como aluno');

  // quem não é da turma não vê nada
  assert.equal((await outro('GET', `/api/turmas/${t.id}`)).status, 404);

  // o aluno também pode ser professor de outra turma
  const t2 = (await aluno('POST', '/api/turmas', { name: 'Minha turma' })).body;
  assert.equal((await aluno('GET', '/api/turmas')).body.owned[0].id, t2.id);

  // entrega: o professor vê só o que foi entregue, como estava no momento
  const p1 = (await aluno('POST', '/api/programs', { name: 'P1', code: 'G0 X1\nM30' })).body;
  await aluno('POST', '/api/programs', { name: 'SECRETO', code: 'M30' });
  const sub = await aluno('POST', `/api/turmas/${t.id}/submissions`, { programId: p1.id });
  assert.equal(sub.status, 201);
  await aluno('PUT', `/api/programs/${p1.id}`, { code: 'ALTERADO' });
  const det = (await prof('GET', `/api/turmas/${t.id}`)).body;
  assert.equal(det.members.length, 1);
  assert.deepEqual(det.submissions.map((s) => s.name), ['P1']);
  assert.equal((await prof('GET', `/api/turmas/${t.id}/submissions/${sub.body.id}`)).body.code, 'G0 X1\nM30');
  assert.equal((await prof('GET', `/api/programs/${p1.id}`)).status, 404, 'professor não lê programas não entregues');

  // aluno vê só as próprias entregas e não vê o código de convite nem a lista de alunos
  const view = (await aluno('GET', `/api/turmas/${t.id}`)).body;
  assert.equal(view.invite_code, undefined);
  assert.equal(view.members, undefined);
  assert.equal(view.submissions.length, 1);

  // não-membro não entrega; programa de outro usuário não pode ser entregue
  assert.equal((await outro('POST', `/api/turmas/${t.id}/submissions`, { programId: p1.id })).status, 404);
  const pOutro = (await outro('POST', '/api/programs', { name: 'X', code: 'M30' })).body;
  assert.equal((await aluno('POST', `/api/turmas/${t.id}/submissions`, { programId: pOutro.id })).status, 404);

  // aluno não altera a turma
  assert.equal((await aluno('PATCH', `/api/turmas/${t.id}`, { name: 'hack' })).status, 403);
  assert.equal((await aluno('DELETE', `/api/turmas/${t.id}/members/${det.members[0].id + 999}`)).status, 403);

  // novo código invalida o antigo
  const novo = (await prof('POST', `/api/turmas/${t.id}/invite`, {})).body.invite_code;
  assert.notEqual(novo, t.invite_code);
  assert.equal((await outro('POST', '/api/turmas/join', { code: t.invite_code })).status, 404);

  // professor remove o aluno; aluno perde acesso
  await prof('DELETE', `/api/turmas/${t.id}/members/${det.members[0].id}`);
  assert.equal((await aluno('GET', `/api/turmas/${t.id}`)).status, 404);
});

test('turmas: renomear, sair e excluir (apaga as entregas)', async () => {
  const p = await signup('profb');
  const a = await signup('alunob');
  const t = (await p('POST', '/api/turmas', { name: 'T' })).body;
  assert.equal((await p('POST', '/api/turmas', { name: '   ' })).status, 400);
  await p('PATCH', `/api/turmas/${t.id}`, { name: 'Torno B' });
  await a('POST', '/api/turmas/join', { code: t.invite_code });
  assert.equal((await a('GET', '/api/turmas')).body.joined[0].name, 'Torno B');
  const me = (await a('GET', '/api/auth/me')).body.user;
  assert.equal((await a('DELETE', `/api/turmas/${t.id}/members/${me.id}`)).status, 200, 'aluno sai');
  assert.deepEqual((await a('GET', '/api/turmas')).body.joined, []);
  await a('POST', '/api/turmas/join', { code: t.invite_code });
  const prog = (await a('POST', '/api/programs', { name: 'X1', code: 'M30' })).body;
  const sub = (await a('POST', `/api/turmas/${t.id}/submissions`, { programId: prog.id })).body;
  assert.equal((await a('DELETE', `/api/turmas/${t.id}`)).status, 403, 'aluno não exclui');
  assert.equal((await p('DELETE', `/api/turmas/${t.id}`)).status, 200);
  assert.equal((await a('GET', `/api/turmas/${t.id}/submissions/${sub.id}`)).status, 404);
  assert.equal((await a('GET', `/api/programs/${prog.id}`)).status, 200, 'o programa do aluno continua');
});

test('trocar a senha encerra as outras sessões', async () => {
  await signup('sessao');
  const s1 = await login('sessao', 'senha-sessao');
  const s2 = await login('sessao', 'senha-sessao');
  assert.equal((await s1('POST', '/api/auth/password', { current: 'senha-sessao', next: 'nova-senha' })).status, 200);
  assert.equal((await s1('GET', '/api/auth/me')).status, 200, 'sessão atual renovada');
  assert.equal((await s2('GET', '/api/auth/me')).status, 401, 'outra sessão encerrada');
});

test('limites e validações de programas', async () => {
  const c = await signup('limites');
  assert.equal((await c('POST', '/api/programs', { name: 'A', code: 'x'.repeat(300 * 1024) })).status, 400, 'programa > 256 KB');
  assert.equal((await c('POST', '/api/programs', { name: 'A', code: 'x'.repeat(600 * 1024) })).status, 413, 'requisição > 512 KB');
  assert.equal((await c('POST', '/api/programs', { name: 'A'.repeat(41), code: '' })).status, 400);
  assert.equal((await c('POST', '/api/programs', { name: 'OK.MPF', code: 5 })).status, 400);
  assert.equal((await c('GET', '/api/programs/examples/..%2Fserver.js')).status, 400);
  assert.equal((await c('GET', '/api/programs/examples/nao_existe.mpf')).status, 404);
  assert.equal((await c('GET', '/api/nada')).status, 404);
});

test('cabeçalhos de segurança e arquivos estáticos', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal((await fetch(base + '/shared/simulator.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/three/build/three.module.js')).status, 200);
});

test('administração do sistema por ADMIN_USERNAMES', async () => {
  const comum = await signup('comum');
  assert.equal((await comum('GET', '/api/admin/users')).status, 403);
  const root = await signup('root');
  assert.equal((await root('GET', '/api/auth/me')).body.user.isAdmin, true);
  const users = (await root('GET', '/api/admin/users')).body;
  const alvo = users.find((u) => u.username === 'comum');
  await root('PATCH', `/api/admin/users/${alvo.id}`, { active: false });
  assert.equal((await comum('GET', '/api/auth/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { username: 'comum', password: 'senha-comum' })).status, 401);
});

test('migração preserva usuários do esquema antigo', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'cnc-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('professor', 'aluno')), turma TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE programs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE, code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, name));
    CREATE TABLE settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL);
    INSERT INTO users (username, name, role, password_hash) VALUES ('velho', 'Velho', 'professor', 'x');
    PRAGMA user_version = 1;`);
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  const u = db.prepare('SELECT * FROM users').get();
  assert.equal(u.username, 'velho');
  assert.equal('role' in u, false);
  db.close();
});
