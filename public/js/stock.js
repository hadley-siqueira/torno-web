// Modelo da peça bruta: perfil de raio r(z) amostrado ao longo do eixo.
// A remoção de material é feita "rebaixando" o perfil com a silhueta da
// ferramenta. A malha 3D é uma superfície de revolução reconstruída a partir
// do perfil sempre que ele muda.

import * as THREE from 'three';
import { lowerBoundary, insertSpan } from '/shared/tools.js';

const RAW = new THREE.Color(0x6d6458);
const CUT = new THREE.Color(0xd8dce2);

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
    this.cut = new Uint8Array(this.N);
    this.toolTables = new Map();
    this.reset();
    this.buildMesh();
    this.buildSection();
  }

  reset() {
    this.r.fill(this.R0);
    this.cut.fill(0);
    this.dirty = true;
  }

  zAt(i) {
    return this.zLeft + i * this.h;
  }

  // Tabela da borda inferior da ferramenta (amostrada no mesmo passo do perfil)
  table(tool) {
    let t = this.toolTables.get(tool.id);
    if (t) return t;
    const [z0, z1] = insertSpan(tool.insert);
    const step = this.h / 2;
    const n = Math.ceil((z1 - z0) / step) + 1;
    const low = new Float32Array(n);
    for (let k = 0; k < n; k++) low[k] = lowerBoundary(tool.insert, Math.min(z1, z0 + k * step)) ?? 1e9;
    t = { z0, z1, step, low };
    this.toolTables.set(tool.id, t);
    return t;
  }

  /**
   * Remove material com a ferramenta com ponta em (z, r).
   * Retorna { removed: profundidade máxima removida, parted: índice do corte ou -1 }
   */
  carve(tool, z, r) {
    const res = { removed: 0, parted: -1 };
    if (r >= this.R0) return res;
    const t = this.table(tool);
    const i0 = Math.max(0, Math.ceil((z + t.z0 - this.zLeft) / this.h));
    const i1 = Math.min(this.N - 1, Math.floor((z + t.z1 - this.zLeft) / this.h));
    let hitZero = false;
    for (let i = i0; i <= i1; i++) {
      const k = (this.zAt(i) - z - t.z0) / t.step;
      const ka = Math.max(0, Math.min(t.low.length - 1, Math.floor(k)));
      const kb = Math.min(t.low.length - 1, ka + 1);
      const f = Math.min(1, Math.max(0, k - ka));
      const limit = Math.max(0, r + t.low[ka] * (1 - f) + t.low[kb] * f);
      if (this.r[i] > limit + 1e-4) {
        res.removed = Math.max(res.removed, this.r[i] - limit);
        this.r[i] = limit;
        this.cut[i] = 1;
        this.dirty = true;
        if (limit < 0.02) hitZero = true;
      }
    }
    if (hitZero) res.parted = this.findPart();
    return res;
  }

  // Encontra um ponto interno com raio ~0 que separa material à direita
  findPart() {
    let i = this.N - 1;
    while (i >= 0 && this.r[i] < 0.02) i--; // ignora a região já vazia na ponta
    if (i < 0) return -1;
    const right = i;
    while (i >= 0 && this.r[i] >= 0.02) i--;
    if (i < 0 || i === right) return -1;
    // fragmentos minúsculos (ex.: "pino" do faceamento) viram cavaco
    let maxR = 0;
    for (let j = i + 1; j <= right; j++) maxR = Math.max(maxR, this.r[j]);
    if (maxR < 0.5 || (right - i) * this.h < 0.5) {
      for (let j = i + 1; j <= right; j++) this.r[j] = 0;
      return -1;
    }
    return i; // amostras (i, right] estão soltas
  }

  /** Separa a parte solta e devolve uma malha independente para animar a queda. */
  detach(idx, material) {
    const zs = [];
    const rs = [];
    for (let i = idx; i < this.N; i++) {
      zs.push(this.zAt(i));
      rs.push(this.r[i]);
      this.r[i] = 0;
    }
    this.dirty = true;
    const pts = [];
    for (let j = 0; j < zs.length; j++) pts.push(new THREE.Vector2(rs[j], zs[j]));
    pts.push(new THREE.Vector2(0, zs[zs.length - 1]));
    const geo = new THREE.LatheGeometry(pts, this.seg);
    geo.rotateZ(-Math.PI / 2); // eixo Y -> eixo X da cena
    const mesh = new THREE.Mesh(geo, material);
    return mesh;
  }

  // ---------- Malha de revolução ----------
  buildMesh() {
    const S = this.seg;
    const rings = this.N + 1; // anel extra = trecho preso na placa
    const ringVerts = S + 1;
    const capVerts = ringVerts + 1;
    const total = rings * ringVerts + capVerts * 2;
    this.pos = new Float32Array(total * 3);
    this.nor = new Float32Array(total * 3);
    this.col = new Float32Array(total * 3);
    this.cos = new Float32Array(ringVerts);
    this.sin = new Float32Array(ringVerts);
    for (let j = 0; j <= S; j++) {
      const a = (j / S) * Math.PI * 2;
      this.cos[j] = Math.cos(a);
      this.sin[j] = Math.sin(a);
    }
    // Leve variação angular na cor bruta: deixa a rotação visível
    this.rawTint = new Float32Array(ringVerts);
    for (let j = 0; j <= S; j++) this.rawTint[j] = 0.85 + 0.15 * Math.sin((j / S) * Math.PI * 6) ** 2;

    const idx = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < S; j++) {
        const a = i * ringVerts + j;
        const b = a + ringVerts;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // tampas: esquerda (dentro da placa) e direita (face)
    this.capL = rings * ringVerts;
    this.capR = this.capL + capVerts;
    for (const [base, flip] of [[this.capL, true], [this.capR, false]]) {
      const c = base + ringVerts;
      for (let j = 0; j < S; j++) {
        if (flip) idx.push(c, base + j, base + j + 1);
        else idx.push(c, base + j + 1, base + j);
      }
    }

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

  updateGeometry(force = false) {
    if (!this.dirty && !force) return false;
    this.dirty = false;
    const S = this.seg;
    const ringVerts = S + 1;
    const { pos, nor, col, cos, sin } = this;
    const zClamp = this.zLeft - this.clamp;

    const writeRing = (ring, z, r, slope, cut) => {
      const a = 1 / Math.sqrt(1 + slope * slope);
      const nz = -slope * a;
      for (let j = 0; j <= S; j++) {
        const o = (ring * ringVerts + j) * 3;
        pos[o] = z;
        pos[o + 1] = r * cos[j];
        pos[o + 2] = r * sin[j];
        nor[o] = nz;
        nor[o + 1] = a * cos[j];
        nor[o + 2] = a * sin[j];
        const c = cut ? CUT : RAW;
        const k = cut ? 1 : this.rawTint[j];
        col[o] = c.r * k;
        col[o + 1] = c.g * k;
        col[o + 2] = c.b * k;
      }
    };

    writeRing(0, zClamp, this.R0, 0, false);
    const r = this.r;
    for (let i = 0; i < this.N; i++) {
      const rp = r[Math.max(0, i - 1)];
      const rn = r[Math.min(this.N - 1, i + 1)];
      const slope = (rn - rp) / (2 * this.h);
      writeRing(i + 1, this.zAt(i), r[i], slope, this.cut[i]);
    }

    const writeCap = (base, z, rad, nx, cut) => {
      for (let j = 0; j <= S; j++) {
        const o = (base + j) * 3;
        pos[o] = z;
        pos[o + 1] = rad * cos[j];
        pos[o + 2] = rad * sin[j];
        nor[o] = nx;
        nor[o + 1] = 0;
        nor[o + 2] = 0;
        const c = cut ? CUT : RAW;
        col[o] = c.r;
        col[o + 1] = c.g;
        col[o + 2] = c.b;
      }
      const o = (base + ringVerts) * 3;
      pos[o] = z;
      pos[o + 1] = 0;
      pos[o + 2] = 0;
      nor[o] = nx;
      nor[o + 1] = 0;
      nor[o + 2] = 0;
      const c = cut ? CUT : RAW;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    };
    writeCap(this.capL, zClamp, this.R0, -1, false);
    writeCap(this.capR, this.faceZ, r[this.N - 1], 1, this.cut[this.N - 1]);

    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.updateSection();
    return true;
  }

  // ---------- Vista em corte (perfil plano) ----------
  buildSection() {
    const n = this.N + 1;
    this.secPos = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
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
    const put = (i, z, r) => {
      const o = i * 6;
      p[o] = z;
      p[o + 1] = r;
      p[o + 2] = 0;
      p[o + 3] = z;
      p[o + 4] = -r;
      p[o + 5] = 0;
    };
    put(0, this.zLeft - this.clamp, this.R0);
    for (let i = 0; i < this.N; i++) put(i + 1, this.zAt(i), this.r[i]);
    this.section.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.section.geometry.dispose();
    this.section.material.dispose();
  }
}
