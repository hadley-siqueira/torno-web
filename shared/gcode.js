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

import { getTool, DEFAULT_TURRET } from './tools.js';

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
};

const IGNORED_G = new Set([9, 17, 18, 19, 40, 53, 54, 55, 56, 57, 58, 59, 60, 64, 80, 500]);
const TWO_PI = Math.PI * 2;

const fmt = (v) => Number(v.toFixed(3));

export class GCodeAlarm extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

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
    coolant: false,
  };

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
  const motionEvent = (line, kind, poly) => {
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
    push({ line, type: kind === 'thread' ? 'thread' : 'feed', pts, duration: t });
  };

  const arcPoly = (z0, r0, z1, r1, cw, center, radius) => {
    let cz;
    let cr;
    if (center) {
      [cz, cr] = center;
      const ra = Math.hypot(z0 - cz, r0 - cr);
      const rb = Math.hypot(z1 - cz, r1 - cr);
      if (Math.abs(ra - rb) > 0.05) {
        throw new GCodeAlarm('E_ARC_END', { diff: fmt(Math.abs(ra - rb)) });
      }
    } else {
      const R = Math.abs(radius);
      const dz = z1 - z0;
      const dr = r1 - r0;
      const d = Math.hypot(dz, dr);
      if (d < 1e-9) throw new GCodeAlarm('E_ARC_SAME_POINT');
      if (d > 2 * R + 1e-3) throw new GCodeAlarm('E_ARC_RADIUS_SMALL', { r: R, d: fmt(d) });
      const h = Math.sqrt(Math.max(0, R * R - (d * d) / 4));
      const mz = (z0 + z1) / 2;
      const mr = (r0 + r1) / 2;
      const nz = -dr / d;
      const nr = dz / d;
      const cands = [
        [mz + nz * h, mr + nr * h],
        [mz - nz * h, mr - nr * h],
      ];
      const wantLarge = radius < 0;
      let chosen = cands[0];
      for (const c of cands) {
        const sw = sweep(z0, r0, z1, r1, c[0], c[1], cw);
        if (wantLarge ? sw > Math.PI - 1e-9 : sw <= Math.PI + 1e-9) {
          chosen = c;
          break;
        }
      }
      [cz, cr] = chosen;
    }

    const R = Math.hypot(z0 - cz, r0 - cr);
    const a0 = Math.atan2(r0 - cr, z0 - cz);
    const sw = sweep(z0, r0, z1, r1, cz, cr, cw);
    const stepAng = Math.min((2 * Math.PI) / 180, R > 0 ? 0.5 / R : 1);
    const n = Math.max(2, Math.ceil(sw / stepAng));
    const poly = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (cw ? -1 : 1) * (sw * i) / n;
      poly.push([cz + R * Math.cos(a), cr + R * Math.sin(a)]);
    }
    poly[poly.length - 1] = [z1, r1];
    return poly;
  };

  for (let li = 0; li < lines.length && !alarm && !ended; li++) {
    const raw = lines[li];
    let src = raw
      .replace(/\([^)]*\)/g, ' ')
      .replace(/;.*$/, '')
      .trim();
    if (!src || src === '%') continue;
    if (/^O\d+/i.test(src) || /^:\d+/.test(src)) continue; // número de programa Fanuc
    if (src.startsWith('/')) src = src.slice(1); // supressão de bloco: executa sempre no MVP

    const upper = src.toUpperCase();
    if (/\b(CYCLE\d+|MCALL|REPEAT|GOTO[FB]?|CALL|IF|WHILE|DEF|R\d+\s*=)/.test(upper)) {
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
        const num = parseInt(v.replace(/\D/g, ''), 10);
        val.T = Number.isFinite(num) ? num : NaN;
      } else val[w] = parseFloat(v);
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

          const mo = st.motion;
          if (mo === 0) motionEvent(li, 'rapid', [[st.z, st.r], [z1, r1]]);
          else if (mo === 1) motionEvent(li, 'feed', [[st.z, st.r], [z1, r1]]);
          else if (mo === 33) {
            if (st.css) warn(li, 'W_THREAD_CSS');
            motionEvent(li, 'thread', [[st.z, st.r], [z1, r1]]);
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
  };
}

function sweep(z0, r0, z1, r1, cz, cr, cw) {
  const a0 = Math.atan2(r0 - cr, z0 - cz);
  const a1 = Math.atan2(r1 - cr, z1 - cz);
  let s = cw ? a0 - a1 : a1 - a0;
  s = ((s % TWO_PI) + TWO_PI) % TWO_PI;
  if (s < 1e-9) s = TWO_PI;
  return s;
}
