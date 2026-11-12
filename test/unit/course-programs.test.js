// Programas no estilo do curso: o cabeçalho com WORKPIECE do SinuTrain (vídeo de aluno) e
// os exercícios de passes manuais da apostila do professor (torre da apostila, bedame D1/D2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram, parseWorkpiece, stockFromProgram } from '../../shared/gcode.js';
import { buildTurret, TURRET_PRESETS, withEdge } from '../../shared/tools.js';
import { runProgram, partLength, partDiameterAt } from '../helpers/run.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b}, obtido ${a}`);
const APOSTILA = buildTurret(TURRET_PRESETS.apostila);
const codes = (r) => r.warnings.map((w) => w.code);

// Início do programa de um aluno gravado no SinuTrain (840D sl / Operate)
const ALUNO = `N10 WORKPIECE(,,,"CYLINDER",0,2,120,100,82.55)
N20 G18 G54 G71 G90 G96
N30 G0 X200 Z200
N40 T1 D1
N50 S200 M4
N60 X84.55 Z1
N70 G1 X-1 F0.02
N90 G0 Z2
N100 X84.55
N110 Z0
N120 G1 X-1 F0.2
N130 Z2
N140 G0 X80
N150 G1 Z-85
N160 X82
N170 G0 Z2
N900 G0 X200 Z200
N910 M2`;

test('WORKPIECE: cilindro, tubo, posições absolutas e inválidos', () => {
  assert.deepEqual(parseWorkpiece('N10 WORKPIECE(,,,"CYLINDER",0,2,120,100,82.55)'), {
    diameter: 82.55, length: 100, faceZ: 2, clamp: 20, total: 120,
  });
  assert.deepEqual(parseWorkpiece('WORKPIECE(,"",,"PIPE",0,1,90,60,50,20)'), {
    diameter: 50, length: 60, faceZ: 1, clamp: 30, total: 90, bore: 20,
  });
  // ZI e ZB negativos = posições em Z
  assert.deepEqual(parseWorkpiece('WORKPIECE(,"",,"CYLINDER",192,0,-100,-80,50)'), {
    diameter: 50, length: 80, faceZ: 0, clamp: 20, total: 100,
  });
  assert.equal(parseWorkpiece('WORKPIECE(,,,"BOX",0,0,10,10,10)'), null);
  assert.equal(parseWorkpiece('WORKPIECE(,,,"CYLINDER",0,2)'), null);
  // o WORKPIECE tem prioridade sobre o comentário "; Bruto:"
  assert.equal(stockFromProgram(`; Bruto: D50 x 80\n${ALUNO}`).diameter, 82.55);
  assert.equal(stockFromProgram('; Bruto: D50 x 80').source, 'header');
});

test('programa real do aluno roda: WORKPIECE define a peça e avança-se com aviso de F baixo', () => {
  const p = parseProgram(ALUNO, { turret: APOSTILA });
  assert.equal(p.alarm, null);
  assert.equal(p.workpiece.diameter, 82.55);
  // F0.02 no desbaste: aviso uma vez só (o bloco seguinte repete o F)
  assert.deepEqual(codes(p), ['W_FEED_LOW']);
  assert.deepEqual(p.warnings[0].params, { f: 0.02, min: 0.1, max: 0.6, t: 1, type: 'ext_rough_80' });
  const { result, stock } = runProgram(ALUNO, { turret: APOSTILA });
  assert.equal(result.status, 'end');
  near(stock.R0 * 2, 82.55, 1e-9, 'bruto do WORKPIECE');
  near(stock.length, 100, 1e-9, 'comprimento em balanço');
  assert.equal(stock.clamp, 20);
  near(stock.diameterAt(-50), 80, 1e-3, 'passe em X80');
  assert.equal(stock.hasMaterialAt(0.5), false, 'faceado em Z0');
});

test('chanfro/arredondamento/ângulo ignorados geram aviso (não somem calados)', () => {
  const p = parseProgram('G18 G90 G95\nT1 D1\nG97 S800 M4\nG0 X20 Z2\nG1 Z0 F0.2\nX15 CHR=1.0\nZ-20 RND=1\nZ-28.6 ANG=200\nM2');
  assert.deepEqual(codes(p), ['W_CONTOUR_IGNORED', 'W_CONTOUR_IGNORED', 'W_CONTOUR_IGNORED']);
  assert.deepEqual(p.warnings.map((w) => w.params.k), ['CHR', 'RND', 'ANG']);
});

test('avisos didáticos: avanço alto e broca fora do centro', () => {
  const p = parseProgram('G18 G90 G95\nT1 D1\nG97 S800 M4\nG0 X40 Z2\nG1 Z-10 F0.8\nM2');
  assert.deepEqual(codes(p), ['W_FEED_HIGH']);
  // avanço em mm/min (G94) não é comparado
  assert.deepEqual(codes(parseProgram('G18 G90 G94\nT1 D1\nG97 S800 M4\nG0 X40 Z2\nG1 Z-10 F100\nM2')), []);
  // broca (T6 na torre padrão) em avanço fora de X0
  const d = parseProgram('G18 G90 G95\nT6 D1\nG97 S800 M3\nG0 X0 Z2\nG1 Z-10 F0.1\nG0 Z2\nG0 X80\nG1 Z-20\nM2');
  assert.deepEqual(codes(d), ['W_AXIAL_OFF_CENTER']);
  assert.equal(d.warnings[0].line, 7);
});

test('corretor D: D2 do bedame usa o canto direito; D inválido é alarme', () => {
  const t2 = APOSTILA[2];
  assert.equal(withEdge(t2, 1), t2);
  assert.deepEqual(withEdge(t2, 2).insert[0], [-3, 0]);
  assert.equal(withEdge(APOSTILA[1], 2), APOSTILA[1], 'ferramenta sem segundo corte ignora D2');
  assert.equal(parseProgram('T2 D12\nM2', { turret: APOSTILA }).alarm.code, 'E_D_INVALID');
});

// Exercício 1 da apostila: facear, passe em Ø48 até Z-130 e cortar com o bedame (T2)
const EX1 = (corte) => `; Bruto: D50.8 x 150 mm, face em Z1
N10 G54 G71 G90 G96
N20 G0 X200 Z200
N30 T1 D1
N40 S200 M4
N50 G0 X52 Z0
N60 G1 X0 F0.2
N70 G0 Z2
N80 X48
N90 G1 Z-130
N100 X52
N110 G0 X200 Z200
N120 ${corte}
N150 G1 X0 F0.05
N160 G0 X200 Z200
N170 M2`;

test('exercício 1 da apostila: corte com o bedame pelo canto esquerdo (D1) ou direito (D2)', () => {
  for (const corte of ['T2 D1\nN140 G0 X52 Z-133', 'T2 D2\nN140 G0 X52 Z-130']) {
    const { result, parts } = runProgram(EX1(corte), { turret: APOSTILA });
    assert.equal(result.status, 'end', corte);
    assert.equal(parts.length, 1, corte);
    near(partLength(parts[0]), 130, 0.15, `${corte}: comprimento`);
    near(partDiameterAt(parts[0], -60).d, 48, 1e-3, `${corte}: Ø48`);
  }
  // com a torre padrão do TornoWeb (T2 = acabamento) o mesmo programa colide
  const { result } = runProgram(EX1('T2 D1\nN140 G0 X52 Z-133'));
  assert.equal(result.status, 'alarm');
});
