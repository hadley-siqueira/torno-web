import { Router } from 'express';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '../auth.js';

export const NAME_RE = /^[A-Za-z0-9_-]{1,40}(\.(mpf|spf|nc|txt))?$/i;
const EXAMPLE_RE = /^[\w-]{1,60}\.(mpf|spf|nc|txt)$/i;
const MAX_CODE = 256 * 1024;
const MAX_PROGRAMS = 500;

export default function programRoutes({ db, examplesDir }) {
  const r = Router();
  const list = db.prepare('SELECT id, name, updated_at FROM programs WHERE user_id = ? ORDER BY name');
  const get = db.prepare('SELECT id, name, code, updated_at FROM programs WHERE id = ? AND user_id = ?');
  const byName = db.prepare('SELECT id FROM programs WHERE user_id = ? AND name = ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM programs WHERE user_id = ?');
  const insert = db.prepare('INSERT INTO programs (user_id, name, code) VALUES (?, ?, ?)');
  const update = db.prepare("UPDATE programs SET name = ?, code = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?");
  const del = db.prepare('DELETE FROM programs WHERE id = ? AND user_id = ?');

  const listExamples = async () => (await readdir(examplesDir)).filter((f) => EXAMPLE_RE.test(f)).sort();

  r.use(requireUser);

  r.get('/', async (req, res) => {
    res.json({ examples: await listExamples(), mine: list.all(req.user.id) });
  });

  r.get('/examples/:name', async (req, res) => {
    if (!EXAMPLE_RE.test(req.params.name)) return res.status(400).json({ error: 'invalid_name' });
    try {
      res.type('text/plain').send(await readFile(path.join(examplesDir, req.params.name), 'utf8'));
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  r.get('/:id', (req, res) => {
    const p = get.get(Number(req.params.id), req.user.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(p);
  });

  const validate = (name, code) => {
    if (!NAME_RE.test(name || '')) return 'invalid_name';
    if (typeof code !== 'string' || code.length > MAX_CODE) return 'invalid_code';
    return null;
  };

  r.post('/', (req, res) => {
    const { name, code } = req.body || {};
    const err = validate(name, code);
    if (err) return res.status(400).json({ error: err });
    if (byName.get(req.user.id, name)) return res.status(409).json({ error: 'name_exists' });
    if (count.get(req.user.id).n >= MAX_PROGRAMS) return res.status(400).json({ error: 'too_many_programs' });
    const { lastInsertRowid } = insert.run(req.user.id, name, code);
    res.status(201).json(get.get(Number(lastInsertRowid), req.user.id));
  });

  r.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = get.get(id, req.user.id);
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const name = req.body?.name ?? cur.name;
    const code = req.body?.code ?? cur.code;
    const err = validate(name, code);
    if (err) return res.status(400).json({ error: err });
    const other = byName.get(req.user.id, name);
    if (other && other.id !== id) return res.status(409).json({ error: 'name_exists' });
    update.run(name, code, id, req.user.id);
    res.json(get.get(id, req.user.id));
  });

  r.delete('/:id', (req, res) => {
    const { changes } = del.run(Number(req.params.id), req.user.id);
    if (!changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  return r;
}
