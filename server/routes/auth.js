import { Router } from 'express';
import {
  COOKIE, cookieOptions, hashPassword, requireUser, validEmail, validName, validPassword, validUsername, verifyPassword,
} from '../auth.js';

export default function authRoutes({ db, sessions, limiter, signupLimiter, secureCookies }) {
  const r = Router();
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const byEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const insert = db.prepare('INSERT INTO users (username, name, email, password_hash) VALUES (?, ?, ?, ?)');
  const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  // usado para gastar o mesmo tempo quando o usuário não existe
  const dummyHash = hashPassword('dummy-password');

  const startSession = (res, userId) => res.cookie(COOKIE, sessions.create(userId), cookieOptions(secureCookies));

  r.post('/signup', (req, res) => {
    const b = req.body || {};
    const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim() : null;
    if (!validName(b.name)) return res.status(400).json({ error: 'invalid_name' });
    if (!validUsername(b.username)) return res.status(400).json({ error: 'invalid_username' });
    if (!validPassword(b.password)) return res.status(400).json({ error: 'invalid_password' });
    if (email !== null && !validEmail(email)) return res.status(400).json({ error: 'invalid_email' });
    if (signupLimiter.blocked(req.ip)) return res.status(429).json({ error: 'signup_limit' });
    if (byUsername.get(b.username)) return res.status(409).json({ error: 'username_exists' });
    if (email && byEmail.get(email)) return res.status(409).json({ error: 'email_exists' });
    let lastInsertRowid;
    try {
      ({ lastInsertRowid } = insert.run(b.username, b.name.trim(), email, hashPassword(b.password)));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_exists' });
      throw e;
    }
    signupLimiter.fail(req.ip); // conta cadastros por IP
    startSession(res, Number(lastInsertRowid));
    res.status(201).json({ ok: true });
  });

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
    startSession(res, u.id);
    res.json({ ok: true });
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
    startSession(res, u.id);
    res.json({ ok: true });
  });

  return r;
}
