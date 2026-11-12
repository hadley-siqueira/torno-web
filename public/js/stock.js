// Peça bruta com malha 3D: estende o modelo puro (shared/stock-model.js) com
// as superfícies externa e interna, as faces, a vista em corte e a malha da
// peça separada no corte. A malha é refeita a partir dos perfis quando eles mudam.

import * as THREE from 'three';
import { StockModel, GONE } from '/shared/stock-model.js';

const RAW = new THREE.Color(0x6d6458);
const CUT = new THREE.Color(0xd8dce2);
const INNER = new THREE.Color(0x8e98a6); // interior mais escuro: dá contraste aos furos

export class Stock extends StockModel {
  constructor(params) {
    super(params);
    this.seg = params.segments ?? 72;
    this.buildMesh();
    this.buildSection();
  }

  /**
   * Cria uma peça (sem trecho preso na placa) a partir de um perfil
   * { z: [...], r: [...], ri: [...] }, como o devolvido por separate().
   */
  static fromProfile(part, segments = 72) {
    const n = part.z.length;
    const z0 = part.z[0];
    const z1 = part.z[n - 1];
    const s = new Stock({ diameter: 2 * Math.max(...part.r), length: Math.max(z1 - z0, 0.1), faceZ: z1, clamp: 0, segments });
    let j = 0;
    for (let i = 0; i < s.N; i++) {
      const z = s.zAt(i);
      while (j < n - 2 && part.z[j + 1] < z) j++;
      const f = Math.min(1, Math.max(0, (z - part.z[j]) / (part.z[j + 1] - part.z[j] || 1)));
      s.r[i] = part.r[j] + (part.r[j + 1] - part.r[j]) * f;
      s.ri[i] = part.ri[j] + (part.ri[j + 1] - part.ri[j]) * f;
      s.cut[i] = 3;
    }
    s.markDirty(0, s.N - 1);
    s.updateGeometry();
    return s;
  }

  /** Malha da peça separada no corte (perfil vindo de separate()). */
  partMesh(part, material) {
    const pts = part.z.map((z, j) => new THREE.Vector2(part.r[j], z));
    const inner = part.z.map((z, j) => new THREE.Vector2(part.ri[j], z));
    // contorno fechado: externo (esq.→dir.), face, interno (dir.→esq.)
    const loop = [...pts, ...inner.reverse(), pts[0].clone()];
    const geo = new THREE.LatheGeometry(loop, this.seg);
    geo.rotateZ(-Math.PI / 2); // eixo Y -> eixo X da cena
    return new THREE.Mesh(geo, material);
  }

  // ---------- Malha de revolução ----------
  // Anéis: 0 = início (trecho preso na placa, ou ponta esquerda da peça);
  // 1..N = externo; N+1..2N = interno; depois as faces direita e esquerda (coroas)
  buildMesh() {
    const S = this.seg;
    const N = this.N;
    const RV = S + 1;
    this.RV = RV;
    this.ringOuter = 1;
    this.ringInner = N + 1;
    this.capRo = 2 * N + 1;
    this.capRi = 2 * N + 2;
    this.capLo = 2 * N + 3;
    this.capLi = 2 * N + 4;
    const total = (2 * N + 5) * RV;
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
    // Perfis efetivamente desenhados (ver renderProfiles)
    this.zz = new Float32Array(N);
    this.ro = new Float32Array(N);
    this.rin = new Float32Array(N);

    const idx = [];
    const strip = (ra, rb, flip) => {
      for (let j = 0; j < S; j++) {
        const a = ra * RV + j;
        const b = rb * RV + j;
        if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    };
    for (let i = 0; i < N; i++) strip(i, i + 1, false); // início + externo
    for (let i = 0; i < N - 1; i++) strip(this.ringInner + i, this.ringInner + i + 1, true); // interno
    strip(this.capRi, this.capRo, true); // face direita (coroa)
    strip(this.capLi, this.capLo, false); // face esquerda (coroa)

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

  /**
   * Onde não há material, os anéis externo e interno "colam" no anel do vizinho
   * com material (mesmo z e raio = furo do vizinho). Assim a face de uma peça
   * furada vira uma coroa e as faixas sem material ficam com área zero.
   * (Antes o externo fechava no eixo e tampava a entrada do furo.)
   */
  renderProfiles() {
    const { r, ri, N, zz, ro, rin } = this;
    const solid = (i) => r[i] - ri[i] >= GONE;
    const left = new Int32Array(N);
    const right = new Int32Array(N);
    let last = -1;
    for (let i = 0; i < N; i++) {
      if (solid(i)) last = i;
      left[i] = last;
    }
    last = -1;
    for (let i = N - 1; i >= 0; i--) {
      if (solid(i)) last = i;
      right[i] = last;
    }
    for (let i = 0; i < N; i++) {
      if (solid(i)) {
        zz[i] = this.zAt(i);
        ro[i] = r[i];
        rin[i] = ri[i];
        continue;
      }
      const L = left[i];
      const R = right[i];
      if (L < 0 && R < 0) {
        zz[i] = this.zAt(i);
        ro[i] = rin[i] = 0;
        continue;
      }
      const k = L < 0 ? R : R < 0 ? L : i - L <= R - i ? L : R;
      zz[i] = this.zAt(k === L ? k + 1 : k - 1); // o primeiro ponto vazio ao lado do vizinho
      ro[i] = rin[i] = ri[k];
    }
  }

  updateGeometry(force = false) {
    const range = this.takeDirty();
    if (!range && !force) return false;
    this.renderProfiles();
    const { N, h, zz, ro, rin, r, ri, RV } = this;
    const solid = (i) => r[i] - ri[i] >= GONE;

    // Trecho a reescrever: o alterado + 2 vizinhos (normais) + trechos vazios
    // vizinhos (eles copiam o anel da amostra com material mais próxima)
    let [lo, hi] = force || !range ? [0, N - 1] : range;
    lo = Math.max(0, lo - 2);
    hi = Math.min(N - 1, hi + 2);
    while (lo > 0 && !solid(lo - 1)) lo--;
    while (hi < N - 1 && !solid(hi + 1)) hi++;
    const full = lo === 0 && hi === N - 1;

    const clamped = this.clamp > 0;
    const z0 = clamped ? this.zLeft - this.clamp : this.zAt(0);
    const r0 = clamped ? this.R0 : ro[0];
    const ri0 = clamped ? this.Ri0 : rin[0];

    this.writeRing(0, z0, r0, 0, 1, clamped ? RAW : CUT, clamped);
    for (let i = lo; i <= hi; i++) {
      const ip = Math.max(0, i - 1);
      const inx = Math.min(N - 1, i + 1);
      // externo: normal para fora
      let s = (ro[inx] - ro[ip]) / (2 * h);
      let a = 1 / Math.sqrt(1 + s * s);
      const cutO = this.cut[i] & 1;
      this.writeRing(this.ringOuter + i, zz[i], ro[i], -s * a, a, cutO ? CUT : RAW, !cutO);
      // interno: normal para o eixo
      s = (rin[inx] - rin[ip]) / (2 * h);
      a = 1 / Math.sqrt(1 + s * s);
      this.writeRing(this.ringInner + i, zz[i], rin[i], s * a, -a, INNER, false);
    }
    const faceCut = this.cut[N - 1] ? CUT : RAW;
    this.writeRing(this.capRo, zz[N - 1], ro[N - 1], 1, 0, faceCut, false);
    this.writeRing(this.capRi, zz[N - 1], rin[N - 1], 1, 0, faceCut, false);
    this.writeRing(this.capLo, z0, r0, -1, 0, clamped ? RAW : CUT, false);
    this.writeRing(this.capLi, z0, ri0, -1, 0, clamped ? RAW : CUT, false);

    // Envia para a placa de vídeo só os trechos reescritos
    const ring = RV * 3;
    for (const attr of Object.values(this.geometry.attributes)) {
      attr.clearUpdateRanges();
      if (!full) {
        attr.addUpdateRange(0, ring); // anel inicial
        attr.addUpdateRange((this.ringOuter + lo) * ring, (hi - lo + 1) * ring);
        attr.addUpdateRange((this.ringInner + lo) * ring, (hi - lo + 1) * ring);
        attr.addUpdateRange(this.capRo * ring, 4 * ring); // faces (4 anéis seguidos)
      }
      attr.needsUpdate = true;
    }
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

  // Só recalcula quando visível (a vista em corte chama com force ao aparecer)
  updateSection(force = false) {
    if (!this.secPos) return;
    if (!force && !this.section.visible) return;
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
    if (this.clamp > 0) put(0, this.zLeft - this.clamp, this.R0, this.Ri0);
    else put(0, this.zAt(0), this.r[0], Math.min(this.ri[0], this.r[0]));
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
