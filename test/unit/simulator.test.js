// Motor da simulação: colisões, paradas, bloco a bloco e rotação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../helpers/run.js';
import { parseProgram } from '../../shared/gcode.js';
import { StockModel } from '../../shared/stock-model.js';
import { Simulator, rpmFor } from '../../shared/simulator.js';
import { buildTurret } from '../../shared/tools.js';

const HEAD = 'G18 G90 G95 DIAMON\n';
const alarmOf = (code) => runProgram(HEAD + code).alarms[0];

test('G0 dentro do material', () => {
  const a = alarmOf('T1 D1\nG97 S1000 M3\nG0 X40 Z2\nG0 Z-20\nM30');
  assert.equal(a.code, 'A_RAPID');
  assert.equal(a.line, 4);
});

test('ferramenta na peça com fuso parado', () => {
  // G94 (mm/min) para o interpretador aceitar o avanço sem rotação
  assert.equal(alarmOf('T1 D1\nG94 F200\nG0 X40 Z2\nG1 Z-20\nM30').code, 'A_SPINDLE');
});

test('colisão com a placa', () => {
  assert.equal(alarmOf('T1 D1\nG97 S500 M3\nG0 X60 Z-85\nG0 X55\nM30').code, 'A_CHUCK');
});

test('barra de mandrilar sem furo e broca fora do centro', () => {
  assert.equal(alarmOf('T7 D1\nG96 S150 LIMS=2000 M3\nG0 X20 Z2\nG1 Z-10 F0.1\nM30').code, 'A_BAR');
  assert.equal(alarmOf('T6 D1\nG97 S600 M3\nG0 X10 Z5\nG1 Z-10 F0.1\nM30').code, 'A_DRILL_CENTER');
});

test('alarme do interpretador chega pelo simulador', () => {
  const r = runProgram(HEAD + 'G0 X40\nG2 X10 Z0 CR=1 F0.1\nM30');
  assert.equal(r.alarms[0].code, 'E_ARC_RADIUS_SMALL');
  assert.equal(r.result.status, 'alarm');
});

test('M0 para e Cycle Start continua; tempo bate com o interpretador', () => {
  const parsed = parseProgram(HEAD + 'T1 D1\nG97 S1000 M3\nG0 X60 Z2\nM0\nG1 X55 F0.2\nM30');
  const sim = new Simulator({ stock: new StockModel({ diameter: 50, length: 80, faceZ: 1 }), turret: buildTurret() });
  sim.load(parsed.events);
  assert.equal(sim.runToEnd().status, 'hold');
  assert.equal(sim.runToEnd().status, 'end');
  assert.ok(Math.abs(sim.elapsed - parsed.stats.totalTime) < 1e-3, 'tempo simulado = tempo estimado (arredondado a 3 casas)');
});

test('bloco a bloco para a cada linha', () => {
  const parsed = parseProgram(HEAD + 'G0 X60 Z2\nG0 X58\nG0 X56\nM30');
  const stops = [];
  const sim = new Simulator({
    stock: new StockModel({ diameter: 50, length: 80, faceZ: 1 }),
    turret: buildTurret(),
    hooks: { singleStop: (l) => stops.push(l) },
  });
  sim.single = true;
  sim.load(parsed.events);
  while (sim.runToEnd().status === 'hold');
  assert.deepEqual(stops, [1, 2, 3, 4]);
});

test('avanço parcial move a ferramenta no meio do bloco', () => {
  const parsed = parseProgram(HEAD + 'G0 X60 Z10\nG94 F600\nG1 Z0\nM30'); // 10 mm a 600 mm/min = 1 s
  const sim = new Simulator({ stock: new StockModel({ diameter: 50, length: 80, faceZ: 1 }), turret: buildTurret() });
  sim.load(parsed.events);
  sim.run();
  while (sim.idx < 3) sim.advance(0.001);
  sim.advance(0.5);
  assert.ok(Math.abs(sim.pos.z - 5) < 0.05, `z=${sim.pos.z}`);
});

test('rpm em G96 respeita LIMS e o limite da máquina', () => {
  const st = { spindle: 3, css: true, Vc: 200, lims: 3000, S: 0 };
  assert.ok(Math.abs(rpmFor(st, 25) - (200 * 1000) / (Math.PI * 50)) < 1e-6);
  assert.equal(rpmFor(st, 0.1), 3000);
  assert.equal(rpmFor({ ...st, lims: 9999 }, 0.1), 4000);
  assert.equal(rpmFor({ spindle: 0 }, 10), 0);
  assert.equal(rpmFor({ spindle: 4, css: false, S: 800 }, 10), 800);
});
