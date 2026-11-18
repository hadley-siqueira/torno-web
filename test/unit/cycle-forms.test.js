import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CYCLE_FORMS, buildCycleCall, parseCycleLine, missingFields, contourSuggestions, threadSuggestion } from '../../shared/cycle-forms.js';
import { CYCLE_NPARAMS, parseCallArgs } from '../../shared/cycles.js';

test('formulários: um campo por parâmetro do 802D sl, com textos PT/EN', () => {
  for (const [c, def] of Object.entries(CYCLE_FORMS)) {
    assert.equal(def.fields.length, CYCLE_NPARAMS[c], c);
    for (const f of def.fields) {
      assert.ok(f.label.pt && f.label.en && f.help.pt && f.help.en, `${c}.${f.key}`);
    }
    assert.deepEqual(missingFields(c, def.defaults), c === 'CYCLE95' ? ['NPP'] : [], `${c}: padrões`);
  }
});

test('linhas de ciclo dos exemplos: ler e montar de novo dá os mesmos parâmetros', () => {
  const dir = new URL('../../programs/', import.meta.url);
  let n = 0;
  for (const file of readdirSync(dir)) {
    for (const line of readFileSync(new URL(file, dir), 'utf8').split('\n')) {
      const p = parseCycleLine(line);
      if (!p) continue;
      n++;
      const inside = (s) => s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
      const orig = parseCallArgs(inside(line.replace(/;.*$/, '')), p.cycle);
      while (orig.length && orig[orig.length - 1] === undefined) orig.pop();
      assert.deepEqual(parseCallArgs(inside(buildCycleCall(p.cycle, p.values)), p.cycle), orig, `${file}: ${line}`);
    }
  }
  assert.ok(n >= 10, `linhas com ciclo: ${n}`);
});

test('número do bloco e comentário ficam fora da chamada', () => {
  const p = parseCycleLine('N280 CYCLE95("INICIO:FIM",1.5,0.09,0.9,0,0.2,0.05,0.1,9,,0,2) ; contorno');
  assert.equal(p.prefix, 'N280 ');
  assert.equal(p.suffix, ' ; contorno');
  assert.equal(p.values.NPP, 'INICIO:FIM');
  assert.equal(p.values.FAL, 0);
  assert.equal(p.values.DT, undefined);
  assert.equal(parseCycleLine('G0 X50'), null);
});

test('obrigatórios dependem do tipo: MID só fora do acabamento; PIT ou MPIT', () => {
  assert.deepEqual(missingFields('CYCLE95', { NPP: 'A:B', VARI: 9 }), ['MID']);
  assert.deepEqual(missingFields('CYCLE95', { NPP: 'A:B', VARI: 5 }), []);
  const r = { SPL: 0, FPL: -20, DM1: 20, TDEP: 1, VARI: 1 };
  assert.deepEqual(missingFields('CYCLE97', r), ['PIT']);
  assert.deepEqual(missingFields('CYCLE97', { ...r, MPIT: 20 }), []);
  assert.equal(buildCycleCall('CYCLE97', { ...r, MPIT: 20 }), 'CYCLE97(, 20, 0, -20, 20, , , , 1, , , , , , 1)');
});

test('sugestões: pares de rótulos e fórmulas da rosca', () => {
  assert.deepEqual(contourSuggestions({ FIM: 20, INICIO: 12 }), ['INICIO:FIM']);
  assert.deepEqual(threadSuggestion(1.5), { TDEP: 0.975, NRC: 10, APP: 4.5, IANG: 30 });
  assert.equal(threadSuggestion(0), null);
});
