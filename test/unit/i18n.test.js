// Toda mensagem que o sistema pode mostrar tem tradução em PT e EN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, t, formatMessage, apiErrorText } from '../../shared/i18n.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const allIn = (dir) => readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js') || f.endsWith('.html')).map((f) => read(path.join(dir, f))).join('\n');

test('PT e EN têm as mesmas chaves e os mesmos parâmetros', () => {
  const pt = MESSAGES.pt;
  const en = MESSAGES.en;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(pt).sort());
  const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(pt)) assert.deepEqual(params(en[k]), params(pt[k]), `parâmetros de ${k}`);
});

test('códigos emitidos pelo interpretador e pelo simulador têm texto', () => {
  const src = read('shared/gcode.js') + read('shared/simulator.js');
  const codes = new Set([...src.matchAll(/'([EWIA]_[A-Z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size > 20);
  for (const c of codes) assert.ok(MESSAGES.pt[c], `falta tradução de ${c}`);
});

test('códigos de erro da API têm texto (err_<código>)', () => {
  const src = allIn('server') + allIn('server/routes');
  const codes = new Set([...src.matchAll(/error: '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size > 10);
  for (const c of codes) assert.ok(MESSAGES.pt[`err_${c}`], `falta err_${c}`);
});

test('chaves usadas na interface existem', () => {
  const html = allIn('public');
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-title|-placeholder)?="([\w]+)"/g)].map((m) => m[1]),
    ...[...allIn('public/js').matchAll(/\btr\('([\w]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(keys.size > 30);
  for (const k of keys) assert.ok(MESSAGES.pt[k], `falta a chave ${k}`);
});

test('formatação', () => {
  assert.equal(t('pt', 'S_LINE', { n: 3, msg: 'x' }), 'Linha 3: x');
  assert.equal(t('xx', 'S_LINE', { n: 3, msg: 'x' }), 'Linha 3: x', 'idioma desconhecido cai no PT');
  assert.equal(t('en', 'nao_existe'), 'nao_existe');
  assert.equal(formatMessage('en', { code: 'I_TOOLCHANGE', params: { t: 6, type: 'drill_16' } }), 'T6: Twist drill Ø16');
  assert.equal(apiErrorText('pt', 'username_exists'), 'Esse nome de usuário já existe');
  assert.equal(apiErrorText('en', 'xyz'), 'Error: xyz');
});
