// Peça bruta com malha 3D: estende o modelo puro (shared/stock-model.js) com
// as superfícies externa e interna, a face, a vista em corte e a malha da peça
// separada no corte. A malha é refeita a partir dos perfis sempre que eles mudam.

import * as THREE from 'three';
import { StockModel } from '/shared/stock-model.js';

const RAW = new THREE.Color(0x6d6458);
const CUT = new THREE.Color(0xd8dce2);

export class Stock extends StockModel {
  constructor(params) {
    super(params);
    this.seg = params.segments ?? 72;
    this.buildMesh();
    this.buildSection();
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
