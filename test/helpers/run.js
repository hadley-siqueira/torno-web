// Executa um programa de ponta a ponta sem navegador: interpretador + simulador + peça.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgram, stockFromHeader } from '../../shared/gcode.js';
import { StockModel } from '../../shared/stock-model.js';
import { Simulator } from '../../shared/simulator.js';
import { buildTurret } from '../../shared/tools.js';

export const PROGRAMS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'programs');
export const readProgram = (name) => readFileSync(path.join(PROGRAMS_DIR, name), 'utf8');

export function runProgram(code, { stock: stockParams, turret = buildTurret(), dialect } = {}) {
  const params = { diameter: 50, length: 80, faceZ: 1, ...(stockFromHeader(code) || {}), ...(stockParams || {}) };
  const home = { x: Math.max(150, params.diameter + 40), z: 100 };
  const parsed = parseProgram(code, { home, turret, dialect });
  const stock = new StockModel(params);
  const events = { alarms: [], parts: [], toolChanges: [] };
  const sim = new Simulator({
    stock,
    turret,
    home,
    hooks: {
      alarm: (a) => events.alarms.push(a),
      parted: (p, line) => events.parts.push({ ...p, line }),
      toolChange: (id) => events.toolChanges.push(id),
    },
  });
  sim.load(parsed.events);
  const result = sim.runToEnd();
  return { parsed, stock, sim, result, ...events };
}

/** Diâmetro externo / furo de uma peça separada (perfil de stock.separate) em z. */
export function partDiameterAt(part, z) {
  let best = 0;
  let d = Infinity;
  part.z.forEach((pz, j) => {
    if (Math.abs(pz - z) < d) {
      d = Math.abs(pz - z);
      best = j;
    }
  });
  return { d: 2 * part.r[best], bore: 2 * part.ri[best], solid: part.r[best] - part.ri[best] >= 0.02 };
}

/** Faixa z com material na peça separada. */
export function partLength(part) {
  const zs = part.z.filter((_, j) => part.r[j] - part.ri[j] >= 0.02);
  return Math.max(...zs) - Math.min(...zs);
}
