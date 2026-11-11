import express from 'express';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgram } from './shared/gcode.js';
import { TOOLS } from './shared/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRAMS_DIR = path.join(__dirname, 'programs');
const NAME_RE = /^[\w-]{1,60}\.(mpf|nc|gcode|txt)$/i;
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));

// Interpreta o G-code e devolve a lista de eventos para a simulação
app.post('/api/parse', (req, res) => {
  const { code, options } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'Campo "code" (string) é obrigatório' });
  const opts = {};
  if (options?.home && Number.isFinite(options.home.x) && Number.isFinite(options.home.z)) {
    opts.home = { x: options.home.x, z: options.home.z };
  }
  try {
    res.json(parseProgram(code, opts));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tools', (_req, res) => res.json(TOOLS));

app.get('/api/programs', async (_req, res) => {
  const files = (await readdir(PROGRAMS_DIR)).filter((f) => NAME_RE.test(f)).sort();
  res.json(files);
});

app.get('/api/programs/:name', async (req, res) => {
  if (!NAME_RE.test(req.params.name)) return res.status(400).json({ error: 'Nome inválido' });
  try {
    res.type('text/plain').send(await readFile(path.join(PROGRAMS_DIR, req.params.name), 'utf8'));
  } catch {
    res.status(404).json({ error: 'Programa não encontrado' });
  }
});

app.put('/api/programs/:name', express.text({ limit: '1mb' }), async (req, res) => {
  if (!NAME_RE.test(req.params.name)) return res.status(400).json({ error: 'Nome inválido (use letras, números, _ ou - e extensão .mpf/.nc)' });
  if (typeof req.body !== 'string') return res.status(400).json({ error: 'Envie o programa como text/plain' });
  await writeFile(path.join(PROGRAMS_DIR, req.params.name), req.body, 'utf8');
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Simulador de torno em http://localhost:${PORT}`));
