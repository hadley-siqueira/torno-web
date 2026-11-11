// Cada programa de exemplo roda até o fim sem alarme e a peça sai com as cotas do desenho.
// Se um exemplo for alterado, ajuste as cotas aqui junto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { runProgram, readProgram, partDiameterAt, partLength, PROGRAMS_DIR } from '../helpers/run.js';

const TOL = 0.06; // resolução da simulação (~0,035 mm) + folga
const near = (a, b, msg, eps = TOL) => assert.ok(Math.abs(a - b) <= eps, `${msg}: esperado ${b}, obtido ${a.toFixed(3)}`);

const examples = readdirSync(PROGRAMS_DIR).filter((f) => /\.(mpf|nc)$/i.test(f)).sort();

for (const name of examples) {
  test(`${name}: roda até o fim sem alarme`, () => {
    const r = runProgram(readProgram(name));
    assert.equal(r.parsed.alarm, null, 'interpretador');
    assert.deepEqual(r.parsed.warnings, [], 'sem avisos');
    assert.deepEqual(r.alarms, [], 'sem colisão');
    assert.equal(r.result.status, 'end');
  });
}

// Cotas da peça pronta, conferidas no perfil simulado (diâmetros em mm)
const DIMENSIONS = {
  '01_basico.mpf': ({ stock }) => {
    assert.equal(stock.hasMaterialAt(0.5), false, 'faceado em Z0');
    near(stock.diameterAt(-10), 40, 'D40');
    near(stock.diameterAt(-21.5), 43, 'cone de D40 a D46');
    near(stock.diameterAt(-30), 44, 'D44');
    near(stock.diameterAt(-45), 50, 'bruto');
  },
  '02_eixo_sinumerik.mpf': ({ parts }) => {
    assert.equal(parts.length, 1, 'uma peça separada');
    const p = parts[0];
    near(partLength(p), 55, 'comprimento', 0.15);
    near(partDiameterAt(p, -10).d, 30, 'D30');
    near(partDiameterAt(p, -16.5).d, 26, 'canal D26');
    near(partDiameterAt(p, -0.5).d, 29, 'chanfro 1x45');
    near(partDiameterAt(p, -45).d, 44, 'D44');
  },
  '03_bola_fanuc.nc': ({ stock }) => {
    near(stock.diameterAt(-5), 2 * Math.sqrt(100 - 25), 'esfera R10 em Z-5', 0.1);
    near(stock.diameterAt(-20), 20, 'D20');
    near(stock.diameterAt(-40), 30, 'D30');
  },
  '04_pino_roscado.mpf': ({ parts }) => {
    const p = parts[0];
    near(partLength(p), 60, 'comprimento', 0.15);
    near(partDiameterAt(p, -12).d, 18.16, 'núcleo da rosca M20x1,5');
    near(partDiameterAt(p, -26.5).d, 17, 'canal de saída');
    near(partDiameterAt(p, -35).d, 28, 'D28');
    near(partDiameterAt(p, -45).d, 31, 'meio do cone D28/D34');
    near(partDiameterAt(p, -55).d, 34, 'D34');
  },
  '05_bucha.mpf': ({ parts }) => {
    const p = parts[0];
    near(partLength(p), 40, 'comprimento', 0.15);
    near(partDiameterAt(p, -20).d, 46, 'D46');
    near(partDiameterAt(p, -20).bore, 24, 'furo D24');
    near(partDiameterAt(p, -6).bore, 30, 'rebaixo D30');
    near(partDiameterAt(p, -39).bore, 24, 'furo passante');
  },
  '06_peca_completa.mpf': ({ parts, toolChanges }) => {
    assert.deepEqual([...new Set(toolChanges)].sort(), [2, 3, 4, 5, 6, 7, 8], 'usa todas as ferramentas (T1 já começa montada)');
    const p = parts[0];
    near(partLength(p), 55, 'comprimento', 0.15);
    near(partDiameterAt(p, -10).d, 27.55, 'núcleo da rosca M30x2');
    near(partDiameterAt(p, -23).d, 26.5, 'canal de saída');
    near(partDiameterAt(p, -30).d, 40, 'D40');
    near(partDiameterAt(p, -40).d, 43, 'meio do cone D40/D46');
    near(partDiameterAt(p, -50).d, 46, 'D46');
    near(partDiameterAt(p, -10).bore, 20, 'rosca interna M20x1,5 (maior)');
    near(partDiameterAt(p, -20).bore, 18.4, 'furo da rosca após o fim do filete');
    near(partDiameterAt(p, -25).bore, 16, 'furo da broca');
    assert.equal(partDiameterAt(p, -50).bore, 0, 'maciço no fim');
  },
};

for (const [name, check] of Object.entries(DIMENSIONS)) {
  test(`${name}: cotas da peça pronta`, () => check(runProgram(readProgram(name))));
}

test('todo exemplo tem cotas conferidas', () => {
  assert.deepEqual(examples.filter((e) => !DIMENSIONS[e]), []);
});
