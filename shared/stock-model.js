// Modelo da peça bruta (sem 3D): para cada posição z ao longo do eixo guardamos
// o raio externo r(z) e o raio interno ri(z) (furo). Há material onde ri < |raio| < r.
//
// Remoção de material conforme o tipo de ferramenta:
//  - externa: rebaixa r(z) com a borda inferior da pastilha
//  - broca (axial, em X0): aumenta ri(z) com a meia-largura da broca
//  - interna (barra/rosca interna): aumenta ri(z) com a borda superior da pastilha;
//    se o corpo da ferramenta entrar no material, é colisão
//
// Roda no navegador (public/js/stock.js estende com a malha 3D) e no Node (testes).

import { lowerBoundary, upperBoundary, insertSpan } from './tools.js';

export const GONE = 0.02; // espessura abaixo da qual não há material

export class StockModel {
  constructor({ diameter, length, faceZ, clamp = 25 }) {
    this.R0 = diameter / 2;
    this.length = length;
    this.faceZ = faceZ;
    this.zLeft = faceZ - length;
    this.clamp = clamp;
    this.h = Math.max(0.05, length / 2000);
    this.N = Math.round(length / this.h) + 1;
    this.h = length / (this.N - 1);
    this.r = new Float32Array(this.N);
    this.ri = new Float32Array(this.N);
    this.cut = new Uint8Array(this.N);
    this.toolTables = new Map();
    this.reset();
  }

  /** Região ocupada pelas castanhas da placa (para detectar colisão). */
  chuck() {
    return { zFront: this.zLeft, jawOuter: this.R0 + 16 };
  }

  reset() {
    this.r.fill(this.R0);
    this.ri.fill(0);
    this.cut.fill(0);
    this.markDirty(0, this.N - 1);
  }

  /**
   * Marca o trecho de amostras [lo, hi] como alterado. A malha 3D só
   * reenvia esse trecho para a placa de vídeo (enviar tudo a cada quadro travava).
   */
  markDirty(lo, hi) {
    this.dirty = true;
    this.dirtyLo = Math.min(this.dirtyLo ?? lo, lo);
    this.dirtyHi = Math.max(this.dirtyHi ?? hi, hi);
  }

  /** Devolve e limpa o trecho alterado (ou null). */
  takeDirty() {
    if (!this.dirty) return null;
    const range = [this.dirtyLo ?? 0, this.dirtyHi ?? this.N - 1];
    this.dirty = false;
    this.dirtyLo = this.dirtyHi = undefined;
    return range;
  }

  zAt(i) {
    return this.zLeft + i * this.h;
  }

  // Bordas inferior e superior da ferramenta, amostradas com metade do passo do perfil
  table(tool) {
    let t = this.toolTables.get(tool.type);
    if (t) return t;
    const [z0, z1] = insertSpan(tool.insert);
    const step = this.h / 2;
    const n = Math.ceil((z1 - z0) / step) + 1;
    const low = new Float32Array(n);
    const up = new Float32Array(n);
    const inCut = new Uint8Array(n); // 1 = pastilha (aresta de corte), 0 = corpo
    const [c0, c1] = tool.cutZone || [-Infinity, Infinity];
    for (let k = 0; k < n; k++) {
      const dz = Math.min(z1, z0 + k * step);
      low[k] = lowerBoundary(tool.insert, dz) ?? 1e9;
      up[k] = upperBoundary(tool.insert, dz) ?? -1e9;
      inCut[k] = dz >= c0 - 1e-9 && dz <= c1 + 1e-9 ? 1 : 0;
    }
    t = { z0, z1, step, low, up, inCut };
    this.toolTables.set(tool.type, t);
    return t;
  }

  /**
   * Remove material com a ponta da ferramenta em (z, x), x = raio programado.
   * Retorna { removed, parted, collision, offCenter }.
   */
  carve(tool, z, x) {
    const res = { removed: 0, parted: -1, collision: false, offCenter: false };
    if (tool.kind === 'external' && x >= this.R0) return res;
    const offAxis = tool.kind === 'axial' && Math.abs(x) > 0.05;
    const t = this.table(tool);
    const i0 = Math.max(0, Math.ceil((z + t.z0 - this.zLeft) / this.h));
    const i1 = Math.min(this.N - 1, Math.floor((z + t.z1 - this.zLeft) / this.h));
    const { r, ri } = this;
    let hitZero = false;
    for (let i = i0; i <= i1; i++) {
      if (r[i] - ri[i] < GONE) continue; // sem material nesta posição
      const k = (this.zAt(i) - z - t.z0) / t.step;
      const ka = Math.max(0, Math.min(t.low.length - 1, Math.floor(k)));
      const kb = Math.min(t.low.length - 1, ka + 1);
      const f = Math.min(1, Math.max(0, k - ka));
      const low = x + t.low[ka] * (1 - f) + t.low[kb] * f;
      const up = x + t.up[ka] * (1 - f) + t.up[kb] * f;

      if (offAxis) {
        // broca fora do centro: só é problema se encostar no material
        if (Math.abs(x) - (up - x) < r[i]) {
          res.offCenter = true;
          return res;
        }
        continue;
      }

      if (tool.kind === 'external') {
        const limit = Math.max(0, low);
        if (r[i] > limit + 1e-4) {
          res.removed = Math.max(res.removed, r[i] - Math.max(limit, ri[i]));
          r[i] = Math.max(limit, ri[i]);
          this.cut[i] |= 1;
          this.markDirty(i, i);
          if (r[i] - ri[i] < GONE) hitZero = true;
        }
      } else {
        // broca (simétrica em X0) ou ferramenta interna: abre o furo até "up".
        // Material sob a ferramenta interna: na pastilha, até 1 mm vira cavaco
        // (aresta frontal cortando um ressalto); no corpo da barra é colisão.
        if (tool.kind === 'internal' && low < r[i] && up > ri[i] && ri[i] < Math.abs(low) - 0.2) {
          const tol = t.inCut[ka] ? 1.0 : 0.2;
          if (ri[i] < Math.abs(low) - tol) {
            res.collision = true;
            return res;
          }
        }
        if (up > ri[i] + 1e-4) {
          const nri = Math.min(up, r[i]);
          res.removed = Math.max(res.removed, nri - ri[i]);
          ri[i] = nri;
          this.cut[i] |= 2;
          this.markDirty(i, i);
          if (r[i] - ri[i] < GONE) hitZero = true;
        }
      }
    }
    if (hitZero) res.parted = this.findPart();
    return res;
  }

  // Procura um trecho solto à direita de uma posição sem material
  findPart() {
    const { r, ri } = this;
    const solid = (i) => r[i] - ri[i] >= GONE;
    let i = this.N - 1;
    while (i >= 0 && !solid(i)) i--; // ignora a região já vazia na ponta
    if (i < 0) return -1;
    const right = i;
    while (i >= 0 && solid(i)) i--;
    if (i < 0 || i === right) return -1;
    // fragmentos minúsculos (ex.: "pino" do faceamento) viram cavaco
    let maxT = 0;
    for (let j = i + 1; j <= right; j++) maxT = Math.max(maxT, r[j] - ri[j]);
    if (maxT < 0.5 || (right - i) * this.h < 0.5) {
      for (let j = i + 1; j <= right; j++) r[j] = ri[j];
      this.markDirty(i + 1, right);
      return -1;
    }
    return i; // amostras (i, right] estão soltas
  }

  /** Separa o trecho solto (amostras após idx) e devolve o perfil dele. */
  separate(idx) {
    const part = { z: [], r: [], ri: [] };
    for (let i = idx + 1; i < this.N; i++) {
      part.z.push(this.zAt(i));
      part.r.push(this.r[i]);
      part.ri.push(this.ri[i]);
      this.r[i] = this.ri[i];
    }
    this.markDirty(idx + 1, this.N - 1);
    return part;
  }

  // ---------- consultas (testes e medição) ----------
  index(z) {
    return Math.max(0, Math.min(this.N - 1, Math.round((z - this.zLeft) / this.h)));
  }

  /** Diâmetro externo em z (0 se não há material). */
  diameterAt(z) {
    const i = this.index(z);
    return this.r[i] - this.ri[i] < GONE ? 0 : 2 * this.r[i];
  }

  /** Diâmetro do furo em z (0 se maciço). */
  boreAt(z) {
    const i = this.index(z);
    return this.r[i] - this.ri[i] < GONE ? 0 : 2 * this.ri[i];
  }

  hasMaterialAt(z) {
    const i = this.index(z);
    return this.r[i] - this.ri[i] >= GONE;
  }
}
