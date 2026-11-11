import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgram } from '../shared/gcode.js';
import { COOKIE, createLoginLimiter, createSessionStore, parseCookies, requireUser } from './auth.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import programRoutes from './routes/programs.js';
import adminRoutes from './routes/admin.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ db, secureCookies = process.env.NODE_ENV === 'production', trustProxy = process.env.TRUST_PROXY }) {
  const app = express();
  const sessions = createSessionStore(db);
  const limiter = createLoginLimiter();
  if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? true : trustProxy);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  // Sessão: carrega o usuário a partir do cookie
  app.use((req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    const user = sessions.get(sid);
    if (user) {
      req.user = user;
      req.sessionId = sid;
    }
    next();
  });

  // Proteção CSRF: alterações na API só com JSON e da mesma origem
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // formulários HTML de outros sites só conseguem enviar POST sem JSON; DELETE exige preflight
    if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'bad_origin' });
    next();
  });
  app.use(express.json({ limit: '512kb' }));

  app.use('/api/auth', authRoutes({ db, sessions, limiter, secureCookies }));
  app.use('/api/settings', settingsRoutes({ db }));
  app.use('/api/programs', programRoutes({ db, examplesDir: path.join(ROOT, 'programs') }));
  app.use('/api/admin', adminRoutes({ db, sessions }));

  // Interpretação no servidor: apoio (ex.: correção de exercícios). O cliente interpreta localmente.
  app.post('/api/parse', requireUser, (req, res) => {
    const { code, options } = req.body || {};
    if (typeof code !== 'string') return res.status(400).json({ error: 'invalid_code' });
    const opts = {};
    if (options?.dialect === 'fanuc') opts.dialect = 'fanuc';
    res.json(parseProgram(code, opts));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
