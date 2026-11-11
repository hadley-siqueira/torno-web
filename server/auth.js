// Senhas (scrypt), sessões por cookie e middlewares de autorização.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 7;
export const COOKIE = 'sid';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(expected, got);
}

export const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 200;
export const validUsername = (u) => typeof u === 'string' && /^[a-zA-Z0-9._-]{3,40}$/.test(u);

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSessionStore(db) {
  const insert = db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
  const find = db.prepare(
    `SELECT s.id, s.expires_at, u.id AS user_id, u.username, u.name, u.email, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  );
  const touch = db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
  const del = db.prepare('DELETE FROM sessions WHERE id = ?');
  const delUser = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
  const ttl = SESSION_DAYS * 86400 * 1000;

  return {
    ttl,
    create(userId) {
      purge.run(Date.now());
      const id = randomBytes(32).toString('hex');
      insert.run(id, userId, Date.now() + ttl);
      return id;
    },
    get(id) {
      if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
      const s = find.get(id);
      if (!s || s.expires_at < Date.now() || !s.active) return null;
      // renova a validade no máximo uma vez por hora
      if (s.expires_at - Date.now() < ttl - 3600_000) touch.run(Date.now() + ttl, id);
      return { id: s.user_id, username: s.username, name: s.name, email: s.email };
    },
    destroy(id) {
      del.run(id);
    },
    destroyUser(userId) {
      delUser.run(userId);
    },
  };
}

export function cookieOptions(secure) {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_DAYS * 86400 * 1000 };
}

// Limite simples de tentativas de login (em memória)
export function createLoginLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return false;
      if (Date.now() - h.first > windowMs) {
        hits.delete(key);
        return false;
      }
      return h.count >= max;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.first > windowMs) hits.set(key, { first: Date.now(), count: 1 });
      else h.count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

// Administrador do sistema: usuários listados em ADMIN_USERNAMES (separados por vírgula)
export const adminSet = (env = process.env.ADMIN_USERNAMES) =>
  new Set(String(env || '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean));

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'forbidden' });
  next();
}

export const validName = (n) => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 100;
export const validEmail = (e) => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
