import { Router } from 'express';
import { requireUser } from '../auth.js';
import { LANGS } from '../../shared/i18n.js';
import { sanitizeTurret } from '../../shared/tools.js';
import { MATERIALS, TURRET_SIDES } from '../../shared/appearance.js';
import { sanitizeStock } from '../../shared/setup.js';

/** Aceita só as chaves conhecidas, com tipos e faixas válidos. */
export function sanitizeSettings(input = {}) {
  const out = {};
  if (LANGS.includes(input.lang)) out.lang = input.lang;
  if (['sinumerik', 'fanuc'].includes(input.dialect)) out.dialect = input.dialect;
  if (Number.isInteger(input.speed) && input.speed >= 0 && input.speed <= 20) out.speed = input.speed;
  if (typeof input.showPath === 'boolean') out.showPath = input.showPath;
  if (typeof input.section === 'boolean') out.section = input.section;
  if (typeof input.rulers === 'boolean') out.rulers = input.rulers;
  if (Object.hasOwn(MATERIALS, input.material ?? '')) out.material = input.material;
  if (TURRET_SIDES.includes(input.turretSide)) out.turretSide = input.turretSide;
  const turret = sanitizeTurret(input.turret);
  if (turret) out.turret = turret;
  const stock = sanitizeStock(input.stock);
  if (stock) out.stock = stock;
  return out;
}

export default function settingsRoutes({ db }) {
  const r = Router();
  const get = db.prepare('SELECT json FROM settings WHERE user_id = ?');
  const put = db.prepare(
    'INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json'
  );
  const load = (id) => {
    const row = get.get(id);
    try {
      return row ? JSON.parse(row.json) : {};
    } catch {
      return {};
    }
  };

  r.use(requireUser);
  r.get('/', (req, res) => res.json(load(req.user.id)));
  r.put('/', (req, res) => {
    const merged = { ...load(req.user.id), ...sanitizeSettings(req.body) };
    put.run(req.user.id, JSON.stringify(merged));
    res.json(merged);
  });
  return r;
}
