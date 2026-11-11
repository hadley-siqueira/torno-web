// Remoção de material e detecção de colisão no modelo da peça (sem 3D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StockModel } from '../../shared/stock-model.js';
import { buildTurret } from '../../shared/tools.js';

const T = buildTurret(); // montagem padrão
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b}, obtido ${a}`);
const stock = () => new StockModel({ diameter: 50, length: 80, faceZ: 1 });

// Passa a ferramenta por uma linha reta em passos pequenos (como o Simulator faz)
function sweep(s, tool, [z0, x0], [z1, x1]) {
  const n = Math.max(1, Math.ceil(Math.hypot(z1 - z0, x1 - x0) / (s.h * 0.7)));
  let last;
  for (let i = 1; i <= n; i++) {
    last = s.carve(tool, z0 + ((z1 - z0) * i) / n, x0 + ((x1 - x0) * i) / n);
    if (last.collision || last.offCenter) return last;
  }
  return last;
}

test('torneamento externo reduz o diâmetro só onde a ferramenta passou', () => {
  const s = stock();
  sweep(s, T[1], [3, 20], [-30, 20]); // passe em Ø40 até Z-30
  near(s.diameterAt(-10), 40, 0.01);
  near(s.diameterAt(-29.9), 40, 0.01);
  near(s.diameterAt(-40), 50, 0.01, 'à esquerda do passe');
  assert.equal(s.cut[s.index(-10)] & 1, 1, 'marcado como usinado');
});

test('ferramenta acima do bruto não remove nada', () => {
  const s = stock();
  const r = sweep(s, T[1], [3, 26], [-30, 26]);
  assert.equal(r.removed, 0);
  near(s.diameterAt(-10), 50, 1e-6);
});

test('faceamento até o centro remove a face sem "peça solta"', () => {
  const s = stock();
  const r = sweep(s, T[1], [0, 27], [0, -0.8]);
  assert.equal(r.parted, -1, 'o pino minúsculo vira cavaco');
  assert.equal(s.hasMaterialAt(0.5), false);
  assert.equal(s.hasMaterialAt(-0.5), true);
});

test('corte com bedame separa a peça e devolve o perfil dela', () => {
  const s = stock();
  sweep(s, T[1], [3, 20], [-50, 20]);
  let parted = -1;
  const n = 400;
  for (let i = 1; i <= n && parted < 0; i++) parted = s.carve(T[3], -43, 26 - (27 * i) / n).parted;
  assert.ok(parted >= 0, 'peça separada');
  const part = s.separate(parted);
  near(Math.min(...part.z), -40, 0.1, 'comprimento da peça');
  near(Math.max(...part.r), 20, 0.01, 'diâmetro da peça');
  assert.equal(s.hasMaterialAt(-20), false, 'peça removida da placa');
  assert.equal(s.hasMaterialAt(-60), true, 'toco continua preso');
});

test('broca em X0 abre furo do diâmetro da broca com ponta cônica', () => {
  const s = stock();
  sweep(s, T[6], [5, 0], [-30, 0]); // broca Ø16
  near(s.boreAt(-10), 16, 0.01);
  assert.ok(s.boreAt(-28) < 16 && s.boreAt(-28) > 0, 'cone da ponta');
  near(s.boreAt(-31), 0, 1e-6, 'abaixo da ponta é maciço');
});

test('broca fora do centro só dá alarme se encostar no material', () => {
  const s = stock();
  assert.equal(sweep(s, T[6], [10, 5], [3, 5]).offCenter, false, 'no ar');
  assert.equal(sweep(s, T[6], [3, 5], [-5, 5]).offCenter, true, 'na peça');
});

test('barra de mandrilar: aumenta o furo; sem furo é colisão do corpo', () => {
  const s = stock();
  assert.equal(sweep(s, T[7], [2, 10], [-10, 10]).collision, true, 'maciço');
  const s2 = stock();
  sweep(s2, T[6], [5, 0], [-40, 0]);
  const r = sweep(s2, T[7], [2, 10], [-20, 10]);
  assert.equal(r.collision, false);
  near(s2.boreAt(-10), 20, 0.05, 'resolução da simulação ~0,035 mm');
  near(s2.boreAt(-30), 16, 0.01, 'além do passe continua Ø16');
});

test('aresta frontal da pastilha interna pode cortar ressalto fino', () => {
  const s = stock();
  sweep(s, T[6], [5, 0], [-40, 0]); // Ø16
  sweep(s, T[7], [2, 11.75], [-30, 11.75]); // Ø23,5
  sweep(s, T[7], [2, 14.75], [-11.9, 14.75]); // rebaixo Ø29,5
  const r = sweep(s, T[7], [-11.9, 15], [-12, 15]); // avança 0,1 mm no fundo
  assert.equal(r.collision, false);
});

test('reset restaura o bruto', () => {
  const s = stock();
  sweep(s, T[1], [3, 20], [-30, 20]);
  s.reset();
  near(s.diameterAt(-10), 50, 1e-6);
  near(s.boreAt(-10), 0, 1e-6);
});
