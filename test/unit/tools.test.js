import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_TYPES, TURRET_DEFAULT, TURRET_PRESETS, TOOL_SLOTS, buildTurret, sanitizeTurret, lowerBoundary, upperBoundary, insertSpan, getTool,
  withEdge,
} from '../../shared/tools.js';

test('catálogo: nomes PT/EN, tipo válido e geometria coerente', () => {
  for (const [id, t] of Object.entries(TOOL_TYPES)) {
    assert.ok(t.name.pt && t.name.en && t.detail.pt && t.detail.en, `${id}: textos`);
    assert.ok(['external', 'internal', 'axial'].includes(t.kind), `${id}: kind`);
    assert.ok(t.insert.length >= 3, `${id}: polígono`);
    // a ponta programada é o ponto de referência (0,0)
    assert.ok(t.insert.some(([z, x]) => z === 0 && x === 0), `${id}: ponta em (0,0)`);
    if (t.kind === 'external') assert.equal(lowerBoundary(t.insert, insertSpan(t.insert)[0] < 0 ? 0 : 0), 0, `${id}: ponta é o ponto mais baixo`);
    if (t.kind === 'internal') {
      assert.ok(Array.isArray(t.cutZone), `${id}: zona de corte`);
      assert.equal(upperBoundary(t.insert, 0), 0, `${id}: ponta é o ponto mais alto`);
    }
    if (t.kind === 'axial') {
      for (const dz of [5, 20]) assert.ok(Math.abs(upperBoundary(t.insert, dz) + lowerBoundary(t.insert, dz)) < 1e-9, `${id}: broca simétrica`);
    }
  }
});

test('bordas do polígono', () => {
  const sq = [[0, 0], [3, 0], [3, 25], [0, 25]];
  assert.equal(lowerBoundary(sq, 1.5), 0);
  assert.equal(upperBoundary(sq, 1.5), 25);
  assert.equal(lowerBoundary(sq, 4), null);
  assert.deepEqual(insertSpan(sq), [0, 3]);
});

test('torre padrão e configuração', () => {
  assert.equal(Object.keys(TURRET_DEFAULT).length, TOOL_SLOTS);
  const t = buildTurret();
  assert.equal(t[1].type, 'ext_rough_80');
  assert.equal(t[1].id, 1);
  const cfg = sanitizeTurret({ 1: 'drill_10', 2: '', 3: 'inexistente', 9: 'ext_rough_80' });
  assert.equal(cfg[1], 'drill_10');
  assert.equal(cfg[2], '');
  assert.equal(cfg[3], TURRET_DEFAULT[3], 'tipo desconhecido volta ao padrão');
  assert.equal(cfg[9], 'ext_rough_80');
  assert.equal(cfg[10], '', 'posição ausente fica vazia');
  assert.equal(cfg[TOOL_SLOTS + 1], undefined, `só ${TOOL_SLOTS} posições`);
  assert.equal(sanitizeTurret('x'), null);
  const custom = buildTurret(cfg);
  assert.equal(custom[2], undefined, 'posição vazia');
  assert.equal(getTool(2, custom), null);
  assert.equal(getTool(1, custom).kind, 'axial');
});

test('bedame: D1 = canto esquerdo e D2 = canto direito, no SinuTrain e na máquina da escola', () => {
  for (const cfg of [TURRET_DEFAULT, TURRET_PRESETS.apostila]) {
    const b = buildTurret(cfg)[cfg === TURRET_DEFAULT ? 5 : 2];
    assert.equal(b.type, 'groove_3');
    assert.deepEqual(insertSpan(withEdge(b, 1).insert), [0, 3], 'D1: canto esquerdo');
    assert.deepEqual(insertSpan(withEdge(b, 2).insert), [-3, 0], 'D2: canto direito');
  }
  assert.equal(sanitizeTurret({ 2: 'groove_3_lab' })[2], 'groove_3', 'configuração salva em 2026-11-18');
});
