// Medição da peça (réguas da vista Lateral): faces, extensão do material e passo da régua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileFaces, materialExtent, niceStep } from '../../shared/measure.js';
import { runProgram } from '../helpers/run.js';

const PROG = `; Bruto: D50 x 80 mm, face em Z1
G18 G90 G95 DIAMON
T1 D1
G97 S1000 M3
G0 X52 Z0
G1 X-1 F0.2
G0 X40 Z2
G1 Z-20 F0.2
G1 X46
G1 Z-35
G1 X52
G0 X150 Z100
M30`;

test('faces do perfil caem nas cotas programadas', () => {
  const { stock } = runProgram(PROG);
  const faces = profileFaces(stock);
  for (const z of [0, -20, -35]) assert.ok(faces.some((f) => Math.abs(f - z) < 1e-9), `face em Z${z}: ${faces}`);
  const [z0, z1] = materialExtent(stock);
  assert.ok(Math.abs(z1) < 0.05, `material termina na face Z0 (${z1})`);
  assert.ok(Math.abs(z0 + 79) < 1e-6, `começa na placa (${z0})`);
  assert.equal(stock.diameterAt(-10), 40);
  assert.equal(stock.diameterAt(-30), 46);
});

test('passo da régua: menor valor redondo com espaço suficiente', () => {
  assert.equal(niceStep(10, 60), 10); // 10 px/mm -> marcas a cada 10 mm (100 px)
  assert.equal(niceStep(13.4, 60), 5);
  assert.equal(niceStep(200, 60), 0.5);
  assert.equal(niceStep(0.01, 60), 500);
});

test('peça sem material não tem extensão', () => {
  assert.equal(materialExtent({ r: [0, 0], ri: [0, 0], N: 2, zAt: (i) => i }), null);
});
