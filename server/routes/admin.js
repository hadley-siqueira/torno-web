// Painel do professor: cadastro de alunos e leitura dos programas deles.
import { Router } from 'express';
import { hashPassword, requireProfessor, validPassword, validUsername } from '../auth.js';

const ROLES = ['aluno', 'professor'];
const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

export default function adminRoutes({ db, sessions }) {
  const r = Router();
  const list = db.prepare(
    `SELECT u.id, u.username, u.name, u.role, u.turma, u.active, u.created_at,
            (SELECT COUNT(*) FROM programs p WHERE p.user_id = u.id) AS programs
       FROM users u ORDER BY u.turma, u.name`
  );
  const byId = db.prepare('SELECT id, username, name, role, turma, active FROM users WHERE id = ?');
  const byUsername = db.prepare('SELECT id FROM users WHERE username = ?');
  const insert = db.prepare('INSERT INTO users (username, name, role, turma, password_hash) VALUES (?, ?, ?, ?, ?)');
  const userPrograms = db.prepare('SELECT id, name, updated_at FROM programs WHERE user_id = ? ORDER BY name');
  const program = db.prepare(
    `SELECT p.id, p.name, p.code, p.updated_at, u.id AS user_id, u.name AS user_name, u.username
       FROM programs p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  );

  r.use(requireProfessor);

  r.get('/users', (_req, res) => res.json(list.all()));

  r.post('/users', (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 100);
    const turma = cleanText(b.turma, 40) ?? '';
    const role = b.role ?? 'aluno';
    if (!validUsername(b.username)) return res.status(400).json({ error: 'invalid_username' });
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
    if (!validPassword(b.password)) return res.status(400).json({ error: 'invalid_password' });
    if (byUsername.get(b.username)) return res.status(409).json({ error: 'username_exists' });
    const { lastInsertRowid } = insert.run(b.username, name, role, turma, hashPassword(b.password));
    res.status(201).json(byId.get(Number(lastInsertRowid)));
  });

  r.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const u = byId.get(id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const name = cleanText(b.name, 100);
    if (name) sets.push('name = ?') && vals.push(name);
    const turma = cleanText(b.turma, 40);
    if (turma !== undefined) sets.push('turma = ?') && vals.push(turma);
    let endSessions = false;
    if (typeof b.active === 'boolean') {
      if (id === req.user.id && !b.active) return res.status(400).json({ error: 'cannot_deactivate_self' });
      sets.push('active = ?') && vals.push(b.active ? 1 : 0);
      if (!b.active) endSessions = true;
    }
    if (b.password !== undefined) {
      if (!validPassword(b.password)) return res.status(400).json({ error: 'invalid_password' });
      sets.push('password_hash = ?') && vals.push(hashPassword(b.password));
      endSessions = true;
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    if (endSessions) sessions.destroyUser(id);
    res.json(byId.get(id));
  });

  r.get('/users/:id/programs', (req, res) => {
    const u = byId.get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'not_found' });
    res.json({ user: u, programs: userPrograms.all(u.id) });
  });

  r.get('/programs/:id', (req, res) => {
    const p = program.get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(p);
  });

  return r;
}
