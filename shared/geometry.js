// Geometria do plano de trabalho (Z, raio) compartilhada pelo interpretador e pelos ciclos:
// arcos, chanfros/arredondamentos de canto e o alarme do interpretador.
// Pontos são [z, r] (r = raio, não diâmetro).

export class GCodeAlarm extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

const TWO_PI = Math.PI * 2;
export const fmt = (v) => Number(v.toFixed(3));

/** Ângulo varrido de (z0,r0) a (z1,r1) em volta de (cz,cr), no sentido do arco (0 < s ≤ 2π). */
export function sweep(z0, r0, z1, r1, cz, cr, cw) {
  const a0 = Math.atan2(r0 - cr, z0 - cz);
  const a1 = Math.atan2(r1 - cr, z1 - cz);
  let s = cw ? a0 - a1 : a1 - a0;
  s = ((s % TWO_PI) + TWO_PI) % TWO_PI;
  if (s < 1e-9) s = TWO_PI;
  return s;
}

/**
 * Arco G2/G3 como polilinha. cw = G2. Centro dado (center = [cz, cr]) ou raio
 * (radius; negativo = arco maior que 180°, como CR=-10).
 */
export function arcPolyline(z0, r0, z1, r1, cw, center, radius) {
  let cz;
  let cr;
  if (center) {
    [cz, cr] = center;
    const ra = Math.hypot(z0 - cz, r0 - cr);
    const rb = Math.hypot(z1 - cz, r1 - cr);
    if (Math.abs(ra - rb) > 0.05) throw new GCodeAlarm('E_ARC_END', { diff: fmt(Math.abs(ra - rb)) });
  } else {
    const R = Math.abs(radius);
    const dz = z1 - z0;
    const dr = r1 - r0;
    const d = Math.hypot(dz, dr);
    if (d < 1e-9) throw new GCodeAlarm('E_ARC_SAME_POINT');
    if (d > 2 * R + 1e-3) throw new GCodeAlarm('E_ARC_RADIUS_SMALL', { r: R, d: fmt(d) });
    const h = Math.sqrt(Math.max(0, R * R - (d * d) / 4));
    const mz = (z0 + z1) / 2;
    const mr = (r0 + r1) / 2;
    const nz = -dr / d;
    const nr = dz / d;
    const cands = [
      [mz + nz * h, mr + nr * h],
      [mz - nz * h, mr - nr * h],
    ];
    const wantLarge = radius < 0;
    let chosen = cands[0];
    for (const c of cands) {
      const sw = sweep(z0, r0, z1, r1, c[0], c[1], cw);
      if (wantLarge ? sw > Math.PI - 1e-9 : sw <= Math.PI + 1e-9) {
        chosen = c;
        break;
      }
    }
    [cz, cr] = chosen;
  }

  const R = Math.hypot(z0 - cz, r0 - cr);
  const a0 = Math.atan2(r0 - cr, z0 - cz);
  const sw = sweep(z0, r0, z1, r1, cz, cr, cw);
  const stepAng = Math.min((2 * Math.PI) / 180, R > 0 ? 0.5 / R : 1);
  const n = Math.max(2, Math.ceil(sw / stepAng));
  const poly = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((cw ? -1 : 1) * (sw * i)) / n;
    poly.push([cz + R * Math.cos(a), cr + R * Math.sin(a)]);
  }
  poly[poly.length - 1] = [z1, r1];
  return poly;
}

/**
 * Canto entre duas retas a→p e p→b, trocado por chanfro ou arredondamento:
 *   CHR = v: chanfro com v mm em cada reta (cateto)
 *   CHF = v: chanfro de comprimento v (hipotenusa)
 *   RND = v: arredondamento de raio v, tangente às duas retas
 * Devolve os pontos que substituem p. Se o canto não couber nas retas, alarme.
 */
export function cornerPoints(a, p, b, kind, value) {
  const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
  const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
  if (la < 1e-9 || lb < 1e-9 || !(value > 0)) return [p];
  const u = [(p[0] - a[0]) / la, (p[1] - a[1]) / la];
  const w = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
  const phi = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1]))); // quanto o caminho vira
  if (phi < 1e-6) return [p]; // retas alinhadas: não há canto
  let d;
  if (kind === 'CHR') d = value;
  else if (kind === 'CHF') d = value / (2 * Math.cos(phi / 2));
  else d = value * Math.tan(phi / 2); // RND
  if (d > la + 1e-6 || d > lb + 1e-6) throw new GCodeAlarm('E_CORNER_TOO_BIG', { k: kind, v: value });
  const p1 = [p[0] - u[0] * d, p[1] - u[1] * d];
  const p2 = [p[0] + w[0] * d, p[1] + w[1] * d];
  if (kind !== 'RND') return [p1, p2];
  // centro do lado para onde o caminho vira
  const left = u[0] * w[1] - u[1] * w[0] > 0;
  const n = left ? [-u[1], u[0]] : [u[1], -u[0]];
  const c = [p1[0] + n[0] * value, p1[1] + n[1] * value];
  const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const steps = Math.max(2, Math.ceil(phi / Math.min((2 * Math.PI) / 180, 0.5 / value)));
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const ang = a0 + (left ? 1 : -1) * (phi * k) / steps;
    out.push([c[0] + value * Math.cos(ang), c[1] + value * Math.sin(ang)]);
  }
  out[0] = p1;
  out[out.length - 1] = p2;
  return out;
}
