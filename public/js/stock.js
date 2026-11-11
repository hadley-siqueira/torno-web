// Modelo da peça bruta: para cada posição z ao longo do eixo guardamos o raio
// externo r(z) e o raio interno ri(z) (furo). Há material onde ri < |raio| < r.
//
// Remoção de material conforme o tipo de ferramenta:
//  - externa: rebaixa r(z) com a borda inferior da pastilha
//  - broca (axial, em X0): aumenta ri(z) com a meia-largura da broca
//  - interna (barra/rosca interna): aumenta ri(z) com a borda superior da pastilha;
//    se o corpo da ferramenta entrar no material, é colisão
// A malha 3D (superfícies externa e interna, face e vista em corte) é refeita
// a partir dos perfis sempre que eles mudam.

import * as THREE from 'three';
import { lowerBoundary, upperBoundary, insertSpan } from '/shared/tools.js';

const RAW = new THREE.Color(0x6d6458);
const CUT = new THREE.Color(0xd8dce2);
const GONE = 0.02; // espessura abaixo da qual não há material

export class Stock {
  constructor({ diameter, length, faceZ, clamp = 25, segments = 72 }) {
    this.R0 = diameter / 2;
    this.length = length;
    this.faceZ = faceZ;
    this.zLeft = faceZ - length;
    this.clamp = clamp;
    this.seg = segments;
    this.h = Math.max(0.05, length / 2000);
    this.N = Math.round(length / this.h) + 1;
    this.h = length / (this.N - 1);
    this.r = new Float32Array(this.N);
    this.ri = new Float32Array(this.N);
    this.cut = new Uint8Array(this.N);
    this.toolTables = new Map();
    this.reset();
    this.buildMesh();
    this.buildSection();
  }

  reset() {
    this.r.fill(this.R0);
    this.ri.fill(0);
    this.cut.fill(0);
    this.dirty = true;
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
          this.dirty = true;
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
          this.dirty = true;
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
      return -1;
    }
    return i; // amostras (i, right] estão soltas
  }

  /** Separa a parte solta e devolve uma malha independente para animar a queda. */
  detach(idx, material) {
    const pts = [];
    const inner = [];
    for (let i = idx + 1; i < this.N; i++) {
      pts.push(new THREE.Vector2(this.r[i], this.zAt(i)));
      inner.push(new THREE.Vector2(this.ri[i], this.zAt(i)));
    }
    for (let i = idx + 1; i < this.N; i++) this.r[i] = this.ri[i];
    this.dirty = true;
    // contorno fechado: externo (esq.→dir.), face, interno (dir.→esq.)
    const loop = [...pts, ...inner.reverse(), pts[0].clone()];
    const geo = new THREE.LatheGeometry(loop, this.seg);
    geo.rotateZ(-Math.PI / 2); // eixo Y -> eixo X da cena
    return new THREE.Mesh(geo, material);
  }

  // ---------- Malha de revolução ----------
  // Anéis: 0 = trecho preso na placa; 1..N = externo; N+1..2N = interno;
  // depois os anéis das tampas (face direita externa/interna e tampa esquerda)
  buildMesh() {
    const S = this.seg;
    const N = this.N;
    const RV = S + 1;
    this.RV = RV;
    this.ringOuter = 1;
    this.ringInner = N + 1;
    this.capRo = 2 * N + 1;
    this.capRi = 2 * N + 2;
    this.capL = 2 * N + 3;
    const total = (2 * N + 4) * RV + 1;
    this.pos = new Float32Array(total * 3);
    this.nor = new Float32Array(total * 3);
    this.col = new Float32Array(total * 3);
    this.cos = new Float32Array(RV);
    this.sin = new Float32Array(RV);
    for (let j = 0; j <= S; j++) {
      const a = (j / S) * Math.PI * 2;
      this.cos[j] = Math.cos(a);
      this.sin[j] = Math.sin(a);
    }
    // Leve variação angular na cor bruta: deixa a rotação visível
    this.rawTint = new Float32Array(RV);
    for (let j = 0; j <= S; j++) this.rawTint[j] = 0.85 + 0.15 * Math.sin((j / S) * Math.PI * 6) ** 2;

    const idx = [];
    const strip = (ra, rb, flip) => {
      for (let j = 0; j < S; j++) {
        const a = ra * RV + j;
        const b = rb * RV + j;
        if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    };
    for (let i = 0; i < N; i++) strip(i, i + 1, false); // trecho preso + externo
    for (let i = 0; i < N - 1; i++) strip(this.ringInner + i, this.ringInner + i + 1, true); // interno
    // face direita (coroa entre externo e interno)
    for (let j = 0; j < S; j++) {
      const o = this.capRo * RV + j;
      const ii = this.capRi * RV + j;
      idx.push(ii, o + 1, o, ii, ii + 1, o + 1);
    }
    // tampa esquerda (dentro da placa)
    const c = this.capL * RV + RV;
    for (let j = 0; j < S; j++) idx.push(c, this.capL * RV + j, this.capL * RV + j + 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.geometry = geo;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.75,
      roughness: 0.32,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.updateGeometry(true);
  }

  // Escreve um anel: nAx/nRad = componentes axial e radial da normal
  writeRing(ring, z, rad, nAx, nRad, color, tint) {
    const { pos, nor, col, cos, sin } = this;
    for (let j = 0; j < this.RV; j++) {
      const o = (ring * this.RV + j) * 3;
      pos[o] = z;
      pos[o + 1] = rad * cos[j];
      pos[o + 2] = rad * sin[j];
      nor[o] = nAx;
      nor[o + 1] = nRad * cos[j];
      nor[o + 2] = nRad * sin[j];
      const k = tint ? this.rawTint[j] : 1;
      col[o] = color.r * k;
      col[o + 1] = color.g * k;
      col[o + 2] = color.b * k;
    }
  }

  updateGeometry(force = false) {
    if (!this.dirty && !force) return false;
    this.dirty = false;
    const { r, ri, N, h } = this;
    const zClamp = this.zLeft - this.clamp;

    this.writeRing(0, zClamp, this.R0, 0, 1, RAW, true);
    for (let i = 0; i < N; i++) {
      const ip = Math.max(0, i - 1);
      const inx = Math.min(N - 1, i + 1);
      // externo: normal para fora
      let s = (r[inx] - r[ip]) / (2 * h);
      let a = 1 / Math.sqrt(1 + s * s);
      const cutO = this.cut[i] & 1;
      this.writeRing(this.ringOuter + i, this.zAt(i), r[i], -s * a, a, cutO ? CUT : RAW, !cutO);
      // interno: normal para o eixo
      s = (ri[inx] - ri[ip]) / (2 * h);
      a = 1 / Math.sqrt(1 + s * s);
      this.writeRing(this.ringInner + i, this.zAt(i), ri[i], s * a, -a, CUT, false);
    }
    const faceCut = this.cut[N - 1] ? CUT : RAW;
    this.writeRing(this.capRo, this.faceZ, r[N - 1], 1, 0, faceCut, false);
    this.writeRing(this.capRi, this.faceZ, ri[N - 1], 1, 0, faceCut, false);
    this.writeRing(this.capL, zClamp, this.R0, -1, 0, RAW, false);
    const c = (this.capL * this.RV + this.RV) * 3;
    this.pos.set([zClamp, 0, 0], c);
    this.nor.set([-1, 0, 0], c);
    this.col.set([RAW.r, RAW.g, RAW.b], c);

    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.updateSection();
    return true;
  }

  // ---------- Vista em corte (perfil plano no plano z=0 da cena) ----------
  // Para cada amostra: 4 vértices (r, ri, -ri, -r); faixas superior e inferior
  buildSection() {
    const n = this.N + 1;
    this.secPos = new Float32Array(n * 4 * 3);
    const idx = [];
    for (let k = 0; k < n - 1; k++) {
      const a = k * 4;
      const b = a + 4;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // metade de cima
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // metade de baixo
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.secPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.section = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x3f8fbf, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1 })
    );
    this.section.frustumCulled = false;
    this.section.visible = false;
    this.updateSection();
  }

  updateSection() {
    if (!this.secPos) return;
    const p = this.secPos;
    const put = (k, z, ro, rin) => {
      const vals = [ro, rin, -rin, -ro];
      for (let v = 0; v < 4; v++) {
        const o = (k * 4 + v) * 3;
        p[o] = z;
        p[o + 1] = vals[v];
        p[o + 2] = 0;
      }
    };
    put(0, this.zLeft - this.clamp, this.R0, 0);
    for (let i = 0; i < this.N; i++) put(i + 1, this.zAt(i), this.r[i], Math.min(this.ri[i], this.r[i]));
    this.section.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.section.geometry.dispose();
    this.section.material.dispose();
  }
}
