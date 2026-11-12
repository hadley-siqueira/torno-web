// Medição da peça (sem interface): usada pelas réguas da vista Lateral
// (public/js/rulers.js) e pelos testes.

import { GONE } from './stock-model.js';

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/** Menor passo "redondo" de régua cuja distância na tela é de pelo menos minPx. */
export function niceStep(pxPerUnit, minPx) {
  for (const s of STEPS) if (s * pxPerUnit >= minPx) return s;
  return STEPS[STEPS.length - 1];
}

/**
 * Faces (degraus do perfil) de uma peça { r, ri, N, zAt(i) }: posições z onde o raio
 * externo, o interno ou a presença de material mudam. A face fica entre duas amostras;
 * a posição é o ponto médio arredondado a 0,05 mm (passo do modelo), para que uma face
 * programada em Z-20 apareça como -20.00.
 */
export function profileFaces(stock, minStep = 0.1) {
  const { r, ri, N } = stock;
  const solid = (i) => r[i] - ri[i] >= GONE;
  const faces = [];
  const round = (z) => Math.round(z / 0.05) * 0.05 + 0; // + 0 evita -0
  for (let i = 1; i < N; i++) {
    const a = solid(i - 1);
    const b = solid(i);
    const change =
      a !== b || (a && b && (Math.abs(r[i] - r[i - 1]) > minStep || Math.abs(ri[i] - ri[i - 1]) > minStep));
    if (change) faces.push(round((stock.zAt(i - 1) + stock.zAt(i)) / 2));
  }
  return faces;
}

/** Trecho [zMin, zMax] com material, ou null. */
export function materialExtent(stock) {
  const { r, ri, N } = stock;
  let a = 0;
  let b = N - 1;
  while (a < N && r[a] - ri[a] < GONE) a++;
  while (b >= 0 && r[b] - ri[b] < GONE) b--;
  return a > b ? null : [stock.zAt(a), stock.zAt(b)];
}
