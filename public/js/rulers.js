// Réguas graduadas da vista Lateral (como as escalas do simulador do SinuTrain):
//  - régua Z embaixo da peça, régua X (em diâmetro) ao lado da face;
//  - passando o mouse sobre a peça: linhas de chamada até as réguas com Z, Ø externo e Ø interno,
//    "grudando" nas faces (degraus do perfil);
//  - clique: fixa uma referência em Z e passa a mostrar a distância até ela (comprimento de trechos).
//
// Desenha num <canvas> 2D por cima do WebGL: não redesenha a cena 3D ao mover o mouse.

import * as THREE from 'three';
import { GONE } from '/shared/stock-model.js';
import { niceStep, profileFaces, materialExtent } from '/shared/measure.js';

const SNAP_PX = 8; // distância (pixels) para grudar numa face
const STRIP = 22; // largura das réguas (pixels)

const COLORS = {
  strip: 'rgba(14, 19, 25, 0.78)',
  tick: '#9fb0c2',
  label: '#d6dee8',
  zero: '#ffcc33',
  hover: '#4fd1ff',
  inner: '#c99cff',
  ref: '#ffa63d',
  box: 'rgba(14, 19, 25, 0.9)',
};

export class Rulers {
  constructor(scene, container, { tr }) {
    this.scene = scene;
    this.container = container;
    this.tr = tr;
    this.enabled = true;
    this.mouse = null; // posição do mouse em pixels (ou null fora da vista)
    this.ref = null; // referência em Z para medir comprimentos
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rulers';
    container.prepend(this.canvas); // abaixo dos painéis (DRO, botões), acima do 3D
    this.ctx = this.canvas.getContext('2d');
    this.v = new THREE.Vector3();

    const el = scene.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.mouse = this.localPos(e);
      this.draw();
    });
    el.addEventListener('pointerleave', () => {
      this.mouse = null;
      this.draw();
    });
    // clique (sem arrastar) com o botão esquerdo fixa/apaga a referência
    el.addEventListener('pointerdown', (e) => {
      this.down = e.button === 0 ? this.localPos(e) : null;
    });
    el.addEventListener('pointerup', (e) => {
      const p = this.localPos(e);
      if (!this.down || Math.hypot(p.x - this.down.x, p.y - this.down.y) > 4) return;
      this.click(p);
    });
  }

  localPos(e) {
    const b = this.container.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  setEnabled(on) {
    this.enabled = on;
    this.draw();
  }

  clearRef() {
    this.ref = null;
    this.draw();
  }

  /** Peça mostrada: a peça pronta separada, se estiver em destaque, ou a peça na placa. */
  get part() {
    const sc = this.scene;
    return (sc.finished && sc.finishedStock) || sc.stock;
  }

  get active() {
    return this.enabled && this.scene.view === 'side' && !!this.part;
  }

  // ---------- conversões mundo (z, raio) <-> tela ----------
  toScreen(z, y) {
    this.v.set(z, y, 0).project(this.scene.camera);
    return { x: ((this.v.x + 1) / 2) * this.w, y: ((1 - this.v.y) / 2) * this.h };
  }

  toWorld(px, py) {
    this.v.set((px / this.w) * 2 - 1, 1 - (py / this.h) * 2, 0).unproject(this.scene.camera);
    return { z: this.v.x, y: this.v.y };
  }

  extent(s) {
    return materialExtent(s);
  }

  /** Ponto sob o mouse: z (grudado numa face próxima), diâmetros e se grudou. */
  probe(px, py) {
    const s = this.part;
    const ext = this.extent(s);
    if (!ext) return null;
    const { z } = this.toWorld(px, py);
    const pxPerMm = this.pxPerMm();
    // faces + as pontas da peça
    const faces = profileFaces(s);
    let best = null;
    for (const f of faces) {
      const d = Math.abs(f - z) * pxPerMm;
      if (d <= SNAP_PX && (!best || d < best.d)) best = { z: f, d };
    }
    if (z < ext[0] - SNAP_PX / pxPerMm || z > ext[1] + SNAP_PX / pxPerMm) return null;
    const zz = best ? best.z : Math.min(ext[1], Math.max(ext[0], z));
    // diâmetros: amostra do lado do mouse (numa face há dois valores)
    let i = s.index(z);
    if (s.r[i] - s.ri[i] < GONE) i = s.index(zz + (z < zz ? -s.h : s.h));
    const solid = s.r[i] - s.ri[i] >= GONE;
    return {
      z: zz,
      snapped: !!best,
      ro: solid ? s.r[i] : 0,
      ri: solid ? s.ri[i] : 0,
    };
  }

  pxPerMm() {
    const cam = this.scene.camera;
    return this.w / ((cam.right - cam.left) / cam.zoom);
  }

  click(p) {
    if (!this.active) return;
    const pr = this.probe(p.x, p.y);
    if (!pr) return;
    if (this.ref !== null && Math.abs(pr.z - this.ref) * this.pxPerMm() <= SNAP_PX) this.ref = null;
    else this.ref = pr.z;
    this.draw();
  }

  // ---------- desenho ----------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.w = w;
    this.h = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw() {
    this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.canvas.dataset.reading = ''; // leitura atual em texto (acessibilidade e testes)
    this.container.classList.toggle('measuring', this.active);
    if (!this.active) return;
    const s = this.part;
    if (s !== this.lastPart) this.ref = null; // outra peça (peça pronta x placa, novo bruto): referência não vale
    this.lastPart = s;
    const ext = this.extent(s);
    if (!ext) return;
    this.scene.camera.updateMatrixWorld();
    const ppm = this.pxPerMm();
    const R = s.R0;

    // Posição das réguas: Z logo abaixo da peça; X logo à direita da face
    const zRulerY = Math.min(this.h - 96, Math.max(40, this.toScreen(0, -R).y + 10));
    const xRulerX = Math.min(this.w - STRIP - 8, Math.max(8, this.toScreen(ext[1], 0).x + 14));
    const axisY = this.toScreen(0, 0).y;

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    this.drawZRuler(zRulerY, ppm);
    this.drawXRuler(xRulerX, axisY, R, ppm);

    // referência fixa
    if (this.ref !== null) {
      const x = this.toScreen(this.ref, 0).x;
      this.vline(x, this.toScreen(0, R).y - 10, zRulerY, COLORS.ref, [6, 3]);
      this.tag(x, zRulerY + STRIP + 10, `${this.tr('ruler_ref')} ${fmt(this.ref)}`, COLORS.ref, 'center');
    }

    if (!this.mouse) return;
    const pr = this.probe(this.mouse.x, this.mouse.y);
    if (!pr) return;
    const x = this.toScreen(pr.z, 0).x;
    const top = this.toScreen(0, Math.max(pr.ro, R * 0.2)).y;
    // linha de chamada em Z
    this.vline(x, top - 6, zRulerY, COLORS.hover, pr.snapped ? [] : [4, 3]);
    this.tag(x, zRulerY + STRIP / 2, `Z ${fmt(pr.z)}`, COLORS.hover, 'center');
    // linhas de chamada dos diâmetros até a régua X
    const lines = [];
    if (pr.ro > 0) {
      for (const sgn of [1, -1]) this.hline(x, xRulerX, this.toScreen(0, sgn * pr.ro).y, COLORS.hover);
      this.tag(xRulerX + STRIP / 2, this.toScreen(0, pr.ro).y, `Ø${fmt(2 * pr.ro)}`, COLORS.hover, 'center');
      lines.push([`${this.tr('ruler_ext')} ${fmt(2 * pr.ro)}`, COLORS.hover]);
    }
    if (pr.ri > GONE) {
      for (const sgn of [1, -1]) this.hline(x, xRulerX, this.toScreen(0, sgn * pr.ri).y, COLORS.inner, [4, 3]);
      this.tag(xRulerX + STRIP / 2, this.toScreen(0, pr.ri).y, `Ø${fmt(2 * pr.ri)}`, COLORS.inner, 'center');
      lines.push([`${this.tr('ruler_int')} ${fmt(2 * pr.ri)}`, COLORS.inner]);
    }
    // cota entre a referência e o mouse
    if (this.ref !== null && Math.abs(pr.z - this.ref) > 1e-6) {
      const xr = this.toScreen(this.ref, 0).x;
      const y = zRulerY - 12;
      this.dimension(xr, x, y, COLORS.ref);
      const dz = Math.abs(pr.z - this.ref);
      this.tag((xr + x) / 2, y - 12, fmt(dz), COLORS.ref, 'center');
      lines.push([`ΔZ ${fmt(dz)}`, COLORS.ref]);
    }
    lines.unshift([`Z ${fmt(pr.z)}`, COLORS.hover]);
    this.canvas.dataset.reading = lines.map(([t]) => t).join(' | ');
    lines.push([this.tr(this.ref === null ? 'ruler_hint' : 'ruler_hint_ref'), COLORS.tick]);
    this.tooltip(this.mouse.x + 16, this.mouse.y + 16, lines);
  }

  drawZRuler(y, ppm) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.strip;
    ctx.fillRect(0, y, this.w, STRIP);
    const major = niceStep(ppm, 60);
    const minor = major / (major * ppm / 5 >= 6 ? 5 : 2);
    const z0 = this.toWorld(0, 0).z;
    const z1 = this.toWorld(this.w, 0).z;
    ctx.textAlign = 'center';
    for (let k = Math.ceil(z0 / minor); k * minor <= z1; k++) {
      const z = k * minor;
      const x = this.toScreen(z, 0).x;
      const isMajor = Math.abs(z / major - Math.round(z / major)) < 1e-6;
      const isZero = Math.abs(z) < 1e-9;
      ctx.strokeStyle = isZero ? COLORS.zero : COLORS.tick;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + (isMajor ? 9 : 4));
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = isZero ? COLORS.zero : COLORS.label;
        ctx.fillText(isZero ? 'Z0' : fmtTick(z, major), x, y + 15);
      }
    }
  }

  drawXRuler(x, axisY, R, ppm) {
    const ctx = this.ctx;
    // régua em diâmetro: um mm de Ø = meio mm na tela
    const top = this.toScreen(0, R + 4).y;
    const bot = this.toScreen(0, -R - 4).y;
    ctx.fillStyle = COLORS.strip;
    ctx.fillRect(x, top, STRIP, bot - top);
    const major = niceStep(ppm / 2, 34);
    const minor = major / (major * ppm / 10 >= 6 ? 5 : 2);
    const dMax = 2 * (R + 4);
    ctx.textAlign = 'left';
    for (let k = 0; k * minor <= dMax; k++) {
      const d = k * minor;
      const isMajor = Math.abs(d / major - Math.round(d / major)) < 1e-6;
      for (const sgn of d === 0 ? [1] : [1, -1]) {
        const y = this.toScreen(0, (sgn * d) / 2).y;
        if (y < top || y > bot) continue;
        ctx.strokeStyle = d === 0 ? COLORS.zero : COLORS.tick;
        ctx.beginPath();
        ctx.moveTo(x, y + 0.5);
        ctx.lineTo(x + (isMajor ? 9 : 4), y + 0.5);
        ctx.stroke();
        if (isMajor && d > 0) {
          ctx.fillStyle = COLORS.label;
          ctx.fillText(fmtTick(d, major), x + 10, y);
        }
      }
    }
    ctx.fillStyle = COLORS.zero;
    ctx.fillText('X0', x + 10, axisY);
  }

  vline(x, y0, y1, color, dash = []) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y0);
    ctx.lineTo(x + 0.5, y1);
    ctx.stroke();
    ctx.restore();
  }

  hline(x0, x1, y, color, dash = [4, 3]) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  // cota com setas entre x0 e x1
  dimension(x0, x1, y, color) {
    const ctx = this.ctx;
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(a, y + 0.5);
    ctx.lineTo(b, y + 0.5);
    ctx.stroke();
    if (b - a > 14) {
      for (const [px, dir] of [[a, 1], [b, -1]]) {
        ctx.beginPath();
        ctx.moveTo(px, y + 0.5);
        ctx.lineTo(px + 7 * dir, y - 3);
        ctx.lineTo(px + 7 * dir, y + 4);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  tag(x, y, text, color, align = 'left') {
    const ctx = this.ctx;
    const w = ctx.measureText(text).width + 8;
    const left = align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = COLORS.box;
    ctx.fillRect(left, y - 8, w, 16);
    ctx.strokeStyle = color;
    ctx.strokeRect(left + 0.5, y - 7.5, w - 1, 15);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, left + 4, y);
  }

  tooltip(x, y, lines) {
    const ctx = this.ctx;
    const w = Math.max(...lines.map(([t]) => ctx.measureText(t).width)) + 14;
    const h = lines.length * 16 + 8;
    const left = Math.min(x, this.w - w - 4);
    const top = Math.min(y, this.h - h - 4);
    ctx.fillStyle = COLORS.box;
    ctx.fillRect(left, top, w, h);
    ctx.textAlign = 'left';
    lines.forEach(([t, c], k) => {
      ctx.fillStyle = c;
      ctx.fillText(t, left + 7, top + 12 + k * 16);
    });
  }
}

/** Valor com 2 casas (resolução da simulação ~0,035 mm), sem "-0.00". */
function fmt(v) {
  const s = (Math.round(v * 100) / 100).toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

function fmtTick(v, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(dec);
}
