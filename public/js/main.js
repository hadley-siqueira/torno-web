import * as THREE from 'three';
import { LatheScene } from './scene.js';
import { TOOLS } from '/shared/tools.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const LH = 20; // altura da linha no editor (px), igual ao CSS
const STORAGE_KEY = 'torno-cnc:code';

const ta = $('code');
const gutter = $('gutter');
const hl = $('hl');
const scene = new LatheScene($('viewport'));

const sim = {
  result: null,
  events: [],
  parsedCode: null,
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

// ---------------------------------------------------------------- utilidades
const fmtTime = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: ignora */
  }
};

function message(text, cls = 'info', line = null) {
  const div = document.createElement('div');
  div.className = `m ${cls}`;
  div.textContent = line !== null ? `Linha ${line + 1}: ${text}` : text;
  if (line !== null) div.onclick = () => selectLine(line);
  $('messages').appendChild(div);
  $('messages').scrollTop = 1e9;
}
const clearMessages = () => ($('messages').innerHTML = '');

// ---------------------------------------------------------------- editor
let lineMarks = new Map();

function updateGutter() {
  const n = ta.value.split('\n').length;
  let html = '';
  for (let i = 0; i < n; i++) {
    const mk = lineMarks.get(i);
    html += `<div class="${mk ? mk.cls : ''}" ${mk ? `title="${mk.msg.replace(/"/g, '&quot;')}"` : ''}>${i + 1}</div>`;
  }
  gutter.innerHTML = html;
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
let saveTimer;
ta.addEventListener('input', () => {
  lineMarks = new Map();
  updateGutter();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => lsSet(STORAGE_KEY, ta.value), 400);
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
  }
});

// ---------------------------------------------------------------- peça bruta
function stockParams() {
  return {
    diameter: Math.min(200, Math.max(5, Number($('stockD').value) || 50)),
    length: Math.min(300, Math.max(10, Number($('stockL').value) || 80)),
    faceZ: Math.min(10, Math.max(0, Number($('stockF').value) || 0)),
  };
}

function applyStock() {
  const p = stockParams();
  scene.setStock(p);
  sim.home = { x: Math.max(150, p.diameter + 40), z: 100 };
  doReset();
}

// Lê "BRUTO: D50 x 80" e "FACE EM Z1" do cabeçalho do programa
function stockFromHeader(code) {
  const m = code.match(/BRUTO[:\s]*D\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return false;
  $('stockD').value = m[1];
  $('stockL').value = m[2];
  const f = code.match(/FACE\s+(?:BRUTA\s+)?EM\s+Z\s*(\d+(?:\.\d+)?)/i);
  if (f) $('stockF').value = f[1];
  return true;
}

// ---------------------------------------------------------------- controle
function setStatus(s) {
  sim.status = s;
  const pill = $('statusState');
  const labels = { reset: 'RESET', run: 'EXECUTANDO', hold: 'PARADO', alarm: 'ALARME', end: 'FIM' };
  pill.textContent = labels[s];
  pill.className = `pill ${s === 'run' ? 'run' : s === 'hold' ? 'hold' : s === 'alarm' ? 'alarm' : s === 'end' ? 'end' : ''}`;
  ta.readOnly = s === 'run' || s === 'hold';
}

async function prepare() {
  clearMessages();
  lineMarks = new Map();
  let res;
  try {
    const r = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ta.value, options: { home: sim.home } }),
    });
    res = await r.json();
    if (!r.ok) throw new Error(res.error || r.statusText);
  } catch (e) {
    message(`Falha ao interpretar o programa: ${e.message}`, 'err');
    return false;
  }
  sim.result = res;
  sim.events = res.events;
  sim.parsedCode = ta.value;
  sim.lines = ta.value.split('\n');

  for (const w of res.warnings) {
    lineMarks.set(w.line, { cls: 'warn', msg: w.message });
    message(w.message, 'warn', w.line);
  }
  if (res.alarm) {
    lineMarks.set(res.alarm.line, { cls: 'err', msg: res.alarm.message });
    message(`O programa vai parar com alarme: ${res.alarm.message}`, 'err', res.alarm.line);
  }
  const s = res.stats;
  message(
    `${s.blocks} blocos · tempo estimado ${fmtTime(s.totalTime)} · ferramentas ${s.tools.map((t) => 'T' + t).join(', ')} · rpm máx ${s.maxRpm}`,
    'ok'
  );
  updateGutter();
  scene.setPath(sim.events);
  return true;
}

function rewind() {
  sim.idx = 0;
  sim.t = 0;
  sim.k = 0;
  sim.startedIdx = -1;
  sim.elapsed = 0;
  sim.pos = { z: sim.home.z, r: sim.home.x / 2 };
  sim.tool = 1;
  sim.state = null;
  sim.rpm = 0;
  sim.dir = 0;
  sim.turbo = false;
  scene.stock.reset();
  scene.clearFalling();
  scene.setTool(sim.tool);
  scene.setToolPos(sim.pos.z, sim.pos.r);
  scene.setToolAlarm(false);
  scene.setProgress(0, 0);
  $('alarm').classList.add('hidden');
  highlightLine(-1);
}

async function cycleStart(turbo = false) {
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
  if (!(await prepare())) return;
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
  rewind();
  setStatus('reset');
  if (sim.result) scene.setPath(sim.events);
}

function raiseAlarm(msg, line) {
  setStatus('alarm');
  sim.turbo = false;
  scene.setToolAlarm(true);
  const box = $('alarm');
  box.textContent = `⚠ Alarme – linha ${line + 1}: ${msg}`;
  box.classList.remove('hidden');
  lineMarks.set(line, { cls: 'err', msg });
  updateGutter();
  highlightLine(line, true);
  message(msg, 'err', line);
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
      message(ev.message, 'info', ev.line);
      break;
    case 'pause':
      message(ev.message, 'info', ev.line);
      setStatus('hold');
      return 'consumed';
    case 'alarm':
      raiseAlarm(ev.message, ev.line);
      return 'stop';
    case 'end':
      setStatus('end');
      message(`Fim de programa – tempo de usinagem ${fmtTime(sim.elapsed)}`, 'ok', ev.line);
      return 'consumed';
  }
  return null;
}

const partMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 0.75, roughness: 0.32 });

function carveSegment(z0, r0, z1, r1, type, line) {
  const stock = scene.stock;
  const tool = TOOLS[sim.tool];
  const ch = scene.chuckInfo;
  // colisão com a placa (castanhas)
  if (Math.min(z0, z1) < ch.zFront && Math.min(r0, r1) < ch.jawOuter) {
    raiseAlarm('Colisão da ferramenta com a placa!', line);
    return false;
  }
  if (r0 >= stock.R0 && r1 >= stock.R0) return true;
  const L = Math.hypot(z1 - z0, r1 - r0);
  const n = Math.max(1, Math.ceil(L / (stock.h * 0.7)));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const z = z0 + (z1 - z0) * f;
    const r = r0 + (r1 - r0) * f;
    const res = stock.carve(tool, z, r);
    if (res.removed > 0) {
      if (type === 'rapid' && res.removed > 0.05) {
        sim.pos = { z, r };
        raiseAlarm('Colisão: movimento rápido (G0) dentro do material', line);
        return false;
      }
      if (sim.rpm <= 0) {
        sim.pos = { z, r };
        raiseAlarm('Colisão: ferramenta tocou a peça com o fuso parado', line);
        return false;
      }
      sim.chipAcc += res.removed;
    }
    if (res.parted >= 0) {
      const mesh = stock.detach(res.parted, partMaterial);
      scene.dropPart(mesh);
      message('Peça separada (corte concluído)', 'ok', line);
    }
  }
  return true;
}

// Move a ferramenta ao longo do evento do tempo ta até tb, removendo material
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
  const ev0 = sim.events;
  while (sim.status === 'run' && budget > 0 && sim.idx < ev0.length) {
    if (sim.turbo && performance.now() - t0 > 30) break;
    const ev = ev0[sim.idx];
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
      const next = ev0[sim.idx];
      if (sim.single && next && next.line !== ev.line) {
        setStatus('hold');
        highlightLine(next.line);
      }
    }
  }
  if (sim.idx >= ev0.length && sim.status === 'run') setStatus('end');
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
    $('droF').textContent = 'RÁPIDO';
    $('droFu').textContent = '';
  } else if (st) {
    $('droF').textContent = st.feedPerRev ? st.F.toFixed(3) : Math.round(st.F);
    $('droFu').textContent = st.feedPerRev ? 'mm/rot' : 'mm/min';
  }
  $('droT').textContent = sim.tool;
  $('droTn').textContent = TOOLS[sim.tool]?.name.split('–')[0] ?? '';
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

// ---------------------------------------------------------------- programas
async function loadProgramList() {
  const list = await (await fetch('/api/programs')).json();
  const sel = $('programSelect');
  sel.innerHTML = list.map((f) => `<option value="${f}">${f}</option>`).join('');
  return list;
}

async function openProgram(name) {
  if (sim.status === 'run' || sim.status === 'hold') doReset();
  const r = await fetch(`/api/programs/${encodeURIComponent(name)}`);
  if (!r.ok) return message(`Não foi possível abrir ${name}`, 'err');
  ta.value = await r.text();
  $('progName').textContent = name;
  lsSet(STORAGE_KEY, ta.value);
  lsSet(STORAGE_KEY + ':name', name);
  lineMarks = new Map();
  updateGutter();
  ta.scrollTop = 0;
  if (stockFromHeader(ta.value)) applyStock();
  else doReset();
  clearMessages();
  message(`Programa ${name} carregado. Pressione Cycle Start (ou Ctrl+Enter).`, 'info');
}

async function saveProgram() {
  const cur = $('progName').textContent || 'meu_programa.mpf';
  let name = prompt('Nome do arquivo (.mpf, .nc, .gcode ou .txt):', cur);
  if (!name) return;
  name = name.trim();
  const r = await fetch(`/api/programs/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: ta.value,
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) return message(res.error || 'Erro ao salvar', 'err');
  $('progName').textContent = name;
  await loadProgramList();
  $('programSelect').value = name;
  message(`Salvo como ${name}`, 'ok');
}

// ---------------------------------------------------------------- eventos de UI
$('btnStart').onclick = () => cycleStart(false);
$('btnHold').onclick = feedHold;
$('btnReset').onclick = doReset;
$('btnFinish').onclick = () => cycleStart(true);
$('btnSingle').onclick = () => {
  sim.single = !sim.single;
  $('btnSingle').classList.toggle('on', sim.single);
};
$('btnLoad').onclick = () => openProgram($('programSelect').value);
$('btnSave').onclick = saveProgram;
$('btnApplyStock').onclick = () => {
  if (sim.status === 'run' || sim.status === 'hold') return message('Pare (Reset) antes de trocar a peça bruta', 'warn');
  applyStock();
};
$('speed').oninput = (e) => {
  sim.speed = SPEEDS[Number(e.target.value)];
  $('speedVal').textContent = `${sim.speed}×`;
};
$('chkPath').onchange = (e) => scene.setShowPath(e.target.checked);
$('chkSection').onchange = (e) => scene.setSection(e.target.checked);
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => scene.frameView(b.dataset.view)));

// ---------------------------------------------------------------- início
(async function init() {
  $('speed').value = SPEEDS.indexOf(sim.speed);
  $('speedVal').textContent = `${sim.speed}×`;
  const list = await loadProgramList();
  const saved = lsGet(STORAGE_KEY);
  const savedName = lsGet(STORAGE_KEY + ':name');
  if (saved) {
    ta.value = saved;
    $('progName').textContent = savedName || '';
    if (savedName && list.includes(savedName)) $('programSelect').value = savedName;
    stockFromHeader(saved);
    applyStock();
    updateGutter();
    message('Programa restaurado da última sessão. Pressione Cycle Start (ou Ctrl+Enter).', 'info');
  } else if (list.length) {
    applyStock();
    await openProgram(list.includes('02_eixo_sinumerik.mpf') ? '02_eixo_sinumerik.mpf' : list[0]);
    $('programSelect').value = $('progName').textContent;
  } else {
    applyStock();
  }
  setStatus('reset');
  requestAnimationFrame(frame);
})();
