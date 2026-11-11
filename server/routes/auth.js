import { Router } from 'express';
import { COOKIE, cookieOptions, hashPassword, requireUser, validPassword, verifyPassword } from '../auth.js';

export default function authRoutes({ db, sessions, limiter, secureCookies }) {
  const r = Router();
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  // usado para gastar o mesmo tempo quando o usuário não existe
  const dummyHash = hashPassword('dummy-password');

  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, turma: u.turma });

  r.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'invalid_input' });
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (limiter.blocked(key)) return res.status(429).json({ error: 'login_locked' });
    const u = byUsername.get(username);
    const ok = verifyPassword(password, u ? u.password_hash : dummyHash) && u && u.active;
    if (!ok) {
      limiter.fail(key);
      return res.status(401).json({ error: 'login_failed' });
    }
    limiter.reset(key);
    res.cookie(COOKIE, sessions.create(u.id), cookieOptions(secureCookies));
    res.json({ user: publicUser(u) });
  });

  r.post('/logout', (req, res) => {
    if (req.sessionId) sessions.destroy(req.sessionId);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', requireUser, (req, res) => res.json({ user: req.user }));

  r.post('/password', requireUser, (req, res) => {
    const { current, next } = req.body || {};
    const u = byId.get(req.user.id);
    if (typeof current !== 'string' || !verifyPassword(current, u.password_hash)) {
      return res.status(400).json({ error: 'login_failed' });
    }
    if (!validPassword(next)) return res.status(400).json({ error: 'invalid_password' });
    setHash.run(hashPassword(next), u.id);
    sessions.destroyUser(u.id); // encerra as outras sessões
    res.cookie(COOKIE, sessions.create(u.id), cookieOptions(secureCookies));
    res.json({ ok: true });
  });

  return r;
}
