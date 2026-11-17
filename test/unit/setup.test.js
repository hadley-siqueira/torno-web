// Configuração do programa (peça bruta, material, torre) salva com o programa e lida dos exemplos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { sanitizeSetup, setupFromExample, sameSetup, turretPresetName } from '../../shared/setup.js';
import { TURRET_PRESETS, TURRET_DEFAULT } from '../../shared/tools.js';
import { readProgram, PROGRAMS_DIR } from '../helpers/run.js';

test('exemplo: bruto, material e montagem do cabeçalho', () => {
  const s = setupFromExample('; Bruto: D40 x 60 mm, face em Z1\n; Material: brass\n; Torre: apostila\nM30', { diameter: 50, length: 80, faceZ: 0, clamp: 30 });
  assert.deepEqual(s.stock, { diameter: 40, length: 60, faceZ: 1, clamp: 30 });
  assert.equal(s.material, 'brass');
  assert.equal(turretPresetName(s.turret), 'apostila');
  // sem cabeçalho: bruto atual, aço e o magazine do SinuTrain
  const d = setupFromExample('G0 X10\nM30', { diameter: 50, length: 80, faceZ: 0, clamp: 30 });
  assert.equal(d.stock.diameter, 50);
  assert.equal(d.material, 'steel');
  assert.deepEqual(d.turret, TURRET_DEFAULT);
  // WORKPIECE do SinuTrain
  const w = setupFromExample('WORKPIECE(,,,"CYLINDER",0,2,120,100,82.55)\nM30');
  assert.deepEqual(w.stock, { diameter: 82.55, length: 100, faceZ: 2, clamp: 20 });
});

test('todo exemplo traz configuração válida (bruto e torre)', () => {
  for (const name of readdirSync(PROGRAMS_DIR).filter((f) => /\.(mpf|nc)$/i.test(f))) {
    const s = sanitizeSetup(setupFromExample(readProgram(name), { diameter: 50, length: 80, faceZ: 1, clamp: 25 }));
    assert.ok(s.stock && s.turret && s.material, name);
  }
});

test('validação e comparação', () => {
  assert.equal(sanitizeSetup(null), null);
  assert.equal(sanitizeSetup({ material: 'ouro', stock: { diameter: 1 } }), null);
  const s = sanitizeSetup({ material: 'copper', stock: { diameter: 30, length: 50, faceZ: 1, bore: 40 }, turret: { 1: 'drill_10' } });
  assert.equal(s.stock.bore, undefined, 'tubo maior que o bruto é ignorado');
  assert.equal(s.turret[2], '');
  assert.ok(sameSetup({ material: 'copper', turret: TURRET_PRESETS.sinutrain }, { turret: { ...TURRET_DEFAULT }, material: 'copper' }));
  assert.ok(!sameSetup({ material: 'copper' }, { material: 'brass' }));
  assert.equal(turretPresetName({ ...TURRET_DEFAULT, 3: '' }), null);
  assert.equal(turretPresetName(TURRET_PRESETS.torre8), 'torre8');
});
