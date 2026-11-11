// Tabela de ferramentas do torno.
// Coordenadas no sistema da ferramenta: [dz, dx] em mm, relativas à ponta
// programada (ponto de referência). dz cresce para +Z (para longe da placa),
// dx cresce para +X (radial, para fora da peça).
// O suporte (holder) é apenas visual.

const deg = (a) => (a * Math.PI) / 180;
const polar = (len, angDeg) => [len * Math.cos(deg(angDeg)), len * Math.sin(deg(angDeg))];

function rhombus(len, angA, angB) {
  const A = polar(len, angA);
  const B = polar(len, angB);
  return [[0, 0], B, [A[0] + B[0], A[1] + B[1]], A];
}

export const TOOLS = {
  1: {
    id: 1,
    name: 'Desbaste 80° (CNMG) – suporte 95°',
    color: 0xd4a017,
    insert: rhombus(12, 85, 5),
    holder: { z0: 3, z1: 23, x0: 9, x1: 70 },
  },
  2: {
    id: 2,
    name: 'Acabamento 35° (VNMG) – suporte 93°',
    color: 0xc0c0d0,
    insert: rhombus(14, 87, 52),
    holder: { z0: 4, z1: 22, x0: 18, x1: 70 },
  },
  3: {
    id: 3,
    name: 'Bedame 3 mm (canal/corte) – ref. canto esquerdo',
    color: 0x5aa0e0,
    insert: [[0, 0], [3, 0], [3, 25], [0, 25]],
    holder: { z0: 0, z1: 20, x0: 25, x1: 70 },
  },
};

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
