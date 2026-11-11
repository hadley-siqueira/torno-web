import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../shared/gcode.js';

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
  assert.match(parseProgram('S100 M3\nG1 X10').alarm.message, /F/);
  assert.match(parseProgram('G95 F0.1\nG1 X10').alarm.message, /fuso/);
  assert.match(parseProgram('T9').alarm.message, /T9/);
  assert.match(parseProgram('S100 M3\nG0 X0 Z0\nG2 X40 Z0 CR=5 F.1').alarm.message, /Raio/);
  assert.equal(parseProgram('G0 X10 @').alarm.line, 0);
});

test('incremental U/W, G91 e T0202 Fanuc', () => {
  const r = parseProgram('T0202\nG0 X20 Z5\nU4 W-2\nG91 X2 Z-1\nM30');
  const last = moves(r).at(-1).pts.at(-1);
  assert.deepEqual(last.slice(0, 2), [2, 13]);
  assert.equal(r.events[0].type, 'toolchange');
});
