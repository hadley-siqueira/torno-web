// Administração do sistema (usuários em ADMIN_USERNAMES): moderar contas.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';

export default function adminRoutes({ db, sessions }) {
  const r = Router();
  const list = db.prepare(
    `SELECT u.id, u.username, u.name, u.email, u.active, u.created_at,
            (SELECT COUNT(*) FROM programs p WHERE p.user_id = u.id) AS programs,
            (SELECT COUNT(*) FROM turmas t WHERE t.owner_id = u.id) AS turmas
       FROM users u ORDER BY u.created_at DESC`
  );
  const byId = db.prepare('SELECT id, username, active FROM users WHERE id = ?');
  const setActive = db.prepare('UPDATE users SET active = ? WHERE id = ?');

  r.use(requireAdmin);
  r.get('/users', (_req, res) => res.json(list.all()));
  r.patch('/users/:id', (req, res) => {
    const u = byId.get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'not_found' });
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'nothing_to_update' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'cannot_deactivate_self' });
    setActive.run(req.body.active ? 1 : 0, u.id);
    if (!req.body.active) sessions.destroyUser(u.id);
    res.json({ ok: true });
  });
  return r;
}
