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

/** Comprimento das castanhas da placa (o resto do trecho preso fica dentro da placa). */
export const JAW_LENGTH = 30;

const TWO_PI = Math.PI * 2;

/**
 * diameter: Ø externo do bruto; bore: Ø interno (tubo; 0 = maciço);
 * length: comprimento em balanço (fora da placa, útil para usinar);
 * clamp: comprimento preso na placa; faceZ: posição da face bruta (zero peça = Z0).
 */
export class StockModel {
  constructor({ diameter, length, faceZ, clamp = 25, bore = 0 }) {
    this.R0 = diameter / 2;
    this.Ri0 = Math.max(0, Math.min(bore / 2, this.R0 - 0.5));
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
    this.ri.fill(this.Ri0);
    this.cut.fill(0);
    this.threads = [];
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
    // vértices da pastilha com as bordas exatas: o corte entre dois passos é avaliado
    // no instante em que cada vértice passa sobre a amostra (a ponta é um vértice)
    const verts = [...new Set(tool.insert.map(([dz]) => dz))].map((dz) => ({
      dz,
      low: lowerBoundary(tool.insert, dz) ?? 1e9,
      up: upperBoundary(tool.insert, dz) ?? -1e9,
    }));
    t = { z0, z1, step, low, up, inCut, verts };
    this.toolTables.set(tool.type, t);
    return t;
  }

  /**
   * Remove material com a ponta da ferramenta em (z, x), x = raio programado.
   * (pz, px) é a posição anterior da ponta: o trecho entre as duas é varrido de forma
   * exata nos vértices da pastilha (sem isso, a ponta "pula" as amostras e deixa
   * centésimos de material: Ø46,05 em vez de Ø46).
   * Retorna { removed, parted, collision, offCenter }.
   */
  carve(tool, z, x, pz = z, px = x) {
    const res = { removed: 0, parted: -1, collision: false, offCenter: false };
    if (tool.kind === 'external' && x >= this.R0 && px >= this.R0) return res;
    const offAxis = tool.kind === 'axial' && Math.abs(x) > 0.05;
    const t = this.table(tool);
    const dzMove = z - pz;
    const i0 = Math.max(0, Math.ceil((Math.min(z, pz) + t.z0 - this.zLeft) / this.h));
    const i1 = Math.min(this.N - 1, Math.floor((Math.max(z, pz) + t.z1 - this.zLeft) / this.h));
    const { r, ri } = this;
    const nT = t.low.length;
    let hitZero = false;
    for (let i = i0; i <= i1; i++) {
      if (r[i] - ri[i] < GONE) continue; // sem material nesta posição
      const zi = this.zAt(i);
      const k = (zi - z - t.z0) / t.step;
      const inside = k >= -1e-6 && k <= nT - 1 + 1e-6; // a ferramenta (na posição atual) cobre a amostra
      const ka = Math.max(0, Math.min(nT - 1, Math.floor(k)));
      const kb = Math.min(nT - 1, ka + 1);
      const f = Math.min(1, Math.max(0, k - ka));
      let low = inside ? x + t.low[ka] * (1 - f) + t.low[kb] * f : 1e9;
      let up = inside ? x + t.up[ka] * (1 - f) + t.up[kb] * f : -1e9;
      const lowNow = low;
      // varredura exata: cada vértice passando sobre a amostra durante o passo
      if (Math.abs(dzMove) > 1e-9) {
        for (const v of t.verts) {
          const sv = (zi - v.dz - pz) / dzMove;
          if (sv < 0 || sv > 1) continue;
          const xs = px + (x - px) * sv;
          if (xs + v.low < low) low = xs + v.low;
          if (xs + v.up > up) up = xs + v.up;
        }
      }
      if (low > 1e8 && up < -1e8) continue;

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
        if (inside && tool.kind === 'internal' && lowNow < r[i] && up > ri[i] && ri[i] < Math.abs(lowNow) - 0.2) {
          const tol = t.inCut[ka] ? 1.0 : 0.2;
          if (ri[i] < Math.abs(lowNow) - tol) {
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
    const part = { z: [], r: [], ri: [], threads: this.exportThreads() };
    for (let i = idx + 1; i < this.N; i++) {
      part.z.push(this.zAt(i));
      part.r.push(this.r[i]);
      part.ri.push(this.ri[i]);
      this.r[i] = this.ri[i];
    }
    this.markDirty(idx + 1, this.N - 1);
    return part;
  }

  // ---------- rosca (hélice) ----------
  // O perfil r(z) guarda só o fundo do filete (o corte varre a volta inteira). Para desenhar
  // a hélice, cada rosca guarda o raio de ANTES dela (a crista) e o formato da ponta da
  // ferramenta; a superfície num ângulo θ é: fundo + formato da ponta na distância até o
  // centro do sulco, limitada pela crista. Só aparência: medidas e testes usam o fundo.

  /**
   * Registra um passe de rosca antes de ele cortar: { lead (passo), hand (+1 à direita),
   * phase (°), zRef, kind 'ext'|'int', insert (pastilha), z0, z1 (faixa do movimento) }.
   * Passes da mesma rosca (mesmo passo, sentido e fase) entram no mesmo registro.
   */
  addThread({ lead, hand = 1, phase = 0, zRef = 0, kind = 'ext', insert, z0, z1 }) {
    if (!(lead > 0) || !insert) return;
    const c0 = (((zRef + (hand * lead * phase) / 360) % lead) + lead) % lead;
    let rec = this.threads.find((t) => {
      if (t.kind !== kind || t.hand !== hand || Math.abs(t.lead - lead) > 1e-6) return false;
      const d = Math.abs(t.c0 - c0) % lead;
      return Math.min(d, lead - d) < 0.05 * lead;
    });
    if (!rec) {
      rec = { kind, lead, hand, c0, zLeft: this.zLeft, h: this.h, before: new Float32Array(this.N).fill(NaN), tooth: toothTable(insert, kind, lead, this.h / 2) };
      this.threads.push(rec);
    }
    const [s0, s1] = insertSpan(insert);
    const lo = this.index(Math.min(z0, z1) + s0);
    const hi = this.index(Math.max(z0, z1) + s1);
    const src = kind === 'ext' ? this.r : this.ri;
    // outra entrada da mesma rosca (NUMT > 1) já cortou até o fundo: a crista é a de antes dela
    const others = this.threads.filter((t) => t !== rec && t.kind === kind);
    for (let i = lo; i <= hi; i++) {
      if (!Number.isNaN(rec.before[i])) continue;
      const prev = others.find((t) => !Number.isNaN(t.before[i]));
      rec.before[i] = prev ? prev.before[i] : src[i];
    }
  }

  /** Há rosca registrada na amostra i? */
  threadAt(i) {
    for (const t of this.threads) if (!Number.isNaN(t.before[i])) return true;
    return false;
  }

  /** Raios externo e interno na amostra i, no ângulo θ da peça (com a hélice). */
  threadRadii(i, theta) {
    let ro = this.r[i];
    let ri = this.ri[i];
    if (!this.threads.length) return [ro, ri];
    const z = this.zAt(i);
    let oCap = Infinity;
    let iCap = -Infinity;
    for (const t of this.threads) {
      const b = t.before[i];
      if (Number.isNaN(b)) continue;
      const c = t.c0 + (t.hand * t.lead * theta) / TWO_PI;
      let dz = (((z - c) % t.lead) + t.lead) % t.lead;
      if (dz > t.lead / 2) dz -= t.lead;
      const off = toothAt(t.tooth, dz);
      if (t.kind === 'ext') oCap = Math.min(oCap, Math.min(b, this.r[i] + off));
      else iCap = Math.max(iCap, Math.max(b, this.ri[i] + off));
    }
    if (oCap < Infinity) ro = Math.max(ro, oCap);
    if (iCap > -Infinity) ri = Math.min(ri, iCap);
    return [ro, Math.min(ri, ro)];
  }

  /** Cópia das roscas para a peça separada (o índice das amostras muda; vale o z). */
  exportThreads() {
    return this.threads.map((t) => ({ ...t, before: t.before.slice() }));
  }

  /** Recebe roscas de outra peça (ex.: a peça separada no corte), convertendo pelo z. */
  importThreads(list = []) {
    this.threads = list.map((t) => {
      const before = new Float32Array(this.N).fill(NaN);
      for (let i = 0; i < this.N; i++) {
        const k = Math.round((this.zAt(i) - t.zLeft) / t.h);
        if (k >= 0 && k < t.before.length) before[i] = t.before[k];
      }
      return { ...t, before, zLeft: this.zLeft, h: this.h };
    });
    this.markDirty(0, this.N - 1);
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

// Formato da ponta da ferramenta em volta do centro do sulco: quanto o raio sobe (externa)
// ou desce (interna) a dz da ponta. Fora da pastilha: ±Infinity (não corta). Amostrado
// em [−passo, passo] para somar os sulcos vizinhos quando a ponta é mais larga que o passo.
function toothTable(insert, kind, lead, step) {
  const n = Math.ceil((2 * lead) / step) + 1;
  const vals = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const dz = -lead + k * step;
    const b = kind === 'ext' ? lowerBoundary(insert, dz) : upperBoundary(insert, dz);
    vals[k] = b === null ? (kind === 'ext' ? Infinity : -Infinity) : b;
  }
  return { vals, step, lead, ext: kind === 'ext' };
}

function toothAt(t, dz) {
  const at = (d) => {
    if (d < -t.lead || d > t.lead) return t.ext ? Infinity : -Infinity;
    const k = Math.round((d + t.lead) / t.step);
    return t.vals[Math.max(0, Math.min(t.vals.length - 1, k))];
  };
  // o sulco mais próximo e os vizinhos (ponta mais larga que o passo)
  const a = at(dz);
  const b = at(dz - t.lead);
  const c = at(dz + t.lead);
  return t.ext ? Math.min(a, b, c) : Math.max(a, b, c);
}
