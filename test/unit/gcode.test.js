import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../../shared/gcode.js';

const moves = (r) => r.events.filter((e) => e.pts);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('G0/G1 em diâmetro e tempo de avanço por rotação', () => {
  const r = parseProgram('G95 S1000 M3\nG0 X40 Z0\nG1 Z-10 F0.2\nM30');
  const [rapid, feed] = moves(r);
  assert.equal(rapid.type, 'rapid');
  assert.deepEqual(rapid.pts.at(-1).slice(0, 2), [0, 20]);
  assert.equal(feed.type, 'feed');
  // 10 mm a 0.2 mm/rot * 1000 rpm = 200 mm/min -> 3 s
  assert.ok(near(feed.duration, 3));
  assert.equal(r.alarm, null);
});

test('G2 côncavo com CR passa pelo centro correto', () => {
  const r = parseProgram('S500 M3\nG0 X30 Z-27\nG2 X36 Z-30 CR=3 F0.1\nM30');
  const arc = moves(r)[1];
  for (const [z, x] of arc.pts) assert.ok(near(Math.hypot(z + 27, x - 18), 3, 1e-6));
  const mid = arc.pts[Math.floor(arc.pts.length / 2)];
  assert.ok(mid[0] < -27 && mid[1] < 18, 'arco deve ficar abaixo/à esquerda do centro');
});

test('G3 convexo (Fanuc R) e equivalência com I/K', () => {
  const a = moves(parseProgram('S500 M3\nG0 X0 Z0\nG3 X20 Z-10 R10 F0.1\nM30'))[1];
  const b = moves(parseProgram('S500 M3\nG0 X0 Z0\nG3 X20 Z-10 I0 K-10 F0.1\nM30'))[1];
  const ma = a.pts[Math.floor(a.pts.length / 2)];
  assert.ok(ma[0] > -10 && ma[1] > 0);
  assert.equal(a.pts.length, b.pts.length);
  a.pts.forEach((p, i) => assert.ok(near(p[0], b.pts[i][0]) && near(p[1], b.pts[i][1])));
});

test('G96 limita rpm por LIMS', () => {
  const r = parseProgram('G96 S200 LIMS=2000 M3\nG0 X40 Z0\nG1 X0 F0.1\nM30');
  assert.equal(r.stats.maxRpm, 2000);
});

test('alarmes: F ausente, fuso parado, ferramenta inexistente, arco inválido', () => {
  assert.equal(parseProgram('S100 M3\nG1 X10').alarm.code, 'E_NO_FEED');
  assert.equal(parseProgram('G95 F0.1\nG1 X10').alarm.code, 'E_SPINDLE_STOPPED');
  assert.deepEqual(parseProgram('T9').alarm, { line: 0, code: 'E_TOOL_MISSING', params: { t: 9 } });
  assert.equal(parseProgram('S100 M3\nG0 X0 Z0\nG2 X40 Z0 CR=5 F.1').alarm.code, 'E_ARC_RADIUS_SMALL');
  const syn = parseProgram('G0 X10 @').alarm;
  assert.equal(syn.line, 0);
  assert.equal(syn.code, 'E_SYNTAX');
});

test('incremental U/W, G91 e T0202 Fanuc', () => {
  const r = parseProgram('T0202\nG0 X20 Z5\nU4 W-2\nG91 X2 Z-1\nM30');
  const last = moves(r).at(-1).pts.at(-1);
  assert.deepEqual(last.slice(0, 2), [2, 13]);
  assert.equal(r.events[0].type, 'toolchange');
});

test('dialeto decide G70/G71; torre configurável', async () => {
  assert.equal(parseProgram('G71\nM30').alarm, null);
  assert.equal(parseProgram('G70\nM30').alarm.code, 'E_INCH');
  assert.equal(parseProgram('G70 P10 Q20\nM30', { dialect: 'fanuc' }).alarm.code, 'E_FANUC_G70');
  const f = parseProgram('G71 U2 R1\nM30', { dialect: 'fanuc' });
  assert.equal(f.warnings[0].code, 'W_FANUC_G71');
  const { buildTurret } = await import('../../shared/tools.js');
  const turret = buildTurret({ 1: 'ext_rough_80', 2: '', 3: 'drill_10' });
  assert.equal(parseProgram('T2\nM30', { turret }).alarm.code, 'E_TOOL_MISSING', 'posição vazia');
  const ev = parseProgram('T3\nM30', { turret }).events[0];
  assert.deepEqual(ev.params, { t: 3, type: 'drill_10' });
});

test('mensagens traduzidas em PT e EN com nome da ferramenta', async () => {
  const { formatMessage, t, MESSAGES } = await import('../../shared/i18n.js');
  const m = { code: 'I_TOOLCHANGE', params: { t: 2, type: 'ext_finish_35' } };
  assert.equal(formatMessage('pt', m), 'T2: Acabamento externo 35°');
  assert.equal(formatMessage('en', m), 'T2: External finishing 35°');
  assert.equal(t('en', 'E_ARC_END', { diff: 0.2 }), 'Arc end point is not on the circle (difference 0.2 mm)');
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.pt).sort(), 'catálogos PT e EN com as mesmas chaves');
});

test('G4: espera em segundos (Sinumerik F, Fanuc X/P) e em rotações (S)', async () => {
  const dur = (code) => parseProgram(`G97 S600 M3\n${code}\nM30`).events.find((e) => e.type === 'dwell').duration;
  assert.equal(dur('G4 F2'), 2);
  assert.equal(dur('G4 X1.5'), 1.5);
  assert.equal(dur('G4 P500'), 0.5);
  assert.ok(near(dur('G4 S10'), 1), '10 rotações a 600 rpm = 1 s');
  // F no bloco de G4 não muda o avanço
  const r = parseProgram('G95 F0.2 S500 M3\nG4 F3\nG1 X10\nM30');
  assert.equal(r.events.at(-2).state.F, 0.2);
});

test('rosca G33: avanço = passo x rpm', () => {
  const r = parseProgram('G97 S600 M3\nG0 X20 Z5\nG33 Z-25 K1.5\nM30');
  const th = r.events.find((e) => e.type === 'thread');
  assert.ok(near(th.duration, (30 / (1.5 * 600)) * 60), 'tempo do passe');
  assert.equal(parseProgram('G96 S100 M3\nG0 X20 Z5\nG33 Z-25 K1.5\nM30').warnings[0].code, 'W_THREAD_CSS');
});

test('arco com raio negativo escolhe o arco maior', () => {
  const sweep = (r) => {
    const ev = moves(parseProgram(`S500 M3\nG0 X0 Z0\nG3 X20 Z-10 CR=${r} F0.1\nM30`))[1];
    return ev.pts.length;
  };
  assert.ok(sweep(-10) > sweep(10) * 2);
});

test('comentários, números de bloco, supressão "/" e % / O são aceitos', () => {
  const r = parseProgram('%\nO1234 (cabeçalho)\nN10 G0 X10 Z5 ; comentário\n/N20 G0 X12 (outro)\nM30\n%');
  assert.equal(r.alarm, null);
  assert.deepEqual(moves(r).at(-1).pts.at(-1).slice(0, 2), [5, 6]);
});

test('todo bloco gera ao menos um evento (realce da linha atual)', () => {
  const code = 'G18 G90\nG54\nT1 D1\nG97 S800 M3\nG0 X40 Z2\nM30';
  const lines = new Set(parseProgram(code).events.map((e) => e.line));
  assert.deepEqual([...lines], [0, 1, 2, 3, 4, 5]);
});

test('avisos: G41/G42, ciclos não suportados e falta de M30', () => {
  const codes = (c) => parseProgram(c).warnings.map((w) => w.code);
  assert.ok(codes('G42\nM30').includes('W_TNRC'));
  assert.ok(codes('CYCLE95("CONT", 2, 0.2)\nM30').includes('W_UNSUPPORTED_BLOCK'));
  assert.ok(codes('G0 X10').includes('W_NO_END'));
  assert.equal(parseProgram('G0 X10\nDIAMONX\nM30').alarm.code, 'E_UNKNOWN_KEYWORD');
});

test('DIAMOF: X em raio', () => {
  const r = parseProgram('DIAMOF\nG0 X20 Z0\nM30');
  assert.equal(moves(r)[0].pts.at(-1)[1], 20);
});

test('G28 volta à posição de referência', () => {
  const r = parseProgram('G0 X20 Z0\nG28 U0 W0\nM30', { home: { x: 150, z: 100 } });
  assert.deepEqual(moves(r).at(-1).pts.at(-1).slice(0, 2), [100, 75]);
});

test('cabeçalho da peça bruta', async () => {
  const { stockFromHeader } = await import('../../shared/gcode.js');
  assert.deepEqual(stockFromHeader('; Bruto: D50 x 80 mm, face em Z1'), { diameter: 50, length: 80, faceZ: 1 });
  assert.deepEqual(stockFromHeader('(STOCK D40.5 X 75, RAW FACE AT Z0.5)'), { diameter: 40.5, length: 75, faceZ: 0.5 });
  assert.equal(stockFromHeader('G0 X10'), null);
  assert.deepEqual(stockFromHeader('; Bruto: D50 x 60 mm, tubo Ø20, castanhas 30, face em Z1'), {
    diameter: 50, length: 60, faceZ: 1, bore: 20, clamp: 30,
  });
  assert.deepEqual(stockFromHeader('; Stock: D50 x 60, tube ID20, clamped 30'), { diameter: 50, length: 60, bore: 20, clamp: 30 });
  // "tubo" em outro comentário não conta
  assert.deepEqual(stockFromHeader('; Bruto: D40 x 80\n; usar tubo 3 de refrigeração'), { diameter: 40, length: 80 });
});
