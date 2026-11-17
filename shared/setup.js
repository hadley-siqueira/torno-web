// Configuração do programa ("preparação da máquina"): peça bruta, material do tarugo e
// ferramentas da torre. Fica salva junto com o programa, e cada exemplo traz a sua, para
// a peça sair certa mesmo que o aluno tenha mexido na torre antes.
//
// { stock: { diameter, length, faceZ, bore?, clamp? }, material, turret: { 1: tipo | '' … } }
//
// Os exemplos declaram a configuração no cabeçalho, em comentários:
//   ; Bruto: D50 x 80 mm, face em Z1        (ou WORKPIECE(...) no programa)
//   ; Torre: sinutrain | apostila | torre8  (montagem pronta; sem a linha = SinuTrain)
//   ; Material: aluminum                    (chave de MATERIALS; sem a linha = aço)

import { TURRET_DEFAULT, TURRET_PRESETS, sanitizeTurret } from './tools.js';
import { MATERIALS, DEFAULT_MATERIAL } from './appearance.js';
import { stockFromProgram } from './gcode.js';

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/** Peça bruta válida ou undefined (mesmas faixas da tela). */
export function sanitizeStock(input) {
  if (!input || typeof input !== 'object') return undefined;
  const s = {
    diameter: num(input.diameter, 5, 200),
    length: num(input.length, 10, 300),
    faceZ: num(input.faceZ, 0, 10),
  };
  if (Object.values(s).some((v) => v === undefined)) return undefined;
  // opcionais: Ø interno (tubo) e comprimento preso nas castanhas
  const bore = num(input.bore, 0, s.diameter - 2);
  const clamp = num(input.clamp, 5, 100);
  if (bore) s.bore = bore;
  if (clamp !== undefined) s.clamp = clamp;
  return s;
}

/** Configuração válida (só as partes válidas) ou null se não sobrar nada. */
export function sanitizeSetup(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  const stock = sanitizeStock(input.stock);
  if (stock) out.stock = stock;
  if (Object.hasOwn(MATERIALS, input.material ?? '')) out.material = input.material;
  const turret = sanitizeTurret(input.turret);
  if (turret) out.turret = turret;
  return Object.keys(out).length ? out : null;
}

/** Nome da montagem pronta igual a esta torre ('sinutrain', 'apostila', 'torre8') ou null. */
export function turretPresetName(cfg) {
  const c = sanitizeTurret(cfg);
  if (!c) return null;
  for (const name of ['sinutrain', 'apostila', 'torre8']) {
    const p = sanitizeTurret(TURRET_PRESETS[name]);
    if (Object.keys(p).every((k) => p[k] === c[k])) return name;
  }
  return null;
}

/**
 * Configuração de um exemplo, lida do cabeçalho. `fallbackStock` vale quando o exemplo
 * não diz o bruto. O trecho preso na placa, se o cabeçalho não disser, vem do fallback.
 */
export function setupFromExample(code, fallbackStock) {
  const text = String(code);
  const preset = text.match(/^\s*;\s*(?:TORRE|TURRET)\s*:\s*([A-Z0-9_]+)/im)?.[1]?.toLowerCase();
  const material = text.match(/^\s*;\s*MATERIAL\s*:\s*([A-Z_]+)/im)?.[1]?.toLowerCase();
  const st = stockFromProgram(text);
  let stock = fallbackStock;
  if (st) {
    const { source, ...rest } = st;
    // o cabeçalho descreve o bruto inteiro: sem tubo, é maciço
    stock = sanitizeStock({ faceZ: fallbackStock?.faceZ ?? 0, ...rest, bore: rest.bore || 0, clamp: st.clamp ?? fallbackStock?.clamp ?? 25 }) || fallbackStock;
  }
  return {
    stock,
    material: Object.hasOwn(MATERIALS, material ?? '') ? material : DEFAULT_MATERIAL,
    turret: { ...(TURRET_PRESETS[preset] || TURRET_DEFAULT) },
  };
}

/** Duas configurações iguais? (para marcar o programa como modificado) */
export function sameSetup(a, b) {
  return JSON.stringify(sanitizeSetup(a)) === JSON.stringify(sanitizeSetup(b));
}
