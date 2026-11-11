// Turmas: qualquer usuário cria as suas (é o professor delas) e convida alunos por código/link.
// Alunos entregam programas na turma; o professor vê só as entregas.
import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { requireUser } from '../auth.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I
const MAX_OWNED = 50;
const MAX_MEMBERS = 200;

export const newInviteCode = () => Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const cleanName = (n) => (typeof n === 'string' ? n.trim().slice(0, 80) : '');

export default function turmaRoutes({ db }) {
  const r = Router();
  const q = {
    owned: db.prepare(
      `SELECT t.id, t.name, t.invite_code, t.created_at,
              (SELECT COUNT(*) FROM turma_members m WHERE m.turma_id = t.id) AS members,
              (SELECT COUNT(*) FROM submissions s WHERE s.turma_id = t.id) AS submissions
         FROM turmas t WHERE t.owner_id = ? ORDER BY t.name`
    ),
    joined: db.prepare(
      `SELECT t.id, t.name, u.name AS owner_name, m.joined_at
         FROM turma_members m JOIN turmas t ON t.id = m.turma_id JOIN users u ON u.id = t.owner_id
        WHERE m.user_id = ? ORDER BY t.name`
    ),
    get: db.prepare(
      `SELECT t.*, u.name AS owner_name FROM turmas t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`
    ),
    byCode: db.prepare(
      `SELECT t.id, t.name, t.owner_id, u.name AS owner_name FROM turmas t JOIN users u ON u.id = t.owner_id
        WHERE t.invite_code = ?`
    ),
    countOwned: db.prepare('SELECT COUNT(*) AS n FROM turmas WHERE owner_id = ?'),
    insert: db.prepare('INSERT INTO turmas (owner_id, name, invite_code) VALUES (?, ?, ?)'),
    rename: db.prepare('UPDATE turmas SET name = ? WHERE id = ?'),
    setCode: db.prepare('UPDATE turmas SET invite_code = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM turmas WHERE id = ?'),
    isMember: db.prepare('SELECT 1 FROM turma_members WHERE turma_id = ? AND user_id = ?'),
    countMembers: db.prepare('SELECT COUNT(*) AS n FROM turma_members WHERE turma_id = ?'),
    join: db.prepare('INSERT OR IGNORE INTO turma_members (turma_id, user_id) VALUES (?, ?)'),
    leave: db.prepare('DELETE FROM turma_members WHERE turma_id = ? AND user_id = ?'),
    members: db.prepare(
      `SELECT u.id, u.name, u.username, m.joined_at,
              (SELECT COUNT(*) FROM submissions s WHERE s.turma_id = m.turma_id AND s.user_id = u.id) AS submissions
         FROM turma_members m JOIN users u ON u.id = m.user_id WHERE m.turma_id = ? ORDER BY u.name`
    ),
    subsAll: db.prepare(
      `SELECT s.id, s.name, s.submitted_at, s.user_id, u.name AS user_name, u.username
         FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.turma_id = ? ORDER BY s.submitted_at DESC`
    ),
    subsMine: db.prepare(
      `SELECT s.id, s.name, s.submitted_at, s.user_id FROM submissions s
        WHERE s.turma_id = ? AND s.user_id = ? ORDER BY s.submitted_at DESC`
    ),
    sub: db.prepare(
      `SELECT s.*, u.name AS user_name, u.username FROM submissions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.turma_id = ?`
    ),
    program: db.prepare('SELECT id, name, code FROM programs WHERE id = ? AND user_id = ?'),
    submit: db.prepare('INSERT INTO submissions (turma_id, user_id, program_id, name, code) VALUES (?, ?, ?, ?, ?)'),
  };

  // Gera código único (colisão é improvável, mas tenta de novo)
  const uniqueCode = () => {
    for (;;) {
      const c = newInviteCode();
      if (!q.byCode.get(c)) return c;
    }
  };

  // Carrega a turma e o papel do usuário nela
  const load = (req, res) => {
    const t = q.get.get(Number(req.params.id));
    const isOwner = t && t.owner_id === req.user.id;
    const isMember = t && !!q.isMember.get(t.id, req.user.id);
    if (!t || (!isOwner && !isMember)) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    return { t, isOwner, isMember };
  };

  r.use(requireUser);

  r.get('/', (req, res) => res.json({ owned: q.owned.all(req.user.id), joined: q.joined.all(req.user.id) }));

  r.post('/', (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    if (q.countOwned.get(req.user.id).n >= MAX_OWNED) return res.status(400).json({ error: 'too_many_turmas' });
    const { lastInsertRowid } = q.insert.run(req.user.id, name, uniqueCode());
    res.status(201).json(q.get.get(Number(lastInsertRowid)));
  });

  // Pré-visualização de um convite (antes de entrar)
  r.get('/invite/:code', (req, res) => {
    const t = q.byCode.get(String(req.params.code).toUpperCase());
    if (!t) return res.status(404).json({ error: 'invalid_invite' });
    res.json({
      name: t.name,
      owner_name: t.owner_name,
      isOwner: t.owner_id === req.user.id,
      isMember: !!q.isMember.get(t.id, req.user.id),
    });
  });

  r.post('/join', (req, res) => {
    const t = q.byCode.get(String(req.body?.code || '').trim().toUpperCase());
    if (!t) return res.status(404).json({ error: 'invalid_invite' });
    if (t.owner_id === req.user.id) return res.status(400).json({ error: 'own_turma' });
    if (q.countMembers.get(t.id).n >= MAX_MEMBERS) return res.status(400).json({ error: 'turma_full' });
    q.join.run(t.id, req.user.id);
    res.json({ id: t.id, name: t.name });
  });

  r.get('/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    const { t, isOwner } = ctx;
    const base = { id: t.id, name: t.name, owner_name: t.owner_name, isOwner };
    if (isOwner) {
      return res.json({ ...base, invite_code: t.invite_code, members: q.members.all(t.id), submissions: q.subsAll.all(t.id) });
    }
    res.json({ ...base, submissions: q.subsMine.all(t.id, req.user.id) });
  });

  r.patch('/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.isOwner) return res.status(403).json({ error: 'forbidden' });
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    q.rename.run(name, ctx.t.id);
    res.json({ ok: true });
  });

  // Novo código invalida o link antigo (ex.: vazou para fora da turma)
  r.post('/:id/invite', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.isOwner) return res.status(403).json({ error: 'forbidden' });
    const code = uniqueCode();
    q.setCode.run(code, ctx.t.id);
    res.json({ invite_code: code });
  });

  r.delete('/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.isOwner) return res.status(403).json({ error: 'forbidden' });
    q.del.run(ctx.t.id);
    res.json({ ok: true });
  });

  // O professor remove um aluno; o aluno pode sair (removendo a si mesmo)
  r.delete('/:id/members/:userId', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    const uid = Number(req.params.userId);
    if (!ctx.isOwner && uid !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    q.leave.run(ctx.t.id, uid);
    res.json({ ok: true });
  });

  // Entrega: guarda uma cópia do programa como estava no momento da entrega
  r.post('/:id/submissions', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.isMember) return res.status(403).json({ error: 'not_member' });
    const p = q.program.get(Number(req.body?.programId), req.user.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const { lastInsertRowid } = q.submit.run(ctx.t.id, req.user.id, p.id, p.name, p.code);
    res.status(201).json({ id: Number(lastInsertRowid), name: p.name });
  });

  r.get('/:id/submissions/:sid', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    const s = q.sub.get(Number(req.params.sid), ctx.t.id);
    if (!s || (!ctx.isOwner && s.user_id !== req.user.id)) return res.status(404).json({ error: 'not_found' });
    res.json({ id: s.id, name: s.name, code: s.code, submitted_at: s.submitted_at, user_name: s.user_name, username: s.username });
  });

  return r;
}
