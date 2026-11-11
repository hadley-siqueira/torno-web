// Tabela de ferramentas padrão da torre (8 posições).
// Coordenadas no sistema da ferramenta: [dz, dx] em mm, relativas à ponta
// programada (ponto de referência). dz cresce para +Z (para longe da placa),
// dx cresce para +X (radial, para fora da peça).
//
// kind:
//   'external' – usina o perfil externo (simulado)
//   'internal' – usina por dentro de um furo (ainda não simulado)
//   'axial'    – broca no centro (ainda não simulado)
// O suporte (holder) é apenas visual.

const deg = (a) => (a * Math.PI) / 180;
const polar = (len, angDeg) => [len * Math.cos(deg(angDeg)), len * Math.sin(deg(angDeg))];

function rhombus(len, angA, angB) {
  const A = polar(len, angA);
  const B = polar(len, angB);
  return [[0, 0], B, [A[0] + B[0], A[1] + B[1]], A];
}

const t60 = Math.tan(deg(60));

export const TOOLS = {
  1: {
    id: 1,
    kind: 'external',
    name: { pt: 'Desbaste externo 80°', en: 'External roughing 80°' },
    detail: { pt: 'Pastilha CNMG, suporte 95°', en: 'CNMG insert, 95° holder' },
    color: 0xd4a017,
    insert: rhombus(12, 85, 5),
    holder: { z0: 3, z1: 23, x0: 9, x1: 70 },
  },
  2: {
    id: 2,
    kind: 'external',
    name: { pt: 'Acabamento externo 35°', en: 'External finishing 35°' },
    detail: { pt: 'Pastilha VNMG, suporte 93°', en: 'VNMG insert, 93° holder' },
    color: 0xc0c0d0,
    insert: rhombus(14, 87, 52),
    holder: { z0: 4, z1: 22, x0: 18, x1: 70 },
  },
  3: {
    id: 3,
    kind: 'external',
    name: { pt: 'Bedame 3 mm', en: 'Grooving/parting 3 mm' },
    detail: { pt: 'Referência no canto esquerdo', en: 'Reference at left corner' },
    color: 0x5aa0e0,
    insert: [[0, 0], [3, 0], [3, 25], [0, 25]],
    holder: { z0: 0, z1: 20, x0: 25, x1: 70 },
  },
  4: {
    id: 4,
    kind: 'external',
    name: { pt: 'Rosca externa 60°', en: 'External threading 60°' },
    detail: { pt: 'Perfil métrico, ponta no centro do V', en: 'Metric profile, reference at V tip' },
    color: 0x9ad04a,
    insert: [[0, 0], [3, 3 * t60], [3, 12], [-3, 12], [-3, 3 * t60]],
    holder: { z0: -5, z1: 15, x0: 12, x1: 70 },
  },
  5: {
    id: 5,
    kind: 'axial',
    name: { pt: 'Broca de centro', en: 'Center drill' },
    detail: { pt: 'Ponta no eixo da peça', en: 'Tip on the spindle axis' },
    color: 0xb8b8b8,
    insert: [[0, 0], [1, 1.5], [4, 1.5], [6, 4], [40, 4], [40, -4], [6, -4], [4, -1.5], [1, -1.5]],
    holder: { z0: 40, z1: 65, x0: -14, x1: 14 },
  },
  6: {
    id: 6,
    kind: 'axial',
    name: { pt: 'Broca helicoidal Ø10', en: 'Twist drill Ø10' },
    detail: { pt: 'Ponta no eixo da peça', en: 'Tip on the spindle axis' },
    color: 0x8f8f9a,
    insert: [[0, 0], [3, 5], [70, 5], [70, -5], [3, -5]],
    holder: { z0: 70, z1: 95, x0: -14, x1: 14 },
  },
  7: {
    id: 7,
    kind: 'internal',
    name: { pt: 'Barra de mandrilar', en: 'Boring bar' },
    detail: { pt: 'Desbaste e acabamento interno', en: 'Internal roughing and finishing' },
    color: 0xd08a4a,
    insert: [[0, 0], [4, -2], [60, -2], [60, -10], [4, -10], [0, -4]],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
  },
  8: {
    id: 8,
    kind: 'internal',
    name: { pt: 'Rosca interna 60°', en: 'Internal threading 60°' },
    detail: { pt: 'Perfil métrico, ponta no centro do V', en: 'Metric profile, reference at V tip' },
    color: 0xc06ad0,
    insert: [[0, 0], [2, -2 * t60], [60, -2 * t60], [60, -10], [-2, -10], [-2, -2 * t60]],
    holder: { z0: 60, z1: 85, x0: -16, x1: 10 },
  },
};

export const TOOL_SLOTS = 8;

/** A simulação de remoção de material só cobre ferramentas externas por enquanto. */
export const isSimulated = (tool) => tool?.kind === 'external';

export function toolName(tool, lang = 'pt') {
  if (!tool) return '';
  return tool.name[lang] || tool.name.pt;
}

/** Menor dx do polígono (convexo) na vertical dz, ou null se fora. */
export function lowerBoundary(poly, dz) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const [z0, x0] = poly[i];
    const [z1, x1] = poly[(i + 1) % poly.length];
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    if (dz < lo - 1e-9 || dz > hi + 1e-9) continue;
    let x;
    if (Math.abs(z1 - z0) < 1e-9) x = Math.min(x0, x1);
    else x = x0 + ((dz - z0) / (z1 - z0)) * (x1 - x0);
    if (best === null || x < best) best = x;
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

export function getTool(n) {
  return TOOLS[n] || null;
}
