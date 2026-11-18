// Ciclos do 802D sl: CYCLE95 (contorno), CYCLE93 (canal) e CYCLE97 (rosca), rótulos e GOTOF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../helpers/run.js';
import { parseProgram } from '../../shared/gcode.js';
import { parseContour, parseCallArgs, METRIC_COARSE } from '../../shared/cycles.js';
import { StockModel } from '../../shared/stock-model.js';
import { TOOL_TYPES } from '../../shared/tools.js';

const near = (a, b, msg, eps = 0.06) => assert.ok(Math.abs(a - b) <= eps, `${msg}: esperado ${b}, obtido ${a.toFixed(3)}`);
const HEAD = 'G18 G90 G95 DIAMON\nT1 D1\nG96 S180 LIMS=2500 M4\nG0 X54 Z3\n';
// contorno simples: Ø20 até Z-10, Ø30 até Z-20, cone até Ø40 em Z-30, sobe a Ø52
const CONT = 'C1:\nG1 X20 Z2\nZ-10\nX30\nZ-20\nX40 Z-30\nX52\nC2:\n';
const run = (body, opts) => runProgram(HEAD + body + '\nG0 X150 Z100\nM30\n' + CONT, opts);

test('argumentos de ciclo: posições vazias, textos e números', () => {
  assert.deepEqual(parseCallArgs('"A:B", 2, , 0.5,', 'CYCLE95'), ['A:B', 2, undefined, 0.5, undefined]);
  assert.equal(parseProgram('S100 M3\nCYCLE95("C1:C2", x)\nM30\nC1:\nG1 X10 Z0\nZ-5\nC2:').alarm.code, 'E_CYCLE_ARG');
});

test('contorno: CHR, CHF, RND, ANG e arco', () => {
  const pts = (txt) => parseContour(txt.split('\n'), 0, 99).pts;
  // chanfro 1 mm no canto (Z-10, R10) → (Z-9, R10) e (Z-10, R11)
  const c = pts('G1 X20 Z0\nZ-10 CHR=1\nX30');
  assert.ok(c.some(([z, r]) => Math.abs(z + 9) < 1e-9 && Math.abs(r - 10) < 1e-9));
  assert.ok(c.some(([z, r]) => Math.abs(z + 10) < 1e-9 && Math.abs(r - 11) < 1e-9));
  const f = pts('G1 X20 Z0\nZ-10 CHF=1.41421356\nX30');
  assert.ok(f.some(([z, r]) => Math.abs(z + 9) < 1e-6 && Math.abs(r - 10) < 1e-6), 'CHF = hipotenusa');
  const rnd = pts('G1 X20 Z0\nZ-10 RND=2\nX30');
  const mid = rnd.find(([z]) => z < -8 && z > -10);
  assert.ok(Math.abs(Math.hypot(mid[0] + 8, mid[1] - 12) - 2) < 1e-6, 'arredondamento tangente com centro em (Z-8, R12)');
  const ang = pts('G1 X20 Z0\nZ-10 ANG=135\nX52');
  near(ang.at(-2)[1], 20, 'ANG=135 sobe 10 mm de raio em 10 mm de Z');
  assert.throws(() => pts('G1 X20 Z0\nZ-10'), /E_CONTOUR_EMPTY/, 'menos de 3 blocos');
  assert.throws(() => pts('G1 X20 Z0\nZ-10 CHR=20\nX30'), /E_CORNER_TOO_BIG/);
  assert.throws(() => pts('G1 X20\nZ-10'), /E_CONTOUR_START/);
});

test('CYCLE95 completo (VARI 9) com rótulos: peça com as cotas do contorno', () => {
  const r = run('CYCLE95("C1:C2", 2, 0.1, 0.2, , 0.25, 0.15, 0.1, 9, , , 1)');
  assert.equal(r.parsed.alarm, null);
  assert.deepEqual(r.parsed.warnings, []);
  assert.deepEqual(r.alarms, []);
  near(r.stock.diameterAt(-5), 20, 'D20');
  near(r.stock.diameterAt(-15), 30, 'D30');
  near(r.stock.diameterAt(-25), 35, 'meio do cone');
  near(r.stock.diameterAt(-40), 50, 'bruto fora do contorno');
});

test('CYCLE95 só desbaste (VARI 1) deixa o sobremetal; acabamento (VARI 5) tira', () => {
  const r = run('CYCLE95("C1:C2", 2, 0.1, 0.2, , 0.25, 0.15, 0.1, 1, , , 1)');
  assert.deepEqual(r.alarms, []);
  // FALX e MID em diâmetro (DIAMON), como o resto do X
  near(r.stock.diameterAt(-5), 20.2, 'D20 + FALX');
  near(r.stock.diameterAt(-15), 30.2, 'D30 + FALX');
  const f = run('CYCLE95("C1:C2", 2, 0.1, 0.2, , 0.25, 0.15, 0.1, 1, , , 1)\nCYCLE95("C1:C2", , , , , , , 0.1, 5, , , 1)');
  near(f.stock.diameterAt(-5), 20, 'acabado');
  // passes: profundidade total 15 mm no raio com MID 2 (Ø) = 1 mm no raio → 15 passes
  const feeds = r.parsed.events.filter((e) => e.type === 'feed').length;
  assert.ok(feeds >= 15, `passes de desbaste: ${feeds}`);
});

test('CYCLE95 com rebaixo (contorno que desce e sobe de novo)', () => {
  const cont = 'R1:\nG1 X30 Z0\nZ-10\nX20 Z-15\nZ-20\nX30 Z-25\nZ-35\nX52\nR2:\n';
  // pastilha 35° (T3): a aresta de trás sobe a 52°, então desce no flanco de 45° sem raspar o colar
  // (com a 80° de desbaste o fundo da pastilha come o colar, como na máquina)
  const head = HEAD.replace('T1 D1', 'T3 D1');
  const r = runProgram(head + 'CYCLE95("R1:R2", 2, 0, 0, , 0.25, 0.15, 0.1, 9, , , 1)\nG0 X150 Z100\nM30\n' + cont);
  assert.deepEqual(r.alarms, []);
  near(r.stock.diameterAt(-5), 30, 'antes do rebaixo');
  near(r.stock.diameterAt(-17.5), 20, 'fundo do rebaixo');
  near(r.stock.diameterAt(-12.5), 25, 'flanco do rebaixo');
  near(r.stock.diameterAt(-30), 30, 'depois do rebaixo');
});

test('CYCLE95 de faceamento (VARI 10) e interno (VARI 11)', () => {
  // faceamento: degrau na face, Z0 até Ø30 e Z-3 de Ø30 para fora
  const face = 'F1:\nG1 X52 Z-3\nX30\nZ0\nX0\nF2:\n';
  const r = runProgram(HEAD + 'CYCLE95("F1:F2", 1, 0, 0, , 0.2, 0.15, 0.1, 10, , , 1)\nG0 X150 Z100\nM30\n' + face);
  assert.deepEqual(r.alarms, []);
  assert.ok(r.stock.hasMaterialAt(-0.5) && !r.stock.hasMaterialAt(0.5), 'face em Z0');
  near(r.stock.diameterAt(-1.5), 30, 'ressalto Ø30 até Z-3');
  near(r.stock.diameterAt(-4), 50, 'Ø50 depois de Z-3');
  // interno: tubo Ø20, furo de Ø30 até Z-15 e Ø24 até Z-30 (barra de desbaste interno T4)
  const cont = 'I1:\nG1 X30 Z0\nZ-15\nX24\nZ-30\nX18\nI2:\n';
  const code = 'G18 G90 G95 DIAMON\nT4 D1\nG96 S150 LIMS=2000 M3\nG0 X16 Z3\n'
    + 'CYCLE95("I1:I2", 1, 0, 0, , 0.2, 0.15, 0.1, 11, , , 0.5)\nG0 Z50\nG0 X150 Z100\nM30\n' + cont;
  const ri = runProgram(code, { stock: { diameter: 50, length: 80, faceZ: 0, bore: 20 } });
  assert.deepEqual(ri.alarms, []);
  near(ri.stock.boreAt(-5), 30, 'furo Ø30');
  near(ri.stock.boreAt(-20), 24, 'furo Ø24');
  near(ri.stock.boreAt(-40), 20, 'tubo original');
});

test('CYCLE95: contorno em outro programa, rótulo inexistente e VARI inválido', () => {
  const sub = 'G1 X20 Z0\nZ-10\nX52\nM17';
  const code = HEAD + 'CYCLE95("CONT1", 2, 0, 0, , 0.25, 0.15, 0.1, 9, , , 1)\nM30';
  assert.equal(parseProgram(code).alarm.code, 'E_CONTOUR_NOT_FOUND');
  assert.equal(parseProgram(code, { subprograms: { CONT1: sub } }).alarm, null);
  assert.equal(parseProgram(HEAD + 'CYCLE95("A:B", 2, 0, 0, , 0.25, 0.15, 0.1, 9)\nM30').alarm.code, 'E_LABEL_NOT_FOUND');
  assert.equal(parseProgram(HEAD + 'CYCLE95("C1:C2", 2, 0, 0, , 0.25, 0.15, 0.1, 13)\nM30\n' + CONT).alarm.code, 'E_CYCLE_VARI');
  assert.equal(parseProgram(HEAD + 'CYCLE95("C1:C2", , 0, 0, , 0.25, 0.15, 0.1, 1)\nM30\n' + CONT).alarm.code, 'E_CYCLE_PARAM');
  assert.equal(parseProgram('T1\nCYCLE95("C1:C2", 2, 0, 0, , 0.25, 0.15, 0.1, 9)\nM30\n' + CONT).alarm.code, 'E_SPINDLE_STOPPED');
});

test('CYCLE93: canal com largura maior que a ferramenta, flancos inclinados e cantos', () => {
  const G = 'G18 G90 G95 DIAMON\nT5 D1\nG97 S800 M4\nG0 X54 Z-5\nF0.08\n';
  // canal externo de 8 mm a partir de Z-10 para a esquerda (VARI 5), 4 de profundidade
  const r = runProgram(G + 'CYCLE93(50, -10, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 2, 0.2, 5, 1)\nG0 X150 Z100\nM30');
  assert.equal(r.parsed.alarm, null);
  assert.deepEqual(r.alarms, []);
  near(r.stock.diameterAt(-14), 42, 'fundo Ø42');
  near(r.stock.diameterAt(-10.3), 42, 'perto do lado direito');
  near(r.stock.diameterAt(-17.7), 42, 'perto do lado esquerdo');
  near(r.stock.diameterAt(-9.7), 50, 'fora do canal (direita)');
  near(r.stock.diameterAt(-18.3), 50, 'fora do canal (esquerda)');
  // flancos a 30° e chanfros de 1 mm em cima (RCO negativos)
  const a = runProgram(G + 'CYCLE93(50, -10, 6, 4, 0, 30, 30, -1, -1, 0, 0, 0, 0, 2, 0, 5, 1)\nG0 X150 Z100\nM30');
  assert.deepEqual(a.alarms, []);
  near(a.stock.diameterAt(-13), 42, 'fundo');
  near(a.stock.diameterAt(-10 - 4 * Math.tan(Math.PI / 6) + 2 * Math.tan(Math.PI / 6)), 46, 'meio do flanco 30°', 0.1);
  // ferramenta mais larga que o canal; canal na face
  assert.equal(parseProgram(G + 'CYCLE93(50, -10, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 5, 1)\nM30').alarm.code, 'E_GROOVE_TOOL_WIDTH');
  assert.equal(parseProgram(G + 'CYCLE93(50, -10, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 1)\nM30').alarm.code, 'E_CYCLE93_FACE');
  assert.equal(parseProgram(G + 'CYCLE93(50, -10, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, , 0, 5, 1)\nM30').alarm.code, 'E_CYCLE_PARAM');
});

test('CYCLE97: passes de rosca, núcleo e hélice; MPIT pela tabela', () => {
  const T = 'G18 G90 G95 DIAMON\nT8 D1\nG97 S600 M4\nG0 X54 Z6\n';
  const r = runProgram(T + 'CYCLE97(2, , 0, -20, 50, 50, 4, 2, 1.23, 0.05, 30, 0, 5, 2, 1, 1, 1)\nG0 X150 Z100\nM30');
  assert.equal(r.parsed.alarm, null);
  assert.deepEqual(r.alarms, []);
  const threads = r.parsed.events.filter((e) => e.type === 'thread');
  assert.equal(threads.length, 5 + 1 + 2, '5 de desbaste + acabamento + 2 em vazio');
  assert.equal(threads[0].thread.lead, 2);
  near(r.stock.diameterAt(-10), 50 - 2 * 1.23, 'núcleo');
  // a superfície varia com o ângulo (filete) entre o núcleo e a crista
  const i = r.stock.index(-10);
  const ds = Array.from({ length: 24 }, (_, k) => 2 * r.stock.threadRadii(i, (k / 24) * Math.PI * 2)[0]);
  near(Math.min(...ds), 47.54, 'fundo do filete');
  near(Math.max(...ds), 50, 'crista do filete');
  assert.equal(METRIC_COARSE[42], 4.5);
  const m = parseProgram(T + 'CYCLE97(, 42, 0, -20, 42, 42, 10, 3, 2.76, , 30, , 5, 2, 3, 1, 1)\nM30');
  assert.equal(m.alarm, null);
  assert.equal(m.events.find((e) => e.type === 'thread').thread.lead, 4.5);
  assert.equal(parseProgram(T + 'CYCLE97(2, , 0, -20, 50, 50, 4, 2, , , 30, 0, 5, 2, 1, 1, 1)\nM30').alarm.code, 'E_CYCLE_PARAM');
  // interna (VARI 2): DM = Ø do furo; M20x1,5 em furo Ø18,38 com TDEP 0,81 → Ø20
  const I = 'G18 G90 G95 DIAMON\nT16 D1\nG97 S500 M3\nG0 X16 Z6\n';
  const ri = runProgram(I + 'CYCLE97(1.5, , 0, -15, 18.38, 18.38, 4, 1, 0.81, 0.05, 30, 0, 5, 1, 2, 1, 0.5)\nG0 Z50\nG0 X150 Z100\nM30',
    { stock: { diameter: 40, length: 80, faceZ: 0, bore: 18.38 } });
  assert.deepEqual(ri.alarms, []);
  near(ri.stock.boreAt(-8), 20, 'Ø maior da rosca interna');
  near(ri.stock.boreAt(-25), 18.38, 'furo depois da rosca');
  assert.equal(ri.stock.threads[0].kind, 'int');
});

test('rosca por G33: a peça guarda a hélice; a peça separada leva junto', () => {
  const T = 'G18 G90 G95 DIAMON\nT8 D1\nG97 S600 M4\nG0 X54 Z5\n';
  let body = '';
  for (const x of [49.4, 48.8, 48.2, 47.6]) body += `G0 X${x}\nG33 Z-20 K2\nG0 X54\nZ5\n`;
  const r = runProgram(T + body + 'M30');
  assert.deepEqual(r.alarms, []);
  assert.equal(r.stock.threads.length, 1, 'os passes juntam na mesma rosca');
  const parted = { z: [], r: [], ri: [], threads: r.stock.exportThreads() };
  for (let i = 0; i < r.stock.N; i++) {
    parted.z.push(r.stock.zAt(i));
    parted.r.push(r.stock.r[i]);
    parted.ri.push(r.stock.ri[i]);
  }
  const s = new StockModel({ diameter: 50, length: 80, faceZ: 1 });
  s.r.set(r.stock.r);
  s.importThreads(parted.threads);
  const i = s.index(-10);
  const ds = [0, 1, 2, 3].map((k) => s.threadRadii(i, k * 0.7)[0]);
  assert.ok(Math.max(...ds) - Math.min(...ds) > 0.3, 'superfície com filete depois de importar');
  assert.ok(TOOL_TYPES.thread_ext_60);
});

test('GOTOF pula o contorno no meio do programa; GOTOB em laço vira alarme', () => {
  const code = HEAD + 'GOTOF PULA\nC1:\nG1 X20 Z0\nZ-10\nX52\nC2:\nPULA:\nCYCLE95("C1:C2", 2, 0, 0, , 0.25, 0.15, 0.1, 9, , , 1)\nG0 X150 Z100\nM30';
  const r = runProgram(code);
  assert.equal(r.parsed.alarm, null);
  assert.deepEqual(r.alarms, []);
  near(r.stock.diameterAt(-5), 20, 'D20');
  assert.equal(parseProgram('LACO:\nG0 X10\nGOTOB LACO\nM30', { maxJumps: 50 }).alarm.code, 'E_TOO_LONG');
  assert.equal(parseProgram('GOTOF NADA\nM30').alarm.code, 'E_LABEL_NOT_FOUND');
});
