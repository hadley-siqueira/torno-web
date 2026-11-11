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

export const TOOL_TYPES = {
  ext_rough_80: {
    kind: 'external',
    name: { pt: 'Desbaste externo 80°', en: 'External roughing 80°' },
    detail: { pt: 'Pastilha CNMG, suporte 95°', en: 'CNMG insert, 95° holder' },
    color: 0xd4a017,
    insert: rhombus(12, 85, 5),
    holder: { z0: 3, z1: 23, x0: 9, x1: 70 },
  },
  ext_finish_55: {
    kind: 'external',
    name: { pt: 'Acabamento externo 55°', en: 'External finishing 55°' },
    detail: { pt: 'Pastilha DNMG, suporte 93°', en: 'DNMG insert, 93° holder' },
    color: 0xb0b8c8,
    insert: rhombus(13, 87, 32),
    holder: { z0: 4, z1: 22, x0: 14, x1: 70 },
  },
  ext_finish_35: {
    kind: 'external',
    name: { pt: 'Acabamento externo 35°', en: 'External finishing 35°' },
    detail: { pt: 'Pastilha VNMG, suporte 93° (perfis e cópia)', en: 'VNMG insert, 93° holder (profiling)' },
    color: 0xc0c0d0,
    insert: rhombus(14, 87, 52),
    holder: { z0: 4, z1: 22, x0: 18, x1: 70 },
  },
  groove_3: {
    kind: 'external',
    name: { pt: 'Bedame 3 mm', en: 'Grooving/parting 3 mm' },
    detail: { pt: 'Canal e corte; referência no canto esquerdo', en: 'Grooving and parting; reference at left corner' },
    color: 0x5aa0e0,
    insert: [[0, 0], [3, 0], [3, 25], [0, 25]],
    holder: { z0: 0, z1: 20, x0: 25, x1: 70 },
  },
  thread_ext_60: {
    kind: 'external',
    name: { pt: 'Rosca externa 60°', en: 'External threading 60°' },
    detail: { pt: 'Perfil métrico; referência na ponta do V', en: 'Metric profile; reference at V tip' },
    color: 0x9ad04a,
    insert: [[0, 0], [3, 3 * t60], [3, 12], [-3, 12], [-3, 3 * t60]],
    holder: { z0: -5, z1: 15, x0: 12, x1: 70 },
  },
  center_drill: {
    kind: 'axial',
    name: { pt: 'Broca de centro', en: 'Center drill' },
    detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' },
    color: 0xb8b8b8,
    insert: [[0, 0], [1, 1.5], [4, 1.5], [6, 4], [40, 4], [40, -4], [6, -4], [4, -1.5], [1, -1.5]],
    holder: { z0: 40, z1: 65, x0: -14, x1: 14 },
  },
  drill_6: { kind: 'axial', name: { pt: 'Broca helicoidal Ø6', en: 'Twist drill Ø6' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(6, 60), holder: { z0: 60, z1: 85, x0: -14, x1: 14 } },
  drill_10: { kind: 'axial', name: { pt: 'Broca helicoidal Ø10', en: 'Twist drill Ø10' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(10, 70), holder: { z0: 70, z1: 95, x0: -14, x1: 14 } },
  drill_12: { kind: 'axial', name: { pt: 'Broca helicoidal Ø12', en: 'Twist drill Ø12' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(12, 75), holder: { z0: 75, z1: 100, x0: -14, x1: 14 } },
  drill_16: { kind: 'axial', name: { pt: 'Broca helicoidal Ø16', en: 'Twist drill Ø16' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(16, 85), holder: { z0: 85, z1: 110, x0: -16, x1: 16 } },
  drill_20: { kind: 'axial', name: { pt: 'Broca helicoidal Ø20', en: 'Twist drill Ø20' }, detail: { pt: 'Ponta no eixo da peça (X0)', en: 'Tip on the spindle axis (X0)' }, color: 0x8f8f9a, insert: drill(20, 95), holder: { z0: 95, z1: 120, x0: -18, x1: 18 } },
  boring_bar: {
    kind: 'internal',
    name: { pt: 'Barra de mandrilar', en: 'Boring bar' },
    detail: { pt: 'Desbaste e acabamento interno; furo mínimo Ø14', en: 'Internal roughing and finishing; min. bore Ø14' },
    color: 0xd08a4a,
    insert: [[0, 0], [3, -1.5], [60, -1.5], [60, -8], [3, -8], [0, -3]],
    cutZone: [0, 3], // faixa dz da pastilha (o resto é o corpo da barra)
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
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

export const TOOL_SLOTS = 8;

/** Montagem sugerida da torre (usada pelos exemplos). */
export const TURRET_DEFAULT = {
  1: 'ext_rough_80',
  2: 'ext_finish_35',
  3: 'groove_3',
  4: 'thread_ext_60',
  5: 'center_drill',
  6: 'drill_16',
  7: 'boring_bar',
  8: 'thread_int_60',
};

/** Valida a configuração da torre: { posição: tipo | '' (vazia) }. */
export function sanitizeTurret(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  for (let n = 1; n <= TOOL_SLOTS; n++) {
    const v = cfg[n];
    if (v === '' || v === null) out[n] = '';
    else if (typeof v === 'string' && TOOL_TYPES[v]) out[n] = v;
    else out[n] = TURRET_DEFAULT[n];
  }
  return out;
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
