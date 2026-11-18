// Catálogo de ferramentas e montagem da torre (8 posições).
//
// Na indústria não existe posição fixa: quem prepara a máquina escolhe em qual
// posição da torre vai cada ferramenta e registra isso na folha de ferramentas
// do programa. Por isso a torre é configurável; TURRET_DEFAULT é só a montagem
// sugerida, usada pelos exemplos.
//
// Geometria: [dz, dx] em mm, relativa à ponta programada (ponto de referência).
// dz cresce para +Z (para longe da placa), dx cresce para +X (para fora da peça).
//
// kind:
//   'external' – usina o perfil externo
//   'internal' – usina por dentro de um furo (ponta voltada para +X)
//   'axial'    – broca no centro da peça (X0)
// O suporte (holder) é apenas visual.
// feed: faixa típica de avanço em mm/rot (fora dela o interpretador avisa; não é alarme).
// edges: outros cortes da mesma ferramenta, escolhidos pelo corretor D; dz desloca o ponto
//   de referência. Bedame: no SinuTrain D1 = canto direito e D2 = esquerdo; na máquina do
//   laboratório D1 = esquerdo e D2 = direito (professor, 2026-11-18). Os bedames do magazine
//   do SinuTrain seguem o SinuTrain; o "groove_3_lab" (torres da apostila e de 8 posições)
//   segue a máquina.

const deg = (a) => (a * Math.PI) / 180;
const polar = (len, angDeg) => [len * Math.cos(deg(angDeg)), len * Math.sin(deg(angDeg))];
const t60 = Math.tan(deg(60));

function rhombus(len, angA, angB) {
  const A = polar(len, angA);
  const B = polar(len, angB);
  return [[0, 0], B, [A[0] + B[0], A[1] + B[1]], A];
}

// Broca: ponta de 118°, corpo de diâmetro d
function drill(d, len) {
  const r = d / 2;
  const tip = r / Math.tan(deg(59));
  return [[0, 0], [tip, r], [len, r], [len, -r], [tip, -r]];
}

/**
 * Bedame com a referência (D1) no canto direito, como no SinuTrain: a pastilha e o suporte
 * passam para a esquerda da referência e o D2 vira o canto esquerdo.
 */
function rightRef(t, w = 3) {
  const sh = ([z, x]) => [z - w, x];
  return {
    ...t,
    detail: {
      pt: t.detail.pt.replace('canto esquerdo', 'canto direito (D1; D2 = esquerdo)'),
      en: t.detail.en.replace('left corner', 'right corner (D1; D2 = left)'),
    },
    insert: t.insert.map(sh),
    cutZone: t.cutZone && [t.cutZone[0] - w, t.cutZone[1] - w],
    holder: { ...t.holder, z0: t.holder.z0 - w, z1: t.holder.z1 - w },
    edges: { 2: { dz: w, name: { pt: 'canto esquerdo', en: 'left corner' } } },
  };
}

export const TOOL_TYPES = {
  ext_rough_80: {
    kind: 'external',
    stName: 'ROUGHING_T80 A',
    name: { pt: 'Desbaste externo 80°', en: 'External roughing 80°' },
    detail: { pt: 'Pastilha CNMG, suporte 95°', en: 'CNMG insert, 95° holder' },
    color: 0xd4a017,
    insert: rhombus(12, 85, 5),
    holder: { z0: 3, z1: 23, x0: 9, x1: 70 },
    feed: [0.1, 0.6],
  },
  ext_finish_55: {
    kind: 'external',
    name: { pt: 'Acabamento externo 55°', en: 'External finishing 55°' },
    detail: { pt: 'Pastilha DNMG, suporte 93°', en: 'DNMG insert, 93° holder' },
    color: 0xb0b8c8,
    insert: rhombus(13, 87, 32),
    holder: { z0: 4, z1: 22, x0: 14, x1: 70 },
    feed: [0.03, 0.35],
  },
  ext_finish_35: {
    kind: 'external',
    stName: 'FINISHING_T35 A',
    name: { pt: 'Acabamento externo 35°', en: 'External finishing 35°' },
    detail: { pt: 'Pastilha VNMG, suporte 93° (perfis e cópia)', en: 'VNMG insert, 93° holder (profiling)' },
    color: 0xc0c0d0,
    insert: rhombus(14, 87, 52),
    holder: { z0: 4, z1: 22, x0: 18, x1: 70 },
    feed: [0.03, 0.35],
  },
  groove_3: {
    kind: 'external',
    stName: 'PLUNGE_CUTTER_3 A',
    name: { pt: 'Bedame 3 mm', en: 'Grooving/parting 3 mm' },
    detail: { pt: 'Canal e corte; referência no canto esquerdo', en: 'Grooving and parting; reference at left corner' },
    color: 0x5aa0e0,
    insert: [[0, 0], [3, 0], [3, 25], [0, 25]],
    holder: { z0: 0, z1: 20, x0: 25, x1: 70 },
    feed: [0.01, 0.2],
    edges: { 2: { dz: -3, name: { pt: 'canto direito', en: 'right corner' } } },
  },
  thread_ext_60: {
    kind: 'external',
    stName: 'THREADING_1.5',
    name: { pt: 'Rosca externa 60°', en: 'External threading 60°' },
    detail: { pt: 'Perfil métrico; referência na ponta do V', en: 'Metric profile; reference at V tip' },
    color: 0x9ad04a,
    insert: [[0, 0], [3, 3 * t60], [3, 12], [-3, 12], [-3, 3 * t60]],
    holder: { z0: -5, z1: 15, x0: 12, x1: 70 },
  },
  // Acabamento 35° "invertido": a pastilha aponta para a placa e o suporte fica à
  // esquerda da ponta; corta puxando para +Z (rebaixos e perfis voltados para a placa)
  ext_finish_35_r: {
    kind: 'external',
    stName: 'FINISHING_T35_R',
    name: { pt: 'Acabamento externo 35° (invertido)', en: 'External finishing 35° (reversed)' },
    detail: { pt: 'Pastilha VNMG espelhada; corta no sentido +Z', en: 'Mirrored VNMG insert; cuts towards +Z' },
    color: 0xd0c0c0,
    insert: rhombus(14, 93, 128),
    holder: { z0: -22, z1: -4, x0: 18, x1: 70 },
    feed: [0.03, 0.35],
  },
  // Bedame 3 mm com lâmina mais longa (alcança o centro para cortar a peça)
  parting_3: {
    kind: 'external',
    stName: 'PLUNGE_CUTTER_3P',
    name: { pt: 'Bedame de corte 3 mm (lâmina longa)', en: 'Parting blade 3 mm (long)' },
    detail: { pt: 'Corte da peça; referência no canto esquerdo', en: 'Parting off; reference at left corner' },
    color: 0x4a86c8,
    insert: [[0, 0], [3, 0], [3, 35], [0, 35]],
    holder: { z0: 0, z1: 20, x0: 35, x1: 75 },
    feed: [0.01, 0.2],
    edges: { 2: { dz: -3, name: { pt: 'canto direito', en: 'right corner' } } },
  },
  // Pastilha redonda Ø8 ("button"): referência no ponto mais baixo do círculo
  button_8: {
    kind: 'external',
    stName: 'BUTTON_TOOL_8',
    name: { pt: 'Pastilha redonda Ø8', en: 'Round insert Ø8' },
    detail: { pt: 'Perfis curvos; referência no ponto mais baixo do círculo', en: 'Curved profiles; reference at the lowest point of the circle' },
    color: 0xe0b040,
    insert: Array.from({ length: 24 }, (_, k) => {
      if (k === 0) return [0, 0];
      const a = -Math.PI / 2 + (k / 24) * Math.PI * 2;
      return [4 * Math.cos(a), 4 + 4 * Math.sin(a)];
    }),
    holder: { z0: -5, z1: 15, x0: 7, x1: 70 },
    feed: [0.05, 0.5],
  },
  center_drill: {
    kind: 'axial',
    name: { pt: 'Broca de centro', en: 'Center drill' },
    detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' },
    color: 0xb8b8b8,
    insert: [[0, 0], [1, 1.5], [4, 1.5], [6, 4], [40, 4], [40, -4], [6, -4], [4, -1.5], [1, -1.5]],
    holder: { z0: 40, z1: 65, x0: -14, x1: 14 },
    feed: [0.02, 0.25],
  },
  drill_6: { kind: 'axial', name: { pt: 'Broca helicoidal Ø6', en: 'Twist drill Ø6' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(6, 60), holder: { z0: 60, z1: 85, x0: -14, x1: 14 }, feed: [0.03, 0.4] },
  drill_10: { kind: 'axial', name: { pt: 'Broca helicoidal Ø10', en: 'Twist drill Ø10' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(10, 70), holder: { z0: 70, z1: 95, x0: -14, x1: 14 }, feed: [0.03, 0.4] },
  drill_12: { kind: 'axial', name: { pt: 'Broca helicoidal Ø12', en: 'Twist drill Ø12' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(12, 75), holder: { z0: 75, z1: 100, x0: -14, x1: 14 }, feed: [0.03, 0.4] },
  drill_16: { kind: 'axial', name: { pt: 'Broca helicoidal Ø16', en: 'Twist drill Ø16' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(16, 85), holder: { z0: 85, z1: 110, x0: -16, x1: 16 }, feed: [0.03, 0.4] },
  drill_20: { kind: 'axial', name: { pt: 'Broca helicoidal Ø20', en: 'Twist drill Ø20' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(20, 95), holder: { z0: 95, z1: 120, x0: -18, x1: 18 }, feed: [0.03, 0.4] },
  drill_5: { kind: 'axial', stName: 'DRILL_5', name: { pt: 'Broca helicoidal Ø5', en: 'Twist drill Ø5' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(5, 50), holder: { z0: 50, z1: 75, x0: -14, x1: 14 }, feed: [0.03, 0.3] },
  drill_32: { kind: 'axial', stName: 'DRILL_32', name: { pt: 'Broca helicoidal Ø32', en: 'Twist drill Ø32' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(32, 120), holder: { z0: 120, z1: 145, x0: -24, x1: 24 }, feed: [0.05, 0.5] },
  // Fresa de topo Ø8 usada no centro, como uma broca de fundo plano
  // (no SinuTrain é ferramenta acionada; aqui não há eixo C)
  cutter_8: {
    kind: 'axial',
    stName: 'CUTTER_8',
    name: { pt: 'Fresa de topo Ø8', en: 'End mill Ø8' },
    detail: { pt: 'Usada no centro (X0), como broca de fundo plano; sem eixo C', en: 'Used on the axis (X0) as a flat-bottom drill; no C axis' },
    color: 0x7fa0b8,
    insert: [[0, -4], [45, -4], [45, 4], [0, 4], [0, 0]],
    holder: { z0: 45, z1: 70, x0: -14, x1: 14 },
    feed: [0.02, 0.15],
  },
  int_rough_80: {
    kind: 'internal',
    stName: 'ROUGHING_T80 I',
    name: { pt: 'Desbaste interno 80°', en: 'Internal roughing 80°' },
    detail: { pt: 'Pastilha CNMG em barra; furo mínimo Ø16', en: 'CNMG insert on a bar; min. bore Ø16' },
    color: 0xd4a017,
    insert: [[0, 0], [5, -0.4], [60, -1.5], [60, -8], [5, -8], [0, -5.6]], // aresta frontal reta: corta o ressalto ao entrar
    cutZone: [0, 5],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
    feed: [0.08, 0.4],
  },
  int_finish_35: {
    kind: 'internal',
    stName: 'FINISHING_T35 I',
    name: { pt: 'Acabamento interno 35°', en: 'Internal finishing 35°' },
    detail: { pt: 'Pastilha VNMG em barra; furo mínimo Ø20', en: 'VNMG insert on a bar; min. bore Ø20' },
    color: 0xc0c0d0,
    insert: [[0, 0], [3, -3.8], [60, -3.8], [60, -9.5], [3, -9.5], [0, -4]],
    cutZone: [0, 3],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
    feed: [0.03, 0.3],
  },
  groove_int_3: {
    kind: 'internal',
    stName: 'PLUNGE_CUTTER_3 I',
    name: { pt: 'Bedame interno 3 mm', en: 'Internal grooving 3 mm' },
    detail: { pt: 'Canal interno; referência no canto esquerdo; furo mínimo Ø22', en: 'Internal groove; reference at left corner; min. bore Ø22' },
    color: 0x5aa0e0,
    insert: [[0, 0], [3, 0], [3, -4], [60, -4], [60, -10], [0, -10]],
    cutZone: [0, 3],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
    feed: [0.01, 0.15],
    edges: { 2: { dz: -3, name: { pt: 'canto direito', en: 'right corner' } } },
  },
  boring_bar: {
    kind: 'internal',
    name: { pt: 'Barra de mandrilar', en: 'Boring bar' },
    detail: { pt: 'Desbaste e acabamento interno; furo mínimo Ø14', en: 'Internal roughing and finishing; min. bore Ø14' },
    color: 0xd08a4a,
    insert: [[0, 0], [3, -1.5], [60, -1.5], [60, -8], [3, -8], [0, -3]],
    cutZone: [0, 3], // faixa dz da pastilha (o resto é o corpo da barra)
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
    feed: [0.03, 0.35],
  },
  thread_int_60: {
    kind: 'internal',
    name: { pt: 'Rosca interna 60°', en: 'Internal threading 60°' },
    detail: { pt: 'Perfil métrico; referência na ponta do V; furo mínimo Ø16', en: 'Metric profile; reference at V tip; min. bore Ø16' },
    color: 0xc06ad0,
    insert: [[0, 0], [2, -2 * t60], [60, -2 * t60], [60, -9], [-2, -9], [-2, -2 * t60]],
    cutZone: [-2, 2],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
  },
};

// Bedame da máquina do laboratório (D1 = canto esquerdo), para as torres da apostila e de
// 8 posições; os bedames do magazine do SinuTrain passam a ter D1 = canto direito.
TOOL_TYPES.groove_3_lab = {
  ...TOOL_TYPES.groove_3,
  stName: undefined,
  name: { pt: 'Bedame 3 mm (máquina da escola)', en: 'Grooving/parting 3 mm (school machine)' },
  detail: { pt: 'Canal e corte; referência no canto esquerdo (D1; D2 = direito)', en: 'Grooving and parting; reference at left corner (D1; D2 = right)' },
};
for (const k of ['groove_3', 'parting_3', 'groove_int_3']) TOOL_TYPES[k] = rightRef(TOOL_TYPES[k]);

/**
 * Posições do magazine. A máquina da escola tem torre de 8 posições; o SinuTrain usa um
 * magazine maior (MAGAZIN1). As posições 1–13 seguem o SinuTrain; 14–16 completam as
 * ferramentas que os exemplos usam e o SinuTrain não traz (broca de centro, broca Ø16,
 * rosca interna).
 */
export const TOOL_SLOTS = 16;

/** Montagem padrão: o magazine do SinuTrain (Seleção de ferramentas, MAGAZIN1). */
export const TURRET_DEFAULT = {
  1: 'ext_rough_80', // ROUGHING_T80 A
  2: 'drill_32', // DRILL_32
  3: 'ext_finish_35', // FINISHING_T35 A
  4: 'int_rough_80', // ROUGHING_T80 I
  5: 'groove_3', // PLUNGE_CUTTER_3 A
  6: 'groove_int_3', // PLUNGE_CUTTER_3 I
  7: 'int_finish_35', // FINISHING_T35 I
  8: 'thread_ext_60', // THREADING_1.5
  9: 'cutter_8', // CUTTER_8
  10: 'drill_5', // DRILL_5
  11: 'button_8', // BUTTON_TOOL_8
  12: 'ext_finish_35_r', // FINISHING_T35_R
  13: 'parting_3', // PLUNGE_CUTTER_3P
  14: 'center_drill',
  15: 'drill_16',
  16: 'thread_int_60',
};

const EMPTY = Object.fromEntries(Array.from({ length: TOOL_SLOTS }, (_, i) => [i + 1, '']));

/**
 * Montagens prontas para escolher na tela.
 * - sinutrain: o magazine do SinuTrain (padrão).
 * - apostila: como nos exercícios da apostila do professor (T1 desbaste, T2 bedame,
 *   T6 rosca externa, T8 acabamento/perfil); as demais posições ficam vazias.
 * - torre8: a montagem de 8 posições usada antes (curso técnico).
 */
export const TURRET_PRESETS = {
  default: TURRET_DEFAULT,
  sinutrain: TURRET_DEFAULT,
  apostila: { ...EMPTY, 1: 'ext_rough_80', 2: 'groove_3_lab', 6: 'thread_ext_60', 8: 'ext_finish_35' },
  torre8: {
    ...EMPTY,
    1: 'ext_rough_80', 2: 'ext_finish_35', 3: 'groove_3_lab', 4: 'thread_ext_60',
    5: 'center_drill', 6: 'drill_16', 7: 'boring_bar', 8: 'thread_int_60',
  },
};

/**
 * Valida a configuração da torre: { posição: tipo | '' (vazia) }. Tipo desconhecido volta
 * ao padrão; posição ausente fica vazia (configurações antigas tinham só 8 posições).
 */
export function sanitizeTurret(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  for (let n = 1; n <= TOOL_SLOTS; n++) {
    const v = cfg[n];
    if (v === '' || v === null || v === undefined) out[n] = '';
    else if (typeof v === 'string' && TOOL_TYPES[v]) out[n] = v;
    else out[n] = TURRET_DEFAULT[n];
  }
  return out;
}

/** A torre de 8 posições que era o padrão até 2026-11: quem nunca a mudou passa ao novo padrão. */
export function isLegacyDefault(cfg) {
  const old = { ...TURRET_PRESETS.torre8, 3: 'groove_3' }; // o bedame antigo era o "groove_3"
  return !!cfg && Object.keys(cfg).length <= 8 && [1, 2, 3, 4, 5, 6, 7, 8].every((n) => cfg[n] === old[n]);
}

/** Posição da ferramenta com o nome do SinuTrain (T="ROUGHING_T80 A"), ou null. */
export function findToolByName(name, turret = DEFAULT_TURRET) {
  const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const want = norm(name);
  for (const t of Object.values(turret)) if (t.stName && norm(t.stName) === want) return t.id;
  return null;
}

/** Monta a torre: { posição: ferramenta com id = posição }. Posições vazias ficam de fora. */
export function buildTurret(cfg = TURRET_DEFAULT) {
  const turret = {};
  const c = sanitizeTurret(cfg) || TURRET_DEFAULT;
  for (let n = 1; n <= TOOL_SLOTS; n++) {
    const type = c[n];
    if (type) turret[n] = { id: n, type, ...TOOL_TYPES[type] };
  }
  return turret;
}

export const DEFAULT_TURRET = buildTurret();

/** Remoção de material simulada para todos os tipos (externa, interna e furação). */
export const isSimulated = (tool) => !!tool;

export function toolName(tool, lang = 'pt') {
  if (!tool) return '';
  return tool.name[lang] || tool.name.pt;
}

/** Menor dx do polígono (convexo) na vertical dz, ou null se fora. */
export function lowerBoundary(poly, dz) {
  return boundary(poly, dz, Math.min);
}

/** Maior dx do polígono (convexo) na vertical dz, ou null se fora. */
export function upperBoundary(poly, dz) {
  return boundary(poly, dz, Math.max);
}

function boundary(poly, dz, pick) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const [z0, x0] = poly[i];
    const [z1, x1] = poly[(i + 1) % poly.length];
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    if (dz < lo - 1e-9 || dz > hi + 1e-9) continue;
    let x;
    if (Math.abs(z1 - z0) < 1e-9) x = pick(x0, x1);
    else x = x0 + ((dz - z0) / (z1 - z0)) * (x1 - x0);
    best = best === null ? x : pick(best, x);
  }
  return best;
}

/** Faixa dz ocupada pela pastilha. */
export function insertSpan(poly) {
  let min = Infinity;
  let max = -Infinity;
  for (const [z] of poly) {
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  return [min, max];
}

export function getTool(n, turret = DEFAULT_TURRET) {
  return turret[n] || null;
}

const edgeCache = new Map();
/**
 * Ferramenta com o corte escolhido pelo corretor D: D1 (ou um D sem corte próprio) é a
 * própria ferramenta; um corte de `edges` desloca a pastilha e o suporte de dz, e ganha um
 * tipo próprio ("groove_3@D2") para o modelo da peça guardar a tabela certa.
 */
export function withEdge(tool, d) {
  const e = tool?.edges?.[d];
  if (!e) return tool;
  const key = `${tool.id}:${tool.type}@D${d}`;
  let t = edgeCache.get(key);
  if (!t) {
    const h = tool.holder;
    t = {
      ...tool,
      type: `${tool.type}@D${d}`,
      edge: d,
      edgeDz: e.dz,
      insert: tool.insert.map(([z, x]) => [z + e.dz, x]),
      holder: { ...h, z0: h.z0 + e.dz, z1: h.z1 + e.dz },
      cutZone: tool.cutZone && [tool.cutZone[0] + e.dz, tool.cutZone[1] + e.dz],
    };
    edgeCache.set(key, t);
  }
  return t;
}
