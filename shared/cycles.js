// Ciclos de torneamento do SINUMERIK 802D sl (mesma sintaxe dos ciclos-padrão do 840D):
//   CYCLE95 – desbaste de contorno (e acabamento)
//   CYCLE93 – canal
//   CYCLE97 – rosca
// Cada ciclo vira uma lista de movimentos simples (rápido, avanço, rosca, espera) que o
// interpretador (gcode.js) transforma em eventos, como se fossem blocos G0/G1/G33/G4.
//
// Fontes: manual "SINUMERIK 802D sl Operation and Programming Turning" (10/2006, cap. 9.5) e
// "SINUMERIK 840D sl Cycles" (04/2006, cap. 4), mais exemplos públicos. O que os manuais não
// dizem em texto está marcado como SUPOSIÇÃO (também em docs/PLANO.md > Suposições).
//
// Coordenadas: pontos [z, r] (r = raio). Os geradores trabalham num sistema (u, v) em
// que o corte anda em −u e o material fica "acima" do contorno (v maior); o mapeamento
// para (z, r) depende do tipo de usinagem (longitudinal/faceamento, externo/interno).

import { GCodeAlarm, arcPolyline, cornerPoints } from './geometry.js';
import { insertSpan } from './tools.js';

// ---------------------------------------------------------------- rótulos e parâmetros

const LABEL_RE = /^\s*(?:N\d+\s+)?([A-Z_][A-Z0-9_]+):(?!=)\s*/i;

/** Rótulos do programa ("INICIO:" no começo do bloco): { NOME: linha }. */
export function findLabels(lines) {
  const out = {};
  lines.forEach((l, i) => {
    const m = l.replace(/;.*$/, '').match(LABEL_RE);
    if (m && !(m[1].toUpperCase() in out)) out[m[1].toUpperCase()] = i;
  });
  return out;
}

/** Tira o rótulo do começo do bloco (mantém o número N, se houver). */
export function stripLabel(src) {
  return src.replace(/^(\s*N\d+\s+)?[A-Z_][A-Z0-9_]+:(?!=)\s*/i, '$1');
}

/**
 * Argumentos de uma chamada CYCLExx(...): números, textos entre aspas ou undefined
 * (posição vazia, como em CYCLE97(,42,0,...)).
 */
export function parseCallArgs(inside, cycle) {
  const args = [];
  let cur = '';
  let q = false;
  for (const ch of inside) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  args.push(cur.trim());
  return args.map((a, i) => {
    if (a === '') return undefined;
    if (a.startsWith('"')) return a.replace(/"/g, '');
    const n = Number(a);
    if (!Number.isFinite(n)) throw new GCodeAlarm('E_CYCLE_ARG', { c: cycle, n: i + 1, v: a });
    return n;
  });
}

const named = (names, args) => Object.fromEntries(names.map((n, i) => [n, args[i]]));

// ---------------------------------------------------------------- contorno

const TOKEN_RE = /([A-Z]+)\s*(=)?\s*([-+]?(?:\d+\.?\d*|\.\d+))?/gy;

/**
 * Lê o contorno das linhas [from, to] (inclusive): G0/G1/G2/G3, X (Ø) e Z, CR=/I/K,
 * ANG= (com uma coordenada), CHR=/CHF=/RND= no fim do elemento. Para em M17/M2/M30/RET.
 * Devolve { pts: [[z, r], ...], warnings }.
 */
export function parseContour(lines, from, to, { diam = true } = {}) {
  const k = diam ? 0.5 : 1;
  const elems = [];
  const warnings = [];
  let cur = null;
  let motion = 1;
  let abs = true;
  for (let li = from; li <= to && li < lines.length; li++) {
    let src = stripLabel(lines[li].replace(/;.*$/, '')).toUpperCase().replace(/^\s*N\d+\s*/, '').trim();
    if (!src) continue;
    if (/^(RET|M17|M0?2|M30)\b/.test(src)) break;
    const val = {};
    const g = [];
    const m = [];
    let pos = 0;
    while (pos < src.length) {
      if (/\s/.test(src[pos])) {
        pos++;
        continue;
      }
      TOKEN_RE.lastIndex = pos;
      const t = TOKEN_RE.exec(src);
      if (!t || !t[0].length) throw Object.assign(new GCodeAlarm('E_SYNTAX', { near: src.slice(pos, pos + 12) }), { line: li });
      pos = TOKEN_RE.lastIndex;
      if (t[3] === undefined) continue; // palavras sem valor (ex.: DIAMON) não mudam o contorno
      const v = parseFloat(t[3]);
      if (t[1] === 'G') g.push(v);
      else if (t[1] === 'M') m.push(v);
      else val[t[1]] = v;
    }
    for (const c of g) {
      if (c >= 0 && c <= 3) motion = c;
      else if (c === 90) abs = true;
      else if (c === 91) abs = false;
    }
    const ends = m.some((c) => c === 17 || c === 2 || c === 30);
    try {
      const hasX = 'X' in val;
      const hasZ = 'Z' in val;
      if (!hasX && !hasZ && !('ANG' in val)) {
        if (ends) break;
        continue; // só F, S, T...
      }
      let z = cur ? cur[0] : null;
      let r = cur ? cur[1] : null;
      if (hasX) r = abs || r === null ? val.X * k : r + val.X * k;
      if (hasZ) z = abs || z === null ? val.Z : z + val.Z;
      if ('ANG' in val) {
        if (!cur || hasX === hasZ) throw new GCodeAlarm('E_CONTOUR_ANG');
        const tan = Math.tan((val.ANG * Math.PI) / 180);
        if (hasZ) r = cur[1] + (z - cur[0]) * tan;
        else {
          if (Math.abs(tan) < 1e-9) throw new GCodeAlarm('E_CONTOUR_ANG');
          z = cur[0] + (r - cur[1]) / tan;
        }
      }
      if (!cur) {
        if (z === null || r === null) throw new GCodeAlarm('E_CONTOUR_START');
        cur = [z, r];
      } else if (Math.hypot(z - cur[0], r - cur[1]) > 1e-9) {
        let e;
        if (motion === 2 || motion === 3) {
          const radius = 'CR' in val ? val.CR : null;
          const center = 'I' in val || 'K' in val ? [cur[0] + (val.K || 0), cur[1] + (val.I || 0)] : null;
          if (!center && radius === null) throw new GCodeAlarm('E_ARC_NO_CENTER');
          e = { kind: 'arc', pts: arcPolyline(cur[0], cur[1], z, r, motion === 2, center, radius), line: li };
        } else e = { kind: 'line', pts: [cur, [z, r]], line: li };
        for (const kind of ['CHR', 'CHF', 'RND']) if (val[kind] > 0) e.mod = { kind, v: val[kind] };
        elems.push(e);
        cur = [z, r];
      }
    } catch (err) {
      if (err instanceof GCodeAlarm && err.line === undefined) err.line = li;
      throw err;
    }
    if (ends) break;
  }
  // manual: o contorno precisa de pelo menos 3 blocos com movimento (início + 2 elementos)
  if (elems.length < 2) throw new GCodeAlarm('E_CONTOUR_EMPTY');

  const pts = [elems[0].pts[0]];
  elems.forEach((e, i) => {
    const next = elems[i + 1];
    if (e.kind === 'line') {
      if (e.mod && next?.kind === 'line') {
        try {
          pts.push(...cornerPoints(e.pts[0], e.pts[1], next.pts[1], e.mod.kind, e.mod.v));
        } catch (err) {
          if (err instanceof GCodeAlarm) err.line = e.line;
          throw err;
        }
      } else {
        if (e.mod && next) warnings.push({ line: e.line, code: 'W_CORNER_ARC', params: { k: e.mod.kind } });
        pts.push(e.pts[1]);
      }
    } else {
      if (e.mod && next) warnings.push({ line: e.line, code: 'W_CORNER_ARC', params: { k: e.mod.kind } });
      pts.push(...e.pts.slice(1));
    }
  });
  return { pts, warnings };
}

// ---------------------------------------------------------------- perfil amostrado (u, v)

const DU = 0.05; // passo da amostragem em u (mm)

/**
 * Amostra a polilinha (u, v) numa grade de passo DU: em cada posição, o MAIOR v do
 * contorno (paredes verticais ficam do lado do material: o desbaste não invade o contorno).
 * Fora do contorno: à esquerda repete o primeiro valor (parede); à direita, `rightOpen`
 * deixa sem material (−∞) ou repete o último valor.
 */
function sampleProfile(pts, pad, rightOpen) {
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const [u] of pts) {
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
  }
  const u0 = uMin - pad;
  const n = Math.ceil((uMax + pad - u0) / DU) + 1;
  const v = new Float64Array(n).fill(-Infinity);
  const put = (u, val) => {
    const i = Math.round((u - u0) / DU);
    if (i >= 0 && i < n && val > v[i]) v[i] = val;
  };
  for (let s = 1; s < pts.length; s++) {
    const [ua, va] = pts[s - 1];
    const [ub, vb] = pts[s];
    const steps = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va) / (DU / 4)));
    for (let q = 0; q <= steps; q++) put(ua + ((ub - ua) * q) / steps, va + ((vb - va) * q) / steps);
  }
  const iMin = Math.round((uMin - u0) / DU);
  const iMax = Math.round((uMax - u0) / DU);
  // buracos (não deveriam existir) e extensões
  for (let i = iMin + 1; i <= iMax; i++) if (v[i] === -Infinity) v[i] = v[i - 1];
  for (let i = 0; i < iMin; i++) v[i] = v[iMin];
  for (let i = iMax + 1; i < n; i++) v[i] = rightOpen ? -Infinity : v[iMax];
  return { u0, n, v, iMin, iMax, U: (i) => u0 + i * DU, I: (u) => Math.max(0, Math.min(n - 1, Math.round((u - u0) / DU))) };
}

/** Sobremetal: FU ao longo de u, FV ao longo de v e FAL paralelo ao contorno (círculo). */
function dilate(grid, FU, FV, FAL) {
  const { n, v } = grid;
  const kU = Math.round(FU / DU);
  let out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let q = -kU; q <= kU; q++) {
      const j = i + q;
      if (j >= 0 && j < n && v[j] > m) m = v[j];
    }
    out[i] = m + FV;
  }
  if (FAL > 0) {
    const kF = Math.floor(FAL / DU);
    const o2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let m = -Infinity;
      for (let q = -kF; q <= kF; q++) {
        const j = i + q;
        if (j < 0 || j >= n) continue;
        const c = out[j] + Math.sqrt(Math.max(0, FAL * FAL - (q * DU) ** 2));
        if (c > m) m = c;
      }
      o2[i] = m;
    }
    out = o2;
  }
  return { ...grid, v: out };
}

// Lista de movimentos em (u, v); no fim, mapeados para (z, r)
class Moves {
  constructor(start) {
    this.list = [];
    this.pos = start;
  }
  rapid(...pts) {
    this.add('rapid', pts);
  }
  feed(F, ...pts) {
    this.add('feed', pts, { F });
  }
  add(type, pts, extra = {}) {
    const poly = [this.pos];
    for (const p of pts) {
      const last = poly[poly.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) poly.push(p);
    }
    if (poly.length < 2) return;
    this.list.push({ type, pts: poly, ...extra });
    this.pos = poly[poly.length - 1];
  }
  dwell(secs) {
    if (secs > 0) this.list.push({ type: 'dwell', secs });
  }
  toZR(map) {
    return this.list.map((m) => (m.pts ? { ...m, pts: m.pts.map(map) } : m));
  }
}

// ---------------------------------------------------------------- CYCLE95

const P95 = ['NPP', 'MID', 'FALZ', 'FALX', 'FAL', 'FF1', 'FF2', 'FF3', 'VARI', 'DT', 'DAM', 'VRT'];

// Tipos de usinagem (VARI 1–12): unidade 1–4 = desbaste, 5–8 = acabamento, 9–12 = completo
//   1/5/9 longitudinal externo   2/6/10 faceamento externo
//   3/7/11 longitudinal interno  4/8/12 faceamento interno
const MAP95 = [
  { toUV: ([z, r]) => [z, r], toZR: ([u, v]) => [u, v], long: true }, // longitudinal externo
  { toUV: ([z, r]) => [r, z], toZR: ([u, v]) => [v, u], long: false }, // faceamento externo
  { toUV: ([z, r]) => [z, -r], toZR: ([u, v]) => [u, -v], long: true }, // longitudinal interno
  { toUV: ([z, r]) => [-r, z], toZR: ([u, v]) => [v, -u], long: false }, // faceamento interno
];

/** Contorno do CYCLE95: rótulos "INICIO:FIM" no programa ou nome de subprograma. */
function resolveContour(npp, ctx) {
  if (typeof npp !== 'string' || !npp.trim()) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE95', p: 'NPP' });
  const name = npp.trim().toUpperCase();
  if (name.includes(':')) {
    const [a, b] = name.split(':').map((s) => s.trim());
    const from = ctx.labels[a];
    const to = ctx.labels[b];
    if (from === undefined) throw new GCodeAlarm('E_LABEL_NOT_FOUND', { name: a });
    if (to === undefined) throw new GCodeAlarm('E_LABEL_NOT_FOUND', { name: b });
    return parseContour(ctx.lines, Math.min(from, to), Math.max(from, to), { diam: ctx.diam });
  }
  const code = ctx.subprograms?.[name.replace(/\.(SPF|MPF)$/, '')];
  if (typeof code !== 'string') throw new GCodeAlarm('E_CONTOUR_NOT_FOUND', { name });
  const lines = code.split(/\r?\n/);
  try {
    return parseContour(lines, 0, lines.length - 1, { diam: ctx.diam });
  } catch (err) {
    // o erro está no subprograma: aponta para a linha da chamada
    if (err instanceof GCodeAlarm) err.line = undefined;
    throw err;
  }
}

/**
 * CYCLE95(NPP, MID, FALZ, FALX, FAL, FF1, FF2, FF3, VARI, DT, DAM, _VRT)
 * MID = profundidade de cada passe (raio); FALZ/FALX/FAL = sobremetal em Z, em X (raio)
 * e paralelo ao contorno; FF1 desbaste, FF2 entrada em rebaixos, FF3 acabamento;
 * _VRT = afastamento do contorno (padrão 1 mm). DT/DAM (quebra-cavaco) não mudam a peça.
 *
 * Sequência: vai em rápido ao ponto inicial (fora do contorno, acima do maior Ø mais o
 * sobremetal e _VRT); desbasta em passes paralelos ao eixo, de profundidades iguais (≤ MID);
 * no fim de cada passe segue o contorno até o nível anterior (tira o "degrau") e afasta 45°;
 * rebaixos são desbastados entrando pelo contorno com FF2; o acabamento segue o contorno
 * com FF3; termina no ponto inicial.
 */
export function cycle95(args, ctx) {
  const p = named(P95, args);
  const vari = Math.round(p.VARI ?? 0) % 100;
  if (vari < 1 || vari > 12) throw new GCodeAlarm('E_CYCLE_VARI', { c: 'CYCLE95', v: p.VARI ?? '' });
  const map = MAP95[(vari - 1) % 4];
  const stage = vari <= 4 ? 'rough' : vari <= 8 ? 'finish' : 'complete';
  const MID = p.MID;
  if (stage !== 'finish' && !(MID > 0)) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE95', p: 'MID' });
  const FALZ = Math.abs(p.FALZ || 0);
  const FALX = Math.abs(p.FALX || 0);
  const FAL = Math.abs(p.FAL || 0);
  const FF1 = p.FF1 > 0 ? p.FF1 : ctx.F;
  const FF2 = p.FF2 > 0 ? p.FF2 : FF1;
  const FF3 = p.FF3 > 0 ? p.FF3 : FF1;
  const VRT = p.VRT > 0 ? p.VRT : 1;
  const [FU, FV] = map.long ? [FALZ, FALX] : [FALX, FALZ];

  const { pts, warnings } = resolveContour(p.NPP, ctx);
  const uv = pts.map(map.toUV);
  const pad = FU + FAL + 1;
  const exact = sampleProfile(uv, pad, true);
  const grid = stage === 'finish' ? exact : dilate(exact, FU, FV, FAL);
  const { v: dil, iMin, iMax, U, I, n } = grid;

  let vTop = -Infinity;
  let vMin = Infinity;
  for (let i = iMin; i <= iMax; i++) {
    vTop = Math.max(vTop, dil[i]);
    vMin = Math.min(vMin, dil[i]);
  }
  const start = map.toUV(ctx.cur);
  const uStart = U(iMax) + FU + FAL + VRT;
  const vSafe = Math.max(vTop + VRT, start[1]);
  const mv = new Moves(start);
  mv.rapid([uStart, vSafe]);

  if (stage !== 'finish' && vTop - vMin > 1e-6) {
    const D = vTop - vMin;
    const nCuts = Math.max(1, Math.ceil(D / MID - 1e-9));
    const dv = D / nCuts;
    for (let k = 1; k <= nCuts; k++) {
      const L = vTop - k * dv;
      const Lp = L + dv;
      // trechos (da direita para a esquerda) onde o contorno está abaixo do nível
      const runs = [];
      for (let i = n - 1; i >= iMin; i--) {
        if (dil[i] > L + 1e-9) continue;
        const ib = i;
        while (i - 1 >= iMin && dil[i - 1] <= L + 1e-9) i--;
        runs.push({ ia: i, ib, open: ib === n - 1 });
      }
      for (const { ia, ib, open } of runs) {
        if (!open && (ib - ia) * DU < DU * 1.5) continue;
        let entry = uStart;
        let i2 = ib;
        if (!open) {
          while (i2 < n - 1 && dil[i2] < Lp - 1e-9) i2++;
          entry = U(i2);
        }
        // altura do retorno: acima do nível anterior, se nada mais alto estiver no caminho
        let h = vSafe;
        if (k > 1) {
          const a = I(Math.min(mv.pos[0], entry));
          const b = I(Math.max(mv.pos[0], entry));
          let m = -Infinity;
          for (let i = a + 1; i < b; i++) m = Math.max(m, dil[i]);
          if (m <= Lp + 1e-9) h = Lp + VRT;
        }
        if (mv.pos[1] < h) mv.rapid([mv.pos[0], h]);
        mv.rapid([entry, h]);
        if (open) mv.rapid([entry, L]);
        else {
          // entra no rebaixo descendo pelo contorno
          mv.rapid([entry, Lp + VRT]);
          const path = [[entry, Lp]];
          for (let i = i2 - 1; i >= ib; i--) path.push([U(i), Math.min(Lp, Math.max(L, dil[i]))]);
          path.push([U(ib), L]);
          mv.feed(FF2, ...path);
        }
        mv.feed(FF1, [U(ia), L]);
        // tira o degrau seguindo o contorno até o nível anterior
        const follow = [];
        let i = ia - 1;
        while (i >= iMin && dil[i] < Lp - 1e-9) {
          follow.push([U(i), Math.max(dil[i], L)]);
          i--;
        }
        if (i >= iMin) follow.push([U(i + 1), Lp]);
        if (follow.length) mv.feed(FF1, ...follow);
        mv.rapid([mv.pos[0] + VRT, mv.pos[1] + VRT]); // afasta 45°
      }
    }
  }

  if (stage !== 'rough') {
    let path = uv;
    if (path[0][0] < path[path.length - 1][0]) path = [...path].reverse(); // do lado aberto para dentro
    // manual: ponto inicial do ciclo eixo a eixo, depois o início do contorno com os dois eixos
    if (mv.pos[1] < vSafe) mv.rapid([mv.pos[0], vSafe]);
    mv.rapid([uStart, vSafe], path[0]);
    mv.feed(FF3, ...path.slice(1));
    mv.rapid([mv.pos[0], mv.pos[1] + VRT]);
  }
  if (mv.pos[1] < vSafe) mv.rapid([mv.pos[0], vSafe]);
  mv.rapid([uStart, vSafe]);
  return { moves: mv.toZR(map.toZR), warnings };
}

// ---------------------------------------------------------------- CYCLE93

const P93 = ['SPD', 'SPL', 'WIDG', 'DIAG', 'STA1', 'ANG1', 'ANG2', 'RCO1', 'RCO2', 'RCI1', 'RCI2', 'FAL1', 'FAL2', 'IDEP', 'DTB', 'VARI', 'VRT'];

/**
 * CYCLE93(SPD, SPL, WIDG, DIAG, STA1, ANG1, ANG2, RCO1, RCO2, RCI1, RCI2, FAL1, FAL2, IDEP, DTB, VARI, _VRT)
 * SPD = Ø do ponto inicial; SPL = Z do ponto inicial; WIDG = largura no fundo; DIAG =
 * profundidade (raio); STA1 = inclinação da superfície (cone); ANG1/ANG2 = ângulo dos
 * flancos; RCO = cantos de cima, RCI = cantos do fundo (positivo = raio, negativo = chanfro);
 * FAL1/FAL2 = sobremetal no fundo e nos flancos; IDEP = profundidade de cada mergulho;
 * DTB = espera no fundo (s).
 * VARI (manual do 840D): 1 longitudinal externo, ponto inicial à esquerda; 3 interno,
 * esquerda; 5 externo, direita; 7 interno, direita; 2/4/6/8 = canal na face (não
 * suportado). 1–8: chanfro como CHF; 11–18: como CHR.
 *
 * Sequência: mergulhos de IDEP com recuo de _VRT (quebra-cavaco) até o fundo, lado a lado
 * (passo ≤ 95% da largura da ferramenta); depois acabamento de cada flanco até o meio do
 * fundo, com o canto da ferramenta do lado do flanco.
 */
export function cycle93(args, ctx) {
  const p = named(P93, args);
  for (const k of ['SPD', 'SPL', 'WIDG', 'DIAG', 'IDEP']) {
    if (p[k] === undefined || (k !== 'SPL' && !(p[k] > 0))) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE93', p: k });
  }
  const VARI = Math.round(p.VARI ?? 0);
  const type = VARI % 10;
  if (type < 1 || type > 8 || VARI > 18 || (VARI >= 9 && VARI <= 10)) throw new GCodeAlarm('E_CYCLE_VARI', { c: 'CYCLE93', v: p.VARI ?? '' });
  if (type % 2 === 0) throw new GCodeAlarm('E_CYCLE93_FACE');
  const chr = VARI > 10;
  const internal = type === 3 || type === 7;
  const dir = type <= 4 ? 1 : -1; // o canal cresce para +Z (ponto inicial à esquerda) ou −Z
  const s = internal ? -1 : 1; // v = s·r: o canal sempre "desce" em v
  const tool = ctx.tool;
  if (!tool) throw new GCodeAlarm('E_CYCLE_NO_TOOL');
  const warnings = [];
  if ((tool.kind === 'internal') !== internal) warnings.push({ code: 'W_CYCLE_TOOL_KIND', params: { c: 'CYCLE93' } });

  const R = ctx.diam ? p.SPD / 2 : p.SPD;
  const tanSta = Math.tan(((p.STA1 || 0) * Math.PI) / 180);
  const vs = (u) => s * (R + Math.abs(u - p.SPL) * tanSta); // superfície (cone se STA1 ≠ 0)
  const tan1 = Math.tan(((p.ANG1 || 0) * Math.PI) / 180);
  const tan2 = Math.tan(((p.ANG2 || 0) * Math.PI) / 180);
  const S1u = p.SPL;
  const B1u = S1u + dir * p.DIAG * tan1;
  const B2u = B1u + dir * p.WIDG;
  const S2u = B2u + dir * p.DIAG * tan2;
  const corners = [
    [S1u - dir * 8, vs(S1u - dir * 8)],
    [S1u, vs(S1u)],
    [B1u, vs(B1u) - p.DIAG],
    [B2u, vs(B2u) - p.DIAG],
    [S2u, vs(S2u)],
    [S2u + dir * 8, vs(S2u + dir * 8)],
  ];
  const mods = [p.RCO1, p.RCI1, p.RCI2, p.RCO2];
  const prof = [corners[0]];
  for (let i = 1; i <= 4; i++) {
    const m = mods[i - 1] || 0;
    if (!m) prof.push(corners[i]);
    else prof.push(...cornerPoints(corners[i - 1], corners[i], corners[i + 1], m > 0 ? 'RND' : chr ? 'CHR' : 'CHF', Math.abs(m)));
  }
  prof.push(corners[5]);

  const exact = sampleProfile(prof, 0, false);
  const dil = dilate(exact, Math.abs(p.FAL2 || 0), Math.abs(p.FAL1 || 0), 0);
  const { U, I, n } = exact;
  const below = (g, i) => g.v[i] < vs(U(i)) - 1e-6;
  const range = (g) => {
    let a = -1;
    let b = -1;
    for (let i = 0; i < n; i++) if (below(g, i)) {
      if (a < 0) a = i;
      b = i;
    }
    return [a, b];
  };
  const [gL, gR] = range(dil);
  const [eL, eR] = range(exact);
  if (gL < 0 || eL < 0) throw new GCodeAlarm('E_CYCLE93_FORM');

  const [ta, tb] = insertSpan(tool.insert);
  const w = tb - ta;
  if (p.WIDG < w - 1e-6) throw new GCodeAlarm('E_GROOVE_TOOL_WIDTH', { w: Number(w.toFixed(3)), widg: p.WIDG });
  const VRT = p.VRT > 0 ? p.VRT : 1;
  let top = -Infinity;
  for (let i = eL; i <= eR; i++) top = Math.max(top, vs(U(i)));
  const vA = top + VRT;
  const F = ctx.F;

  // mergulhos de desbaste: a ferramenta ocupa [q, q + w]. As paredes ficam nas amostras
  // vizinhas (gL − 1 e gR + 1): a amostra de uma parede vertical guarda o topo dela
  const wallL = U(gL - 1);
  const wallR = U(gR + 1);
  const qFirst = wallL;
  const qLast = wallR - w;
  let plunges;
  if (qLast <= qFirst + 1e-9) plunges = [(wallL + wallR - w) / 2];
  else {
    const cnt = Math.ceil((qLast - qFirst) / (0.95 * w) - 1e-9) + 1;
    plunges = Array.from({ length: cnt }, (_, j) => qFirst + ((qLast - qFirst) * j) / (cnt - 1 || 1));
  }
  if (dir < 0) plunges.reverse();
  const mv = new Moves([ctx.cur[0], s * ctx.cur[1]]);
  const goTo = (u) => {
    if (mv.pos[1] < vA) mv.rapid([mv.pos[0], vA]);
    mv.rapid([u, vA]);
  };
  for (const q of plunges) {
    const ref = q - ta;
    let floor = -Infinity;
    let surf = -Infinity;
    for (let i = I(q + DU); i <= I(q + w - DU); i++) floor = Math.max(floor, dil.v[i]);
    for (let i = I(q); i <= I(q + w); i++) surf = Math.max(surf, vs(U(i)));
    goTo(ref);
    let depth = surf;
    for (;;) {
      const next = Math.max(floor, depth - p.IDEP);
      mv.feed(F, [ref, next]);
      depth = next;
      if (next <= floor + 1e-9) break;
      mv.rapid([ref, next + VRT]); // quebra-cavaco
    }
    mv.dwell(p.DTB || 0);
    mv.rapid([ref, vA]);
  }

  // acabamento: cada flanco até o meio do fundo, com o canto do lado do flanco
  const mid = Math.round((eL + eR) / 2);
  // (cada ponto usa o menor valor entre a amostra e a vizinha do lado do meio: o canto
  // desce rente à parede)
  // Num canal estreito (menos de 2 larguras da ferramenta), cada lado para antes de o
  // outro lado da ferramenta encostar na parede oposta.
  const ev = exact.v;
  const wL = U(eL - 1);
  const wR = U(eR + 1);
  // O fundo da ferramenta é reto: em cada posição ela só desce até o ponto mais alto do
  // perfil que fica embaixo dela (senão comeria o flanco ou o raio do outro lado).
  const kw = Math.round(w / DU);
  const under = (from, to) => {
    let m = -Infinity;
    for (let j = Math.max(eL, from); j <= Math.min(eR, to); j++) m = Math.max(m, ev[j]);
    return m;
  };
  const left = [];
  for (let i = eL - 1; i <= mid && U(i) + w <= wR + 1e-9; i++) left.push([U(i) - ta, Math.max(Math.min(ev[i], ev[i + 1]), under(i + 1, i + kw))]);
  const right = [];
  for (let i = eR + 1; i >= mid && U(i) - w >= wL - 1e-9; i--) right.push([U(i) - tb, Math.max(Math.min(ev[i], ev[i - 1]), under(i - kw, i - 1))]);
  for (const side of dir > 0 ? [left, right] : [right, left]) {
    if (!side.length) continue;
    goTo(side[0][0]);
    mv.feed(F, ...side);
    mv.rapid([mv.pos[0], vA]);
  }
  goTo(plunges[0] - ta);
  return { moves: mv.toZR(([u, v]) => [u, s * v]), warnings };
}

// ---------------------------------------------------------------- CYCLE97

const P97 = ['PIT', 'MPIT', 'SPL', 'FPL', 'DM1', 'DM2', 'APP', 'ROP', 'TDEP', 'FAL', 'IANG', 'NSP', 'NRC', 'NID', 'VARI', 'NUMT', 'VRT'];

/** Passo da rosca métrica grossa (MPIT = 3 … 60). */
export const METRIC_COARSE = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5,
  24: 3, 27: 3, 30: 3.5, 33: 3.5, 36: 4, 39: 4, 42: 4.5, 45: 4.5, 48: 5, 52: 5, 56: 5.5, 60: 5.5,
};

/**
 * CYCLE97(PIT, MPIT, SPL, FPL, DM1, DM2, APP, ROP, TDEP, FAL, IANG, NSP, NRC, NID, VARI, NUMT, _VRT)
 * PIT = passo (ou MPIT = tamanho da rosca métrica grossa, M3–M60); SPL/FPL = Z do início e
 * do fim da rosca; DM1/DM2 = Ø no início e no fim (diferentes = rosca cônica; na rosca
 * interna é o Ø do furo, como diz o manual); APP/ROP =
 * percurso de entrada e de saída; TDEP = profundidade do filete (raio); FAL = sobremetal do
 * último passe; IANG = ângulo de penetração (+ por um flanco, − alternado); NSP = ângulo
 * de início; NRC = passes de desbaste; NID = passes em vazio; VARI 1 externo / 2 interno
 * com penetração constante, 3 externo / 4 interno com seção de cavaco constante;
 * NUMT = número de entradas; _VRT = afastamento (padrão 1 mm).
 *
 * Sequência (cada passe): rápido ao ponto de entrada (APP antes de SPL), rápido à
 * profundidade do passe, rosca (G33) até FPL, saída inclinada durante ROP, recuo rápido
 * e volta ao início. Profundidades: constante = TDEP·k/NRC; seção constante = TDEP·√(k/NRC).
 */
export function cycle97(args, ctx) {
  const p = named(P97, args);
  const lead = p.PIT > 0 ? p.PIT : METRIC_COARSE[Math.round(p.MPIT)];
  if (!(lead > 0)) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE97', p: 'PIT/MPIT' });
  for (const k of ['SPL', 'FPL', 'DM1', 'TDEP']) {
    if (p[k] === undefined || (k !== 'SPL' && k !== 'FPL' && !(p[k] > 0))) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE97', p: k });
  }
  const VARI = Math.round(p.VARI ?? 1);
  if (VARI < 1 || VARI > 4) throw new GCodeAlarm('E_CYCLE_VARI', { c: 'CYCLE97', v: p.VARI });
  if (Math.abs(p.FPL - p.SPL) < 1e-6) throw new GCodeAlarm('E_CYCLE_PARAM', { c: 'CYCLE97', p: 'FPL' });
  const internal = VARI === 2 || VARI === 4;
  const degressive = VARI >= 3;
  const tool = ctx.tool;
  const warnings = [];
  if (tool && (tool.kind === 'internal') !== internal) warnings.push({ code: 'W_CYCLE_TOOL_KIND', params: { c: 'CYCLE97' } });

  const k = ctx.diam ? 0.5 : 1;
  const r1 = p.DM1 * k;
  const r2 = (p.DM2 > 0 ? p.DM2 : p.DM1) * k;
  const TDEP = p.TDEP;
  const FAL = Math.max(0, Math.min(p.FAL || 0, TDEP));
  const NRC = Math.max(1, Math.round(p.NRC || 1));
  const NID = Math.max(0, Math.round(p.NID || 0));
  const NUMT = Math.max(1, Math.round(p.NUMT || 1));
  const VRT = p.VRT > 0 ? p.VRT : 1;
  const dir = p.FPL < p.SPL ? -1 : 1;
  const zs = p.SPL - dir * (p.APP || 0);
  const ze = p.FPL + dir * (p.ROP || 0);
  // v = s·r; DM1/DM2 = Ø da crista: externo = Ø nominal; interno = Ø do furo (manual 802D sl)
  const s = internal ? -1 : 1;
  const rNom = (z) => r1 + ((r2 - r1) * (z - p.SPL)) / (p.FPL - p.SPL);
  const vCrest = (z) => s * rNom(z);
  const vRet = Math.max(vCrest(zs), vCrest(ze)) + VRT;

  const depths = [];
  for (let i = 1; i <= NRC; i++) depths.push((TDEP - FAL) * (degressive ? Math.sqrt(i / NRC) : i / NRC));
  if (FAL > 0) depths.push(TDEP);
  for (let i = 0; i < NID; i++) depths.push(TDEP);

  const tanI = Math.tan((Math.abs(p.IANG || 0) * Math.PI) / 180);
  const mv = new Moves([ctx.cur[0], s * ctx.cur[1]]);
  for (let st = 0; st < NUMT; st++) {
    const phase = (p.NSP || 0) + (st * 360) / NUMT;
    depths.forEach((d, i) => {
      // penetração pelo flanco: desloca o início ao longo de Z (alternado se IANG < 0)
      const side = (p.IANG || 0) < 0 && i % 2 === 1 ? -1 : 1;
      const shift = -dir * side * d * tanI;
      const za = zs + shift;
      if (mv.pos[1] < vRet) mv.rapid([mv.pos[0], vRet]);
      mv.rapid([za, vRet], [za, vCrest(za) - d]);
      const thread = { lead, phase, zRef: zs };
      const pts = [[p.FPL + shift, vCrest(p.FPL) - d]];
      if (p.ROP > 0) pts.push([ze + shift, vCrest(ze)]);
      mv.add('thread', pts, { F: lead, thread });
      mv.rapid([mv.pos[0], vRet]);
    });
  }
  mv.rapid([zs, vRet]);
  return { moves: mv.toZR(([u, v]) => [u, s * v]), warnings };
}

export const CYCLES = { CYCLE95: cycle95, CYCLE93: cycle93, CYCLE97: cycle97 };
