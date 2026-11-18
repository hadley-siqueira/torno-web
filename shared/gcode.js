// Interpretador de G-code para torno (subconjunto ISO / Sinumerik / Fanuc).
// Converte o programa em uma lista de "eventos" temporizados que o cliente
// reproduz na simulação 3D.
//
// Convenções:
//  - Plano G18 (Z horizontal = eixo do fuso, X radial para cima).
//  - X programado em diâmetro (DIAMON / padrão Fanuc). Internamente usamos raio.
//  - G2 = horário, G3 = anti-horário vistos com X para cima e Z para a direita.
//  - Pontos dos eventos: [z, r, t, rpm], t = tempo acumulado (s) dentro do evento.
//  - Mensagens saem como { code, params }; o texto vem de shared/i18n.js (PT/EN).

import { getTool, withEdge, findToolByName, DEFAULT_TURRET } from './tools.js';
import { GCodeAlarm, arcPolyline, fmt } from './geometry.js';
import { CYCLES, CYCLE_NPARAMS, findLabels, parseCallArgs, stripLabel } from './cycles.js';

export { GCodeAlarm };

export const DEFAULTS = {
  home: { x: 150, z: 100 }, // X em diâmetro
  rapidRate: 8000, // mm/min
  maxRpm: 4000,
  toolChangeTime: 1.5, // s
  spindleRampTime: 0.6, // s
  maxEvents: 200000,
  defaultTool: 1,
  dialect: 'sinumerik', // 'sinumerik' | 'fanuc' (decide o significado de G70/G71)
  turret: DEFAULT_TURRET, // ferramentas montadas: { posição: ferramenta } (ver buildTurret)
  subprograms: {}, // contornos do CYCLE95 em outro programa: { NOME: código }
  maxJumps: 10000, // GOTOF/GOTOB: limite contra laço infinito
};

// Chanfro/arredondamento e elementos de contorno do Sinumerik: ainda não executados
const CONTOUR_WORDS = new Set(['CHF', 'CHR', 'RND', 'RNDM', 'ANG', 'FRC', 'FRCM']);

const IGNORED_G = new Set([9, 17, 18, 19, 40, 53, 54, 55, 56, 57, 58, 59, 60, 64, 80, 500]);

export function parseProgram(text, options = {}) {
  const opt = { ...DEFAULTS, ...options, home: { ...DEFAULTS.home, ...(options.home || {}) } };
  const lines = String(text).split(/\r?\n/);

  const st = {
    r: opt.home.x / 2,
    z: opt.home.z,
    motion: 0,
    abs: true,
    feedPerRev: true,
    css: false,
    diam: true,
    F: 0,
    rpmCmd: 0, // S em G97
    Vc: 0, // S em G96 (m/min)
    lims: opt.maxRpm,
    spindle: 0, // 0 parado, 3 horário, 4 anti-horário
    tool: getTool(opt.defaultTool, opt.turret) ? opt.defaultTool : Number(Object.keys(opt.turret)[0] || 1),
    D: 1, // corretor (corte) da ferramenta
    coolant: false,
  };
  let workpiece = null;
  const warnedFeed = new Set(); // avisa uma vez por ferramenta/avanço

  const events = [];
  const warnings = [];
  const stats = {
    totalTime: 0,
    rapidLength: 0,
    feedLength: 0,
    tools: new Set([st.tool]),
    maxRpm: 0,
    blocks: 0,
  };
  const bounds = { minZ: Infinity, maxZ: -Infinity, maxR: 0 };
  let alarm = null;
  let ended = false;

  const warn = (line, code, params = {}) => warnings.push({ line, code, params });

  // Avisos didáticos num movimento de corte (G1/G2/G3) até o raio r1
  const checkCut = (line, r1) => {
    const tool = withEdge(getTool(st.tool, opt.turret), st.D);
    if (!tool) return;
    if (tool.kind === 'axial' && (Math.abs(r1) > 0.05 || Math.abs(st.r) > 0.05)) {
      warn(line, 'W_AXIAL_OFF_CENTER', { t: st.tool, type: tool.type.split('@')[0] });
    }
    const [lo, hi] = tool.feed || [];
    if (lo !== undefined && st.feedPerRev && st.F > 0 && (st.F < lo || st.F > hi)) {
      const key = `${st.tool}:${st.F}`;
      if (!warnedFeed.has(key)) {
        warnedFeed.add(key);
        warn(line, st.F < lo ? 'W_FEED_LOW' : 'W_FEED_HIGH', { f: st.F, min: lo, max: hi, t: st.tool, type: tool.type.split('@')[0] });
      }
    }
  };

  const rpmAt = (r) => {
    if (!st.spindle) return 0;
    let n;
    if (st.css) n = Math.min(st.lims, (st.Vc * 1000) / (Math.PI * Math.max(2 * Math.abs(r), 0.01)));
    else n = st.rpmCmd;
    return Math.min(n, opt.maxRpm);
  };

  const snapshot = () => ({
    spindle: st.spindle,
    tool: st.tool,
    D: st.D,
    F: st.F,
    feedPerRev: st.feedPerRev,
    css: st.css,
    Vc: st.Vc,
    S: st.rpmCmd,
    lims: st.lims,
    coolant: st.coolant,
    motion: st.motion,
    abs: st.abs,
  });

  const push = (ev) => {
    if (events.length >= opt.maxEvents) throw new GCodeAlarm('E_TOO_LONG');
    ev.state = snapshot();
    events.push(ev);
    stats.totalTime += ev.duration || 0;
    if (ev.pts) {
      for (const [z, r, , n] of ev.pts) {
        bounds.minZ = Math.min(bounds.minZ, z);
        bounds.maxZ = Math.max(bounds.maxZ, z);
        bounds.maxR = Math.max(bounds.maxR, r);
        stats.maxRpm = Math.max(stats.maxRpm, n);
      }
    }
  };

  // Gera um evento de movimento a partir de uma polilinha [[z, r], ...]
  // thread (rosca): { lead, phase, zRef } – a malha 3D desenha a hélice com isso
  const motionEvent = (line, kind, poly, thread = null) => {
    let len = 0;
    for (let i = 1; i < poly.length; i++) len += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    if (len < 1e-9) return;

    const pts = [];
    if (kind === 'rapid') {
      let t = 0;
      pts.push([poly[0][0], poly[0][1], 0, rpmAt(poly[0][1])]);
      for (let i = 1; i < poly.length; i++) {
        t += (Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]) / opt.rapidRate) * 60;
        pts.push([poly[i][0], poly[i][1], t, rpmAt(poly[i][1])]);
      }
      stats.rapidLength += len;
      push({ line, type: 'rapid', pts, duration: t });
      return;
    }

    // Avanço de trabalho: subdivide para que G96 (rpm variável) gere tempos corretos
    const fine = [poly[0]];
    for (let i = 1; i < poly.length; i++) {
      const [z0, r0] = poly[i - 1];
      const [z1, r1] = poly[i];
      const l = Math.hypot(z1 - z0, r1 - r0);
      const n = st.css && st.feedPerRev ? Math.min(400, Math.max(1, Math.ceil(l / 1))) : 1;
      for (let k = 1; k <= n; k++) fine.push([z0 + ((z1 - z0) * k) / n, r0 + ((r1 - r0) * k) / n]);
    }

    if (st.F <= 0) throw new GCodeAlarm('E_NO_FEED');
    let t = 0;
    pts.push([fine[0][0], fine[0][1], 0, rpmAt(fine[0][1])]);
    for (let i = 1; i < fine.length; i++) {
      const [z0, r0] = fine[i - 1];
      const [z1, r1] = fine[i];
      const l = Math.hypot(z1 - z0, r1 - r0);
      const rpm = rpmAt((r0 + r1) / 2);
      const pitchOrF = st.F;
      let feed; // mm/min
      if (kind === 'thread' || st.feedPerRev) {
        if (rpm <= 0) throw new GCodeAlarm('E_SPINDLE_STOPPED');
        feed = pitchOrF * rpm;
      } else feed = pitchOrF;
      t += (l / feed) * 60;
      pts.push([z1, r1, t, rpmAt(r1)]);
    }
    stats.feedLength += len;
    const ev = { line, type: kind === 'thread' ? 'thread' : 'feed', pts, duration: t };
    if (kind === 'thread') {
      const zRef = thread?.zRef ?? poly[0][0];
      // hélice à direita com M4 avançando para a placa (padrão da escola); M3 inverte
      const hand = (st.spindle === 3 ? -1 : 1) * (poly[poly.length - 1][0] < poly[0][0] ? 1 : -1);
      ev.thread = { lead: st.F, phase: thread?.phase ?? 0, zRef, hand };
    }
    push(ev);
  };

  // Movimentos gerados por um ciclo (ver cycles.js): rápido, avanço, rosca e espera
  const runMoves = (line, moves) => {
    const saved = { F: st.F, motion: st.motion };
    for (const mo of moves) {
      if (mo.type === 'dwell') {
        push({ line, type: 'dwell', duration: mo.secs });
        continue;
      }
      if (mo.F !== undefined) st.F = mo.F;
      motionEvent(line, mo.type, mo.pts, mo.thread);
      const last = mo.pts[mo.pts.length - 1];
      st.z = last[0];
      st.r = last[1];
    }
    // as funções modais de antes da chamada continuam valendo depois
    st.F = saved.F;
    st.motion = saved.motion;
  };

  const arcPoly = arcPolyline;
  const labels = findLabels(lines);
  let jumps = 0;

  for (let li = 0; li < lines.length && !alarm && !ended; li++) {
    const raw = lines[li];
    // Peça bruta do SINUMERIK Operate: WORKPIECE(,,,"CYLINDER",0,2,120,100,82.55)
    // (antes de remover "( ... )", que no Fanuc é comentário)
    const noComment = raw.replace(/;.*$/, '').trim();
    if (/^(N\d+\s*)?WORKPIECE\s*\(/i.test(noComment)) {
      const wp = parseWorkpiece(noComment);
      if (!wp) warn(li, 'W_WORKPIECE_IGNORED');
      else if (!workpiece) workpiece = { ...wp, line: li };
      stats.blocks++;
      push({ line: li, type: 'state', duration: 0 });
      continue;
    }
    // Ciclos: lidos antes de remover "( ... )" (comentário Fanuc), como o WORKPIECE
    const nc = stripLabel(noComment).trim();
    const ncUpper = nc.toUpperCase();
    // ---- Ciclos CYCLE93/95/97 ----
    const cy = ncUpper.match(/^(?:N\d+\s*)?(CYCLE9[357])\s*\((.*)\)\s*$/);
    if (cy) {
      stats.blocks++;
      try {
        if (!st.spindle) throw new GCodeAlarm('E_SPINDLE_STOPPED');
        if (cy[1] === 'CYCLE97' && st.css) warn(li, 'W_THREAD_CSS');
        const args = parseCallArgs(nc.slice(nc.indexOf('(') + 1, nc.lastIndexOf(')')), cy[1]);
        // o 802D sl tem 12 parâmetros no CYCLE95 (o SinuTrain/840D sl aceita mais): os que
        // sobram são ignorados com aviso
        const nmax = CYCLE_NPARAMS[cy[1]];
        while (args.length > nmax && args[args.length - 1] === undefined) args.pop();
        if (args.length > nmax) warn(li, 'W_CYCLE_EXTRA_ARGS', { c: cy[1], n: args.length, max: nmax });
        const ctx = {
          lines, labels, subprograms: opt.subprograms, cur: [st.z, st.r], F: st.F, diam: st.diam,
          tool: withEdge(getTool(st.tool, opt.turret), st.D),
        };
        const { moves, warnings: w } = CYCLES[cy[1]](args, ctx);
        for (const x of w) warn(x.line ?? li, x.code, x.params);
        runMoves(li, moves);
        if (!events.length || events[events.length - 1].line !== li) push({ line: li, type: 'state', duration: 0 });
      } catch (e) {
        if (!(e instanceof GCodeAlarm)) throw e;
        alarm = { line: e.line ?? li, code: e.code, params: e.params };
      }
      continue;
    }

    let src = raw
      .replace(/\([^)]*\)/g, ' ')
      .replace(/;.*$/, '')
      .trim();
    if (!src || src === '%') continue;
    if (/^O\d+/i.test(src) || /^:\d+/.test(src)) continue; // número de programa Fanuc
    if (src.startsWith('/')) src = src.slice(1); // supressão de bloco: executa sempre no MVP
    src = stripLabel(src).trim(); // rótulo "INICIO:" (marca de desvio/contorno)
    if (!src || /^N\d+$/i.test(src)) continue;

    const upper = src.toUpperCase();

    // ---- Desvios GOTOF/GOTOB/GOTO rótulo ----
    const go = upper.match(/^(?:N\d+\s*)?GOTO([FB]?)\s+([A-Z_][A-Z0-9_]*)\s*$/);
    if (go) {
      const target = labels[go[2]];
      const okDir = target !== undefined && (go[1] === 'F' ? target > li : go[1] === 'B' ? target < li : true);
      if (!okDir) {
        alarm = { line: li, code: 'E_LABEL_NOT_FOUND', params: { name: go[2] } };
        break;
      }
      stats.blocks++;
      push({ line: li, type: 'state', duration: 0 });
      if (++jumps > opt.maxJumps) {
        alarm = { line: li, code: 'E_TOO_LONG', params: {} };
        break;
      }
      li = target - 1;
      continue;
    }

    if (/\b(CYCLE\d+|MCALL|REPEAT|CALL|IF|WHILE|DEF|R\d+\s*=)/.test(upper)) {
      warn(li, 'W_UNSUPPORTED_BLOCK');
      push({ line: li, type: 'state', duration: 0 });
      continue;
    }

    // ---- Tokenização ----
    const words = [];
    const re = /([A-Z]+)\s*(=)?\s*("[^"]*"|[-+]?(?:\d+\.?\d*|\.\d+))?/gy;
    let pos = 0;
    let bad = false;
    while (pos < upper.length) {
      if (/\s/.test(upper[pos])) {
        pos++;
        continue;
      }
      re.lastIndex = pos;
      const m = re.exec(upper);
      if (!m || m[0].length === 0) {
        bad = true;
        break;
      }
      words.push({ w: m[1], v: m[3] });
      pos = re.lastIndex;
    }
    if (bad) {
      alarm = { line: li, code: 'E_SYNTAX', params: { near: upper.slice(pos, pos + 12) } };
      break;
    }

    stats.blocks++;
    const g = [];
    const m = [];
    const val = {};
    const kw = new Set();
    for (const { w, v } of words) {
      if (v === undefined) {
        kw.add(w);
        continue;
      }
      if (w === 'N') continue;
      if (w === 'G') g.push(parseFloat(v));
      else if (w === 'M') m.push(parseFloat(v));
      else if (w === 'T' && v.startsWith('"')) {
        // T="ROUGHING_T80 A": nome da ferramenta no SinuTrain; senão, o número dentro das aspas
        const byName = findToolByName(v.replace(/"/g, ''), opt.turret);
        const num = parseInt(v.replace(/\D/g, ''), 10);
        val.T = byName ?? (Number.isFinite(num) ? num : NaN);
      } else val[w] = parseFloat(v);
    }
    // ANG= numa reta isolada (G0/G1 com só X ou só Z): o comando calcula o outro eixo.
    // Ângulo a partir do eixo +Z, sentido anti-horário (X para cima). Ex.: X78 ANG=225.
    let ang = null;
    if ('ANG' in val) {
      const oneAxis = ('X' in val || 'U' in val) !== ('Z' in val || 'W' in val);
      const mo = [...g].reverse().find((c) => [0, 1, 2, 3, 33].includes(c)) ?? st.motion;
      if (oneAxis && (mo === 0 || mo === 1)) {
        ang = val.ANG;
        delete val.ANG;
      }
    }
    const ignoredContour = Object.keys(val).filter((w) => CONTOUR_WORDS.has(w));
    if (ignoredContour.length) {
      warn(li, 'W_CONTOUR_IGNORED', { k: ignoredContour.join(', ') });
      for (const w of ignoredContour) delete val[w];
    }

    try {
      // ---- Palavras-chave Sinumerik ----
      for (const k of kw) {
        if (k === 'DIAMON' || k === 'DIAM90') st.diam = true;
        else if (k === 'DIAMOF') st.diam = false;
        else if (k === 'AC' || k === 'IC') warn(li, 'W_KEYWORD_IGNORED', { k });
        else throw new GCodeAlarm('E_UNKNOWN_KEYWORD', { k });
      }

      // ---- Funções G ----
      let dwell = false;
      let home = false;
      let motion = null;
      for (const code of g) {
        switch (code) {
          case 0: case 1: case 2: case 3:
            motion = code; break;
          case 32: case 33:
            motion = 33; break;
          case 4: dwell = true; break;
          case 90: st.abs = true; break;
          case 91: st.abs = false; break;
          case 94: case 98: st.feedPerRev = false; break;
          case 95: case 99: st.feedPerRev = true; break;
          case 96: st.css = true; break;
          case 97: st.css = false; break;
          case 21: break;
          case 20: throw new GCodeAlarm('E_INCH', { g: 20 });
          case 71:
            if (opt.dialect === 'fanuc') {
              warn(li, 'W_FANUC_G71');
              Object.keys(val).forEach((k) => delete val[k]);
            }
            break; // Sinumerik: G71 = milímetros
          case 70:
            throw new GCodeAlarm(opt.dialect === 'fanuc' ? 'E_FANUC_G70' : 'E_INCH', { g: 70 });
          case 50: case 92:
            if ('S' in val) {
              st.lims = val.S;
              delete val.S;
            }
            if ('X' in val || 'Z' in val) {
              warn(li, 'W_G50_XZ', { g: code });
              delete val.X;
              delete val.Z;
            }
            break;
          case 28: home = true; break;
          case 41: case 42:
            warn(li, 'W_TNRC'); break;
          default:
            if (!IGNORED_G.has(code)) warn(li, 'W_G_UNSUPPORTED', { g: code });
        }
      }
      if (motion !== null) st.motion = motion;

      if ('LIMS' in val) st.lims = val.LIMS;

      // F: tempo de espera quando há G4 (Sinumerik); passo de rosca em G33
      if ('F' in val && !dwell) st.F = val.F;
      if (st.motion === 33 && 'K' in val) st.F = val.K; // G33 Z.. K.. (passo longitudinal)
      if ('S' in val && !dwell) {
        if (st.css) st.Vc = val.S;
        else st.rpmCmd = val.S;
      }

      // ---- Troca de ferramenta ----
      if ('T' in val) {
        let t = val.T;
        if (t >= 100) t = Math.floor(t / 100); // Fanuc T0101
        if (!Number.isFinite(t) || !getTool(t, opt.turret)) throw new GCodeAlarm('E_TOOL_MISSING', { t: Number.isFinite(val.T) ? val.T : '?' });
        if (t !== st.tool) {
          st.tool = t;
          stats.tools.add(t);
          push({
            line: li, type: 'toolchange', duration: opt.toolChangeTime,
            code: 'I_TOOLCHANGE', params: { t, type: getTool(t, opt.turret).type },
          });
        }
      }

      // ---- Corretor D (corte da ferramenta: ex. bedame D2 = canto direito) ----
      if ('D' in val) {
        const d = Math.round(val.D);
        if (d < 0 || d > 9) throw new GCodeAlarm('E_D_INVALID', { d: val.D });
        st.D = d === 0 ? 1 : d;
      } else if ('T' in val) st.D = 1;

      // ---- M antes do movimento ----
      for (const code of m) {
        if (code === 3 || code === 4) {
          const was = st.spindle;
          st.spindle = code;
          push({ line: li, type: 'spindle', duration: was === code ? 0 : opt.spindleRampTime });
        } else if (code === 8) st.coolant = true;
        else if (code === 9) st.coolant = false;
      }

      if (st.css && st.spindle && st.Vc <= 0) warn(li, 'W_CSS_NO_S');

      // ---- Espera ----
      if (dwell) {
        let secs = 0;
        if ('F' in val) secs = val.F;
        else if ('X' in val) secs = val.X;
        else if ('U' in val) secs = val.U;
        else if ('P' in val) secs = val.P / 1000;
        else if ('S' in val) {
          const rpm = rpmAt(st.r);
          secs = rpm > 0 ? (val.S / rpm) * 60 : 0;
        }
        push({ line: li, type: 'dwell', duration: Math.max(0, secs) });
      } else if (home) {
        const tz = 'W' in val || 'Z' in val || !('U' in val || 'X' in val) ? opt.home.z : st.z;
        const tr = 'U' in val || 'X' in val || !('W' in val || 'Z' in val) ? opt.home.x / 2 : st.r;
        motionEvent(li, 'rapid', [[st.z, st.r], [tz, tr]]);
        st.z = tz;
        st.r = tr;
      } else {
        // ---- Movimento ----
        const hasAxis = 'X' in val || 'Z' in val || 'U' in val || 'W' in val;
        if (hasAxis) {
          const k = st.diam ? 0.5 : 1;
          let r1 = st.r;
          let z1 = st.z;
          if ('X' in val) r1 = st.abs ? val.X * k : st.r + val.X * k;
          if ('U' in val) r1 = st.r + val.U * k;
          if ('Z' in val) z1 = st.abs ? val.Z : st.z + val.Z;
          if ('W' in val) z1 = st.z + val.W;
          if (ang !== null) {
            const a = (ang * Math.PI) / 180;
            const c = Math.cos(a);
            const sn = Math.sin(a);
            if ('Z' in val || 'W' in val) {
              if (Math.abs(c) < 1e-6) throw new GCodeAlarm('E_LINE_ANG', { a: ang });
              r1 = st.r + ((z1 - st.z) * sn) / c;
            } else {
              if (Math.abs(sn) < 1e-6) throw new GCodeAlarm('E_LINE_ANG', { a: ang });
              z1 = st.z + ((r1 - st.r) * c) / sn;
            }
          }

          const mo = st.motion;
          if (mo === 1 || mo === 2 || mo === 3) checkCut(li, r1);
          if (mo === 0) motionEvent(li, 'rapid', [[st.z, st.r], [z1, r1]]);
          else if (mo === 1) motionEvent(li, 'feed', [[st.z, st.r], [z1, r1]]);
          else if (mo === 33) {
            if (st.css) warn(li, 'W_THREAD_CSS');
            motionEvent(li, 'thread', [[st.z, st.r], [z1, r1]], { phase: val.SF || 0 });
          } else if (mo === 2 || mo === 3) {
            let poly;
            const radius = 'CR' in val ? val.CR : 'R' in val ? val.R : null;
            if ('I' in val || 'K' in val) {
              const c = [st.z + (val.K || 0), st.r + (val.I || 0)];
              poly = arcPoly(st.z, st.r, z1, r1, mo === 2, c, null);
            } else if (radius !== null) {
              poly = arcPoly(st.z, st.r, z1, r1, mo === 2, null, radius);
            } else throw new GCodeAlarm('E_ARC_NO_CENTER');
            motionEvent(li, 'feed', poly);
          }
          st.r = r1;
          st.z = z1;
        }
      }

      // ---- M depois do movimento ----
      for (const code of m) {
        if (code === 5) {
          st.spindle = 0;
          push({ line: li, type: 'spindle', duration: opt.spindleRampTime });
        } else if (code === 0 || code === 1) {
          push({ line: li, type: 'pause', duration: 0, code: 'I_PAUSE', params: { m: code } });
        } else if (code === 2 || code === 30 || code === 17) {
          st.spindle = 0;
          st.coolant = false;
          push({ line: li, type: 'end', duration: 0, code: 'I_END' });
          ended = true;
        } else if (![3, 4, 8, 9, 6].includes(code)) {
          warn(li, 'W_M_UNSUPPORTED', { m: code });
        }
      }

      // Garante que todo bloco gere ao menos um evento (realce da linha atual)
      if (!events.length || events[events.length - 1].line !== li) push({ line: li, type: 'state', duration: 0 });
    } catch (e) {
      if (!(e instanceof GCodeAlarm)) throw e;
      alarm = { line: li, code: e.code, params: e.params };
    }
  }

  if (alarm) push({ line: alarm.line, type: 'alarm', duration: 0, code: alarm.code, params: alarm.params });
  else if (!ended) warn(lines.length - 1, 'W_NO_END');

  if (!Number.isFinite(bounds.minZ)) Object.assign(bounds, { minZ: 0, maxZ: 0, maxR: 0 });

  return {
    events,
    warnings,
    alarm,
    bounds,
    stats: {
      ...stats,
      tools: [...stats.tools],
      totalTime: fmt(stats.totalTime),
      rapidLength: fmt(stats.rapidLength),
      feedLength: fmt(stats.feedLength),
      maxRpm: Math.round(stats.maxRpm),
    },
    lineCount: lines.length,
    workpiece,
  };
}

/**
 * WORKPIECE do SINUMERIK Operate (peça bruta no programa):
 *   WORKPIECE(,,,"CYLINDER", ref, ZA, ZI, ZB, XA)      cilindro
 *   WORKPIECE(,,,"PIPE",     ref, ZA, ZI, ZB, XA, XI)  tubo
 * ZA = face do bruto; ZI = fim (positivo: comprimento a partir de ZA; negativo: posição);
 * ZB = limite de usinagem (idem); XA = Ø externo; XI = Ø interno.
 * Devolve { diameter, length (em balanço), faceZ, clamp, bore?, total } ou null.
 * Ex. de aluno: WORKPIECE(,,,"CYLINDER",0,2,120,100,82.55) -> Ø82,55, face em Z2,
 * 120 mm de bruto, 100 mm usináveis (20 mm na placa).
 * Confirmado por alunos (2026-11-11): XA = Ø da peça, ZA = zero peça (face do bruto),
 * ZI = comprimento total, ZB = comprimento de trabalho (fora das castanhas).
 */
export function parseWorkpiece(text) {
  const m = String(text).match(/WORKPIECE\s*\((.*)\)/i);
  if (!m) return null;
  const args = [];
  let cur = '';
  let q = false;
  for (const ch of m[1]) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  args.push(cur.trim());
  const kind = (args[3] || '').replace(/"/g, '').toUpperCase();
  if (kind !== 'CYLINDER' && kind !== 'PIPE') return null;
  const n = (i) => (args[i] === undefined || args[i] === '' ? NaN : Number(args[i]));
  const za = Number.isFinite(n(5)) ? n(5) : 0;
  const zi = n(6);
  const zb = n(7);
  const xa = n(8);
  if (!Number.isFinite(xa) || xa <= 0 || !Number.isFinite(zi)) return null;
  const total = zi > 0 ? zi : za - zi;
  let length = Number.isFinite(zb) ? (zb > 0 ? zb : za - zb) : total - 25;
  length = Math.min(length, total);
  if (total <= 0 || length <= 0) return null;
  const out = { diameter: xa, length, faceZ: za, clamp: Math.max(0, total - length), total };
  const xi = n(9);
  if (kind === 'PIPE' && Number.isFinite(xi) && xi > 0 && xi < xa) out.bore = xi;
  return out;
}

/** Peça bruta definida pelo programa: WORKPIECE(...) ou o comentário "; Bruto: ...". */
export function stockFromProgram(code) {
  const line = String(code).split(/\r?\n/).find((l) => /^\s*(N\d+\s*)?WORKPIECE\s*\(/i.test(l));
  const wp = line && parseWorkpiece(line);
  if (wp) {
    const { total, ...rest } = wp;
    return { ...rest, source: 'workpiece' };
  }
  const h = stockFromHeader(code);
  return h && { ...h, source: 'header' };
}

/**
 * Lê a peça bruta do cabeçalho do programa:
 * "; Bruto: D50 x 80 mm, face em Z1" (ou "STOCK: D50 x 80", "raw face at Z1").
 * D = Ø externo; o segundo número é o comprimento em balanço (fora da placa).
 * Opcionais na mesma linha: "tubo Ø20" (Ø interno) e "castanhas 30" (comprimento preso).
 * Devolve { diameter, length, faceZ?, bore?, clamp? } ou null.
 */
export function stockFromHeader(code) {
  // Só a linha do cabeçalho com "Bruto"/"Stock" (para não pegar palavras de outros comentários)
  const line = String(code).split(/\r?\n/).find((l) => /(?:BRUTO|STOCK)[:\s]*D\s*\d/i.test(l));
  if (!line) return null;
  const m = line.match(/(?:BRUTO|STOCK)[:\s]*D\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const out = { diameter: Number(m[1]), length: Number(m[2]) };
  const num = (re) => {
    const f = line.match(re);
    return f ? Number(f[1]) : undefined;
  };
  const faceZ = num(/(?:FACE\s+(?:BRUTA\s+)?EM|RAW\s+FACE\s+AT)\s+Z\s*(\d+(?:\.\d+)?)/i);
  const bore = num(/(?:TUBO|TUBE)\s*(?:[ØDd]|ID)?\s*(\d+(?:\.\d+)?)/i);
  const clamp = num(/(?:CASTANHAS|PRESO|FIXADO|CLAMPED|IN\s+CHUCK)\s*(\d+(?:\.\d+)?)/i);
  if (faceZ !== undefined) out.faceZ = faceZ;
  if (bore !== undefined) out.bore = bore;
  if (clamp !== undefined) out.clamp = clamp;
  return out;
}
