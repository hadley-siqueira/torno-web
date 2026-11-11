import * as THREE from 'three';
import { LatheScene } from './scene.js';
import { api, ApiError } from './api.js';
import { applyI18n, guessLang, rememberLang } from './i18n-dom.js';
import { parseProgram } from '/shared/gcode.js';
import { t, formatMessage, apiErrorText, LANGS } from '/shared/i18n.js';
import { TOOL_TYPES, TOOL_SLOTS, TURRET_DEFAULT, buildTurret, sanitizeTurret, toolName } from '/shared/tools.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const LH = 20; // altura da linha no editor (px), igual ao CSS

const ta = $('code');
const gutter = $('gutter');
const hl = $('hl');
const scene = new LatheScene($('viewport'));

const app = {
  lang: guessLang(),
  user: null,
  settings: {},
  // documento aberto no editor
  doc: { kind: 'new', id: null, name: '', savedCode: '' },
  examples: [],
  mine: [],
  turretCfg: { ...TURRET_DEFAULT },
  turret: buildTurret(TURRET_DEFAULT),
};

const sim = {
  result: null,
  events: [],
  idx: 0,
  t: 0,
  k: 0, // segmento atual dentro do evento
  startedIdx: -1,
  status: 'reset',
  pos: { z: 100, r: 75 },
  home: { x: 150, z: 100 },
  tool: 1,
  state: null,
  rpm: 0,
  dir: 0,
  elapsed: 0,
  single: false,
  turbo: false,
  chipAcc: 0,
  speed: SPEEDS[3],
  lines: [],
};

const tr = (key, params) => t(app.lang, key, params);

// ---------------------------------------------------------------- utilidades
const fmtTime = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* sem armazenamento */
    }
  },
};

// Mensagens guardam uma função de formatação para poderem ser retraduzidas
const messages = [];
function message(fmt, cls = 'info', line = null) {
  messages.push({ fmt, cls, line });
  renderMessage(messages[messages.length - 1]);
  $('messages').scrollTop = 1e9;
}
function renderMessage(m) {
  const div = document.createElement('div');
  div.className = `m ${m.cls}`;
  const text = m.fmt();
  div.textContent = m.line !== null ? tr('S_LINE', { n: m.line + 1, msg: text }) : text;
  if (m.line !== null) div.onclick = () => selectLine(m.line);
  $('messages').appendChild(div);
}
const msgKey = (key, params, cls, line) => message(() => tr(key, params), cls, line);
const msgCode = (m, cls, line) => message(() => formatMessage(app.lang, m), cls, line);
function clearMessages() {
  messages.length = 0;
  $('messages').innerHTML = '';
}
function rerenderMessages() {
  $('messages').innerHTML = '';
  messages.forEach(renderMessage);
}
const errorText = (e) => apiErrorText(app.lang, e instanceof ApiError ? e.code : e.message);

// ---------------------------------------------------------------- idioma
function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  app.lang = lang;
  rememberLang(lang);
  $('langSelect').value = lang;
  applyI18n(lang);
  setStatus(sim.status);
  renderToolList();
  renderProgramSelect();
  updateDocTitle();
  rerenderMessages();
  if (sim.alarmInfo) showAlarmBox(sim.alarmInfo);
}

// ---------------------------------------------------------------- configurações do usuário
let settingsTimer;
function saveSettings(patch) {
  Object.assign(app.settings, patch);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => api('PUT', '/api/settings', app.settings).catch(() => {}), 600);
}

// ---------------------------------------------------------------- editor
let lineMarks = new Map();

function updateGutter() {
  const n = ta.value.split('\n').length;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const div = document.createElement('div');
    const mk = lineMarks.get(i);
    if (mk) {
      div.className = mk.cls;
      div.title = mk.fmt();
    }
    div.textContent = i + 1;
    frag.appendChild(div);
  }
  gutter.replaceChildren(frag);
  syncScroll();
}

function syncScroll() {
  gutter.scrollTop = ta.scrollTop;
  positionHighlight();
}

let hlLine = -1;
function positionHighlight() {
  if (hlLine < 0) {
    hl.style.display = 'none';
    return;
  }
  hl.style.display = 'block';
  hl.style.top = `${8 + hlLine * LH - ta.scrollTop}px`;
}

function highlightLine(line, alarm = false) {
  hlLine = line;
  hl.classList.toggle('alarm', alarm);
  if (line >= 0) {
    const top = line * LH;
    const h = ta.clientHeight;
    if (top < ta.scrollTop + LH || top > ta.scrollTop + h - 3 * LH) ta.scrollTop = Math.max(0, top - h / 3);
    $('currentBlock').textContent = (sim.lines[line] || '').trim();
  } else $('currentBlock').textContent = '';
  syncScroll();
}

function selectLine(line) {
  const lines = ta.value.split('\n');
  let start = 0;
  for (let i = 0; i < line; i++) start += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(start, start + (lines[line] || '').length);
  ta.scrollTop = Math.max(0, line * LH - ta.clientHeight / 3);
  syncScroll();
}

ta.addEventListener('scroll', syncScroll);
let draftTimer;
ta.addEventListener('input', () => {
  lineMarks = new Map();
  updateGutter();
  updateDocTitle();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
});
const updateCursor = () => {
  const before = ta.value.slice(0, ta.selectionStart);
  $('cursorPos').textContent = `Ln ${before.split('\n').length}`;
};
ta.addEventListener('keyup', updateCursor);
ta.addEventListener('click', updateCursor);
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    cycleStart();
  } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveProgram();
  }
});

// ---------------------------------------------------------------- documento / programas
const draftKey = () => `torno-cnc:draft:${app.user?.id}`;
const isDirty = () => ta.value !== app.doc.savedCode;

function saveDraft() {
  store.set(draftKey(), { code: ta.value, doc: app.doc });
}

function updateDocTitle() {
  const d = app.doc;
  const el = $('progName');
  el.textContent = d.name || tr('untitled');
  if (d.kind === 'example') el.title = tr('read_only_example');
  else el.removeAttribute('title');
  if (isDirty()) {
    const s = document.createElement('span');
    s.className = 'dirty';
    s.textContent = ` • ${tr('modified')}`;
    el.appendChild(s);
  }
  $('btnDelete').disabled = d.kind !== 'mine';
}

function setDocument(doc, code) {
  if (sim.status === 'run' || sim.status === 'hold') doReset();
  app.doc = { ...doc, savedCode: doc.savedCode ?? code };
  ta.value = code;
  lineMarks = new Map();
  ta.scrollTop = 0;
  updateGutter();
  updateDocTitle();
  saveDraft();
  if (stockFromHeader(code)) applyStock();
  else doReset();
}

function renderProgramSelect() {
  const sel = $('programSelect');
  const cur = sel.value;
  sel.replaceChildren();
  const group = (label, items) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [value, text] of items) g.appendChild(new Option(text, value));
    sel.appendChild(g);
  };
  group(tr('my_programs'), app.mine.map((p) => [`mine:${p.id}`, p.name]));
  group(tr('examples'), app.examples.map((n) => [`ex:${n}`, n]));
  const want = app.doc.kind === 'mine' ? `mine:${app.doc.id}` : app.doc.kind === 'example' ? `ex:${app.doc.name}` : cur;
  if ([...sel.options].some((o) => o.value === want)) sel.value = want;
}

async function refreshPrograms() {
  const r = await api('GET', '/api/programs');
  app.examples = r.examples;
  app.mine = r.mine;
  renderProgramSelect();
}

async function openSelected() {
  const v = $('programSelect').value;
  if (!v) return;
  if (isDirty() && !confirm(tr('confirm_discard'))) return;
  const [kind, ref] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
  try {
    if (kind === 'ex') {
      const code = await api('GET', `/api/programs/examples/${encodeURIComponent(ref)}`);
      setDocument({ kind: 'example', id: null, name: ref }, code);
    } else {
      const p = await api('GET', `/api/programs/${Number(ref)}`);
      setDocument({ kind: 'mine', id: p.id, name: p.name }, p.code);
    }
    clearMessages();
    msgKey('S_LOADED', { name: app.doc.name }, 'info');
  } catch (e) {
    msgKey('S_OPEN_FAIL', { name: ref }, 'err');
  }
}

function newProgram() {
  if (isDirty() && !confirm(tr('confirm_discard'))) return;
  setDocument({ kind: 'new', id: null, name: '' }, '; \nG18 G90 G95 DIAMON\nT1 D1\nG97 S1000 M3\n\nM30\n');
  clearMessages();
}

async function saveProgram(asNew = false) {
  const d = app.doc;
  try {
    if (d.kind === 'mine' && !asNew) {
      const p = await api('PUT', `/api/programs/${d.id}`, { code: ta.value });
      app.doc = { kind: 'mine', id: p.id, name: p.name, savedCode: p.code };
    } else {
      const suggestion = d.kind === 'example' ? d.name.replace(/^\d+_/, '').toUpperCase() : d.name || 'PROGRAMA_01.MPF';
      const name = prompt(tr('prompt_name'), suggestion)?.trim();
      if (!name) return;
      const p = await api('POST', '/api/programs', { name, code: ta.value });
      app.doc = { kind: 'mine', id: p.id, name: p.name, savedCode: p.code };
    }
    saveDraft();
    await refreshPrograms();
    updateDocTitle();
    msgKey('S_SAVED', { name: app.doc.name }, 'ok');
  } catch (e) {
    message(() => errorText(e), 'err');
  }
}

async function deleteProgram() {
  const d = app.doc;
  if (d.kind !== 'mine' || !confirm(tr('confirm_delete', { name: d.name }))) return;
  try {
    await api('DELETE', `/api/programs/${d.id}`);
    msgKey('S_DELETED', { name: d.name }, 'ok');
    app.doc = { kind: 'new', id: null, name: '', savedCode: '' };
    saveDraft();
    await refreshPrograms();
    updateDocTitle();
  } catch (e) {
    message(() => errorText(e), 'err');
  }
}

// ---------------------------------------------------------------- entrega na turma
async function openSubmitDialog() {
  if (app.doc.kind !== 'mine' || isDirty()) return msgKey('submit_need_save', {}, 'warn');
  const { joined } = await api('GET', '/api/turmas');
  if (!joined.length) return msgKey('submit_no_turmas', {}, 'warn');
  $('submitProg').textContent = app.doc.name;
  $('submitTurma').replaceChildren(...joined.map((j) => new Option(`${j.name} – ${j.owner_name}`, j.id)));
  $('submitError').textContent = '';
  $('dlgSubmit').showModal();
}

$('formSubmit').onsubmit = async (e) => {
  e.preventDefault();
  const sel = $('submitTurma');
  try {
    await api('POST', `/api/turmas/${sel.value}/submissions`, { programId: app.doc.id });
    $('dlgSubmit').close();
    const turma = sel.options[sel.selectedIndex].text;
    msgKey('submit_ok', { name: app.doc.name, turma }, 'ok');
  } catch (ex) {
    $('submitError').textContent = errorText(ex);
  }
};
$('submitCancel').onclick = () => $('dlgSubmit').close();

// ---------------------------------------------------------------- torre
// Cada posição recebe um tipo do catálogo (ou fica vazia), como na preparação da máquina
function renderToolList() {
  const box = $('toolList');
  box.replaceChildren();
  const help = document.createElement('p');
  help.className = 'muted small';
  help.textContent = tr('turret_help');
  box.appendChild(help);
  for (let n = 1; n <= TOOL_SLOTS; n++) {
    const row = document.createElement('label');
    row.className = 'turret-row';
    const tag = document.createElement('b');
    tag.textContent = `T${n}`;
    const sel = document.createElement('select');
    sel.appendChild(new Option(tr('empty_station'), ''));
    for (const [type, def] of Object.entries(TOOL_TYPES)) sel.appendChild(new Option(def.name[app.lang] || def.name.pt, type));
    sel.value = app.turretCfg[n] || '';
    const tool = app.turret[n];
    if (tool) sel.title = tool.detail[app.lang] || tool.detail.pt;
    sel.onchange = () => setTurretSlot(n, sel.value);
    row.append(tag, sel);
    box.appendChild(row);
  }
  const reset = document.createElement('button');
  reset.className = 'btn sm';
  reset.textContent = tr('restore_default');
  reset.onclick = () => applyTurret({ ...TURRET_DEFAULT });
  box.appendChild(reset);
}

function applyTurret(cfg, save = true) {
  if (sim.status === 'run' || sim.status === 'hold') {
    msgKey('S_STOCK_BUSY', {}, 'warn');
    renderToolList();
    return;
  }
  app.turretCfg = sanitizeTurret(cfg);
  app.turret = buildTurret(app.turretCfg);
  scene.setTurret(app.turret);
  if (save) saveSettings({ turret: app.turretCfg });
  renderToolList();
  doReset();
}

function setTurretSlot(n, type) {
  applyTurret({ ...app.turretCfg, [n]: type });
  const tool = app.turret[n];
  msgKey('turret_changed', { t: n, name: tool ? toolName(tool, app.lang) : tr('empty_station') }, 'info');
}

// ---------------------------------------------------------------- peça bruta
function stockParams() {
  return {
    diameter: Math.min(200, Math.max(5, Number($('stockD').value) || 50)),
    length: Math.min(300, Math.max(10, Number($('stockL').value) || 80)),
    faceZ: Math.min(10, Math.max(0, Number($('stockF').value) || 0)),
  };
}

function setStockInputs(s) {
  $('stockD').value = s.diameter;
  $('stockL').value = s.length;
  $('stockF').value = s.faceZ;
}

function applyStock() {
  const p = stockParams();
  scene.setStock(p);
  sim.home = { x: Math.max(150, p.diameter + 40), z: 100 };
  saveSettings({ stock: p });
  doReset();
}

// Lê "BRUTO: D50 x 80" (ou "STOCK: D50 x 80") e "FACE EM Z1" do cabeçalho do programa
function stockFromHeader(code) {
  const m = code.match(/(?:BRUTO|STOCK)[:\s]*D\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return false;
  $('stockD').value = m[1];
  $('stockL').value = m[2];
  const f = code.match(/(?:FACE\s+(?:BRUTA\s+)?EM|RAW\s+FACE\s+AT)\s+Z\s*(\d+(?:\.\d+)?)/i);
  if (f) $('stockF').value = f[1];
  return true;
}

// ---------------------------------------------------------------- controle
function setStatus(s) {
  sim.status = s;
  const pill = $('statusState');
  pill.textContent = tr(`st_${s}`);
  pill.className = `pill ${s === 'reset' ? '' : s}`;
  ta.readOnly = s === 'run' || s === 'hold';
}

function prepare() {
  clearMessages();
  lineMarks = new Map();
  const res = parseProgram(ta.value, { home: sim.home, dialect: app.settings.dialect || 'sinumerik', turret: app.turret });
  sim.result = res;
  sim.events = res.events;
  sim.lines = ta.value.split('\n');

  for (const w of res.warnings) {
    lineMarks.set(w.line, { cls: 'warn', fmt: () => formatMessage(app.lang, w) });
    msgCode(w, 'warn', w.line);
  }
  if (res.alarm) {
    const a = res.alarm;
    lineMarks.set(a.line, { cls: 'err', fmt: () => formatMessage(app.lang, a) });
    message(() => tr('S_WILL_ALARM', { msg: formatMessage(app.lang, a) }), 'err', a.line);
  }
  const s = res.stats;
  msgKey(
    'S_SUMMARY',
    { blocks: s.blocks, time: fmtTime(s.totalTime), tools: s.tools.map((n) => 'T' + n).join(', '), rpm: s.maxRpm },
    'ok'
  );
  updateGutter();
  scene.setPath(sim.events);
}

function rewind() {
  sim.idx = 0;
  sim.t = 0;
  sim.k = 0;
  sim.startedIdx = -1;
  sim.elapsed = 0;
  sim.pos = { z: sim.home.z, r: sim.home.x / 2 };
  sim.tool = app.turret[1] ? 1 : Number(Object.keys(app.turret)[0] || 1);
  sim.state = null;
  sim.rpm = 0;
  sim.dir = 0;
  sim.turbo = false;
  sim.alarmInfo = null;
  scene.stock.reset();
  scene.clearFalling();
  scene.setTool(sim.tool);
  scene.setToolPos(sim.pos.z, sim.pos.r);
  scene.setToolAlarm(false);
  scene.setProgress(0, 0);
  $('alarm').classList.add('hidden');
  highlightLine(-1);
}

function cycleStart(turbo = false) {
  if (sim.status === 'run') {
    if (turbo) sim.turbo = true;
    return;
  }
  if (sim.status === 'hold') {
    sim.turbo = turbo;
    setStatus('run');
    return;
  }
  // reset / fim / alarme -> reinicia o programa
  prepare();
  rewind();
  sim.turbo = turbo;
  setStatus('run');
}

function feedHold() {
  if (sim.status === 'run') {
    sim.turbo = false;
    setStatus('hold');
  }
}

function doReset() {
  if (!scene.stock) return;
  rewind();
  setStatus('reset');
  if (sim.result) scene.setPath(sim.events);
}

function showAlarmBox(info) {
  const box = $('alarm');
  box.textContent = tr('S_ALARM_BOX', { n: info.line + 1, msg: info.fmt() });
  box.classList.remove('hidden');
}

// fmt: função que devolve o texto do alarme no idioma atual
function raiseAlarm(fmt, line) {
  setStatus('alarm');
  sim.turbo = false;
  sim.alarmInfo = { fmt, line };
  scene.setToolAlarm(true);
  showAlarmBox(sim.alarmInfo);
  lineMarks.set(line, { cls: 'err', fmt });
  updateGutter();
  highlightLine(line, true);
  message(fmt, 'err', line);
}

// ---------------------------------------------------------------- simulação
function rpmFor(state, r) {
  if (!state || !state.spindle) return 0;
  if (state.css) return Math.min(state.lims, 4000, (state.Vc * 1000) / (Math.PI * Math.max(2 * Math.abs(r), 0.01)));
  return Math.min(state.S, 4000);
}

function onEventStart(ev) {
  sim.state = ev.state;
  sim.dir = ev.state.spindle;
  highlightLine(ev.line);
  switch (ev.type) {
    case 'toolchange':
      sim.tool = ev.state.tool;
      scene.setTool(sim.tool);
      msgCode(ev, 'info', ev.line);
      break;
    case 'pause':
      msgCode(ev, 'info', ev.line);
      setStatus('hold');
      return 'consumed';
    case 'alarm':
      raiseAlarm(() => formatMessage(app.lang, ev), ev.line);
      return 'stop';
    case 'end': {
      setStatus('end');
      const time = fmtTime(sim.elapsed);
      msgKey('S_END_TIME', { time }, 'ok', ev.line);
      return 'consumed';
    }
  }
  return null;
}

const partMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 0.75, roughness: 0.32 });

function carveSegment(z0, r0, z1, r1, type, line) {
  const stock = scene.stock;
  const tool = app.turret[sim.tool];
  const ch = scene.chuckInfo;
  // colisão com a placa (castanhas)
  if (Math.min(z0, z1) < ch.zFront && Math.min(r0, r1) < ch.jawOuter) {
    raiseAlarm(() => tr('A_CHUCK'), line);
    return false;
  }
  if (!tool) return true;
  if (tool.kind === 'external' && r0 >= stock.R0 && r1 >= stock.R0) return true;
  const L = Math.hypot(z1 - z0, r1 - r0);
  const n = Math.max(1, Math.ceil(L / (stock.h * 0.7)));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const z = z0 + (z1 - z0) * f;
    const r = r0 + (r1 - r0) * f;
    const res = stock.carve(tool, z, r);
    if (res.collision || res.offCenter) {
      sim.pos = { z, r };
      raiseAlarm(() => tr(res.collision ? 'A_BAR' : 'A_DRILL_CENTER'), line);
      return false;
    }
    if (res.removed > 0) {
      if (type === 'rapid' && res.removed > 0.05) {
        sim.pos = { z, r };
        raiseAlarm(() => tr('A_RAPID'), line);
        return false;
      }
      if (sim.rpm <= 0) {
        sim.pos = { z, r };
        raiseAlarm(() => tr('A_SPINDLE'), line);
        return false;
      }
      sim.chipAcc += res.removed;
    }
    if (res.parted >= 0) {
      scene.dropPart(stock.detach(res.parted, partMaterial));
      msgKey('S_PARTED', {}, 'ok', line);
    }
  }
  return true;
}

// Move a ferramenta ao longo do evento até o tempo tb, removendo material
function moveAlong(ev, tb) {
  const pts = ev.pts;
  let { z, r } = sim.pos;
  while (sim.k < pts.length - 1 && pts[sim.k + 1][2] <= tb) {
    const p = pts[sim.k + 1];
    sim.rpm = p[3];
    if (!carveSegment(z, r, p[0], p[1], ev.type, ev.line)) return false;
    z = p[0];
    r = p[1];
    sim.k++;
  }
  if (sim.k < pts.length - 1) {
    const a = pts[sim.k];
    const b = pts[sim.k + 1];
    const f = (tb - a[2]) / Math.max(1e-12, b[2] - a[2]);
    const nz = a[0] + (b[0] - a[0]) * f;
    const nr = a[1] + (b[1] - a[1]) * f;
    sim.rpm = a[3] + (b[3] - a[3]) * f;
    if (!carveSegment(z, r, nz, nr, ev.type, ev.line)) return false;
    z = nz;
    r = nr;
  }
  sim.pos = { z, r };
  return true;
}

function advance(dt) {
  let budget = sim.turbo ? Infinity : dt * sim.speed;
  const t0 = performance.now();
  const evs = sim.events;
  while (sim.status === 'run' && budget > 0 && sim.idx < evs.length) {
    if (sim.turbo && performance.now() - t0 > 30) break;
    const ev = evs[sim.idx];
    if (sim.startedIdx !== sim.idx) {
      sim.startedIdx = sim.idx;
      sim.k = 0;
      const act = onEventStart(ev);
      if (act === 'stop') return;
      if (act === 'consumed') {
        sim.idx++;
        sim.t = 0;
        return;
      }
    }
    const dur = ev.duration || 0;
    const step = Math.min(budget, dur - sim.t);
    if (ev.pts && !moveAlong(ev, sim.t + step)) return;
    if (!ev.pts) sim.rpm = rpmFor(ev.state, sim.pos.r);
    sim.t += step;
    sim.elapsed += step;
    budget -= step;
    if (sim.t >= dur - 1e-9) {
      if (ev.pts) {
        const last = ev.pts[ev.pts.length - 1];
        sim.pos = { z: last[0], r: last[1] };
        sim.k = ev.pts.length - 1;
      }
      sim.idx++;
      sim.t = 0;
      const next = evs[sim.idx];
      if (sim.single && next && next.line !== ev.line) {
        setStatus('hold');
        highlightLine(next.line);
      }
    }
  }
  if (sim.idx >= evs.length && sim.status === 'run') setStatus('end');
}

// ---------------------------------------------------------------- DRO
function updateDRO() {
  $('droX').textContent = (sim.pos.r * 2).toFixed(3);
  $('droZ').textContent = sim.pos.z.toFixed(3);
  const st = sim.state;
  const ev = sim.events[Math.min(sim.idx, sim.events.length - 1)];
  $('droS').textContent = Math.round(sim.status === 'run' || sim.status === 'hold' ? sim.rpm : 0);
  $('droDir').textContent = sim.dir === 3 ? '↻ M3' : sim.dir === 4 ? '↺ M4' : 'M5';
  $('droDir').style.color = sim.dir ? 'var(--ok)' : 'var(--muted)';
  if (ev && ev.type === 'rapid' && sim.status === 'run') {
    $('droF').textContent = tr('rapid');
    $('droFu').textContent = '';
  } else if (st) {
    $('droF').textContent = st.feedPerRev ? st.F.toFixed(3) : Math.round(st.F);
    $('droFu').textContent = st.feedPerRev ? 'mm/rot' : 'mm/min';
  }
  $('droT').textContent = sim.tool;
  $('droTn').textContent = toolName(app.turret[sim.tool], app.lang);
  if (st) {
    $('droG').textContent = st.motion === 33 ? 'G33' : `G${st.motion}`;
    $('droMode').textContent = `${st.abs ? 'G90' : 'G91'} ${st.feedPerRev ? 'G95' : 'G94'} ${st.css ? `G96 ${st.Vc}m/min` : 'G97'}`;
  }
  $('statusTime').textContent = `${fmtTime(sim.elapsed)} / ${fmtTime(sim.result?.stats.totalTime)}`;
}

// ---------------------------------------------------------------- laço
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (sim.status === 'run') {
    advance(dt);
    scene.setToolPos(sim.pos.z, sim.pos.r);
    if (sim.events.length) scene.setProgress(sim.idx, sim.k);
    if (sim.chipAcc > 0 && !sim.turbo) {
      scene.spawnChips(sim.pos.z, sim.pos.r, Math.min(12, 1 + Math.floor(sim.chipAcc * 3)));
    }
    sim.chipAcc = 0;
  }
  const spinning = sim.status === 'run' || sim.status === 'hold';
  scene.updateSpindle(spinning ? sim.rpm : 0, spinning ? sim.dir : 0, dt);
  scene.render(dt);
  updateDRO();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- conta
async function logout() {
  saveDraft();
  await api('POST', '/api/auth/logout', {}).catch(() => {});
  location.href = '/login.html';
}

function openPasswordDialog() {
  $('pwCurrent').value = '';
  $('pwNext').value = '';
  $('pwError').textContent = '';
  $('dlgPassword').showModal();
}

$('formPassword').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/auth/password', { current: $('pwCurrent').value, next: $('pwNext').value });
    $('dlgPassword').close();
    msgKey('password_changed', {}, 'ok');
  } catch (ex) {
    $('pwError').textContent = ex.code === 'login_failed' ? tr('login_failed') : errorText(ex);
  }
};
$('pwCancel').onclick = () => $('dlgPassword').close();

// ---------------------------------------------------------------- eventos de UI
$('btnStart').onclick = () => cycleStart(false);
$('btnHold').onclick = feedHold;
$('btnReset').onclick = doReset;
$('btnFinish').onclick = () => cycleStart(true);
$('btnSingle').onclick = () => {
  sim.single = !sim.single;
  $('btnSingle').classList.toggle('on', sim.single);
};
$('btnOpen').onclick = openSelected;
$('btnNew').onclick = newProgram;
$('btnSave').onclick = () => saveProgram(false);
$('btnSaveAs').onclick = () => saveProgram(true);
$('btnDelete').onclick = deleteProgram;
$('btnSubmit').onclick = openSubmitDialog;
$('btnLogout').onclick = logout;
$('btnPassword').onclick = openPasswordDialog;
$('langSelect').onchange = (e) => {
  setLang(e.target.value);
  saveSettings({ lang: app.lang });
};
$('dialectSelect').onchange = (e) => saveSettings({ dialect: e.target.value });
$('btnApplyStock').onclick = () => {
  if (sim.status === 'run' || sim.status === 'hold') return msgKey('S_STOCK_BUSY', {}, 'warn');
  applyStock();
};
$('speed').oninput = (e) => {
  const i = Number(e.target.value);
  sim.speed = SPEEDS[i];
  $('speedVal').textContent = `${sim.speed}×`;
  saveSettings({ speed: i });
};
$('chkPath').onchange = (e) => {
  scene.setShowPath(e.target.checked);
  saveSettings({ showPath: e.target.checked });
};
$('chkSection').onchange = (e) => {
  scene.setSection(e.target.checked);
  saveSettings({ section: e.target.checked });
};
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => scene.frameView(b.dataset.view)));

// ---------------------------------------------------------------- início
(async function init() {
  applyI18n(app.lang);
  let me;
  try {
    me = await api('GET', '/api/auth/me');
  } catch {
    return; // api() já redirecionou para o login
  }
  app.user = me.user;
  $('userName').textContent = app.user.name;
  $('linkAdmin').classList.toggle('hidden', !app.user.isAdmin);

  app.settings = await api('GET', '/api/settings').catch(() => ({}));
  const s = app.settings;
  if (s.stock) setStockInputs(s.stock);
  if (s.turret) {
    app.turretCfg = sanitizeTurret(s.turret);
    app.turret = buildTurret(app.turretCfg);
    scene.setTurret(app.turret);
  }
  if (s.dialect) $('dialectSelect').value = s.dialect;
  const speedIdx = Number.isInteger(s.speed) ? Math.min(SPEEDS.length - 1, s.speed) : 3;
  sim.speed = SPEEDS[speedIdx];
  $('speed').value = speedIdx;
  $('speedVal').textContent = `${sim.speed}×`;
  $('chkPath').checked = s.showPath ?? true;
  $('chkSection').checked = s.section ?? false;
  scene.setShowPath($('chkPath').checked);
  scene.setSection($('chkSection').checked);
  setLang(LANGS.includes(s.lang) ? s.lang : app.lang);

  await refreshPrograms();

  const draft = store.get(draftKey());
  if (draft && typeof draft.code === 'string') {
    app.doc = draft.doc || { kind: 'new', id: null, name: '', savedCode: '' };
    ta.value = draft.code;
    updateGutter();
    updateDocTitle();
    renderProgramSelect();
    applyStock();
    msgKey('S_RESTORED', {}, 'info');
  } else {
    applyStock();
    const first = app.examples.find((n) => n.startsWith('02_')) || app.examples[0];
    if (first) {
      $('programSelect').value = `ex:${first}`;
      await openSelected();
    }
  }
  setStatus('reset');
  requestAnimationFrame(frame);
})();
