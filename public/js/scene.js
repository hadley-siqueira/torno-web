// Cena 3D do torno: placa, peça, ferramenta, trajetória, cavacos.
// Eixos: X da cena = Z da máquina (eixo do fuso), Y da cena = X da máquina (raio).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Stock } from './stock.js';
import { DEFAULT_TURRET } from '/shared/tools.js';
import { JAW_LENGTH } from '/shared/stock-model.js';
import { materialOf, DEFAULT_MATERIAL, DEFAULT_TURRET_SIDE } from '/shared/appearance.js';

// Ângulo do plano de trabalho (onde ficam ferramenta, trajetória e vista em corte) em
// volta do eixo do fuso. 'top' = torre em cima; 'rear' = atrás da linha de centro, do
// lado oposto ao operador (torre traseira); 'front' = do lado do operador.
const SIDE_ANGLE = { top: 0, rear: -Math.PI / 2, front: Math.PI / 2 };

const PATH_COLORS = {
  rapid: new THREE.Color(0xffa63d),
  feed: new THREE.Color(0x2fe0a0),
  thread: new THREE.Color(0xe060ff),
};

// Descobre quem vai desenhar o WebGL antes de criar o renderizador (para decidir a qualidade)
function probeRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { name: '?', software: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { name, software: /swiftshader|llvmpipe|softpipe|basic render|software|warp/i.test(name) };
  } catch {
    return { name: '?', software: false };
  }
}

export class LatheScene {
  constructor(container) {
    this.container = container;
    this._glInfo = probeRenderer();
    // Sem aceleração gráfica (tudo na CPU): sem suavização de bordas, menos pixels,
    // menos pontos na peça e no máximo ~24 quadros/s (ver render)
    this.lowPower = this._glInfo.software;
    const renderer = new THREE.WebGLRenderer({ antialias: !this.lowPower, alpha: true });
    renderer.setPixelRatio(this.lowPower ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Duas câmeras: perspectiva (3D) e ortográfica (vistas 2D, como num desenho técnico)
    this.persp = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -5000, 5000);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.view = 'iso';
    this.finished = false;
    // Luz presa à câmera: ilumina o que se está olhando (inclusive dentro de furos)
    for (const cam of [this.persp, this.ortho]) {
      const head = new THREE.DirectionalLight(0xffffff, 0.9);
      head.position.set(0, 0, 1);
      cam.add(head);
      this.scene.add(cam);
    }

    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x30353c, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(80, 200, 160);
    this.scene.add(sun);

    this.spindleGroup = new THREE.Group(); // gira com o fuso
    this.machineGroup = new THREE.Group(); // estático
    // Plano de trabalho: coordenadas (Z da máquina, raio) em x/y locais. Girar este grupo
    // em volta do eixo do fuso muda o lado da torre sem mexer em mais nada.
    this.workPlane = new THREE.Group();
    this.scene.add(this.spindleGroup, this.machineGroup, this.workPlane);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.materialKey = DEFAULT_MATERIAL;
    this.turretSide = DEFAULT_TURRET_SIDE;
    this.needsRender = true; // só redesenha quando algo muda (ver render)
    this.spindleAngle = 0;
    this.falling = [];

    this.buildTool();
    this.buildChips();
    this.setTurretSide(this.turretSide);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.aspect = w / h;
    this.persp.aspect = this.aspect;
    this.persp.updateProjectionMatrix();
    if (this.orthoHalf) this.setOrthoSize(this.orthoHalf);
    this.invalidate();
  }

  setOrthoSize(halfH) {
    this.orthoHalf = halfH;
    const halfW = halfH * (this.aspect || 1);
    Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
    this.invalidate();
  }

  // ---------- Peça e placa ----------
  setStock(params) {
    if (this.stock) {
      this.spindleGroup.remove(this.stock.mesh);
      this.stock.section.removeFromParent();
      this.stock.dispose();
    }
    this.clearFalling();
    this.stock = new Stock({ ...params, segments: this.lowPower ? 32 : 72, material: this.materialKey });
    this.spindleGroup.add(this.stock.mesh);
    this.workPlane.add(this.stock.section);
    this.buildMachine();
    this.setFinished(false);
    this.setSection(this.sectionOn);
    return this.stock;
  }

  buildMachine() {
    for (const g of [this.machineGroup, this.chuckGroup]) {
      if (!g) continue;
      g.traverse((o) => o.geometry && o.geometry.dispose());
      g.clear();
    }
    if (this.chuckGroup) this.spindleGroup.remove(this.chuckGroup);

    const s = this.stock;
    const R = s.R0;
    const zJawFront = s.zLeft;
    // as castanhas têm comprimento fixo; o que passar disso fica dentro da placa
    const jawLen = Math.max(5, Math.min(s.clamp, JAW_LENGTH));
    const zJawBack = s.zLeft - jawLen;
    const bodyR = Math.max(70, R + 45);
    const bodyLen = 55;
    this.chuckInfo = { zFront: zJawFront, jawOuter: R + 16, bodyR };

    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.5, roughness: 0.55 });
    const jawMat = new THREE.MeshStandardMaterial({ color: 0x7c858f, metalness: 0.85, roughness: 0.3 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xb4bcc5, metalness: 0.1, roughness: 0.7 }); // cabeçote pintado (menos ofuscante)

    // Placa de 3 castanhas (gira)
    const chuck = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR, bodyLen, 64), steel);
    body.rotation.z = Math.PI / 2;
    body.position.x = zJawBack - bodyLen / 2;
    chuck.add(body);
    for (let k = 0; k < 3; k++) {
      const jaw = new THREE.Group();
      const grip = new THREE.Mesh(new THREE.BoxGeometry(jawLen, 16, 16), jawMat);
      grip.position.set(zJawBack + jawLen / 2, R + 8, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(jawLen * 0.6, bodyR - R - 22, 20), jawMat);
      base.position.set(zJawBack + jawLen * 0.3, R + 16 + (bodyR - R - 22) / 2, 0);
      jaw.add(grip, base);
      jaw.rotation.x = (k * Math.PI * 2) / 3;
      chuck.add(jaw);
    }
    // marca colorida para enxergar a rotação
    const mark = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 8), new THREE.MeshStandardMaterial({ color: 0xff5a36 }));
    mark.position.set(zJawBack + 0.6, bodyR - 10, 0);
    chuck.add(mark);
    this.chuckGroup = chuck;
    this.spindleGroup.add(chuck);

    // Cabeçote e barramento (fixos)
    const headLen = 140;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headLen, bodyR * 2 + 80, bodyR * 2 + 60), paint);
    head.position.x = zJawBack - bodyLen - 8 - headLen / 2;
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(bodyR * 0.7, bodyR * 0.8, 10, 48), dark);
    nose.rotation.z = Math.PI / 2;
    nose.position.x = zJawBack - bodyLen - 4;
    const bedY = -(bodyR + 40);
    const bedLen = s.length + 600;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(bedLen, 30, bodyR * 2 + 60), dark);
    bed.position.set(zJawBack - bodyLen + bedLen / 2 - 150, bedY - 15, 0);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(bedLen, 4, bodyR * 2 + 120), new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9 }));
    tray.position.set(bed.position.x, bedY - 34, 0);
    this.bedY = bedY;
    this.bedMeshes = [bed, tray];
    this.machineGroup.add(head, nose, bed, tray);

    this.frameView(this.view);
  }

  // ---------- Ferramenta ----------
  buildTool() {
    this.toolGroup = new THREE.Group();
    this.workPlane.add(this.toolGroup);
    this.toolMeshes = {};
    this.holderMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: 0.6, roughness: 0.45 });
    // Torre/carro porta-ferramenta
    const turret = new THREE.Mesh(
      new THREE.BoxGeometry(50, 30, 50),
      new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.4, roughness: 0.5 })
    );
    turret.position.set(12, 90, -2);
    this.turretBox = turret;
    this.toolGroup.add(turret);
    this.setTurret(DEFAULT_TURRET);
  }

  /** (Re)cria as malhas das ferramentas montadas na torre. */
  setTurret(turret) {
    for (const g of Object.values(this.toolMeshes)) {
      this.toolGroup.remove(g);
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== this.holderMat) o.material.dispose();
      });
    }
    this.toolMeshes = {};
    const holderMat = this.holderMat;
    for (const t of Object.values(turret)) {
      const g = new THREE.Group();
      const shape = new THREE.Shape(t.insert.map(([z, x]) => new THREE.Vector2(z, x)));
      const insGeo = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false });
      insGeo.translate(0, 0, -2.5);
      const insMat = new THREE.MeshStandardMaterial({ color: t.color, metalness: 0.7, roughness: 0.3 });
      const ins = new THREE.Mesh(insGeo, insMat);
      const h = t.holder;
      const holder = new THREE.Mesh(new THREE.BoxGeometry(h.z1 - h.z0, h.x1 - h.x0, 22), holderMat);
      holder.position.set((h.z0 + h.z1) / 2, (h.x0 + h.x1) / 2, -2);
      g.add(ins, holder);
      g.userData.insertMat = insMat;
      g.userData.holder = h;
      g.visible = false;
      this.toolGroup.add(g);
      this.toolMeshes[t.id] = g;
    }
    if (this.toolId) this.setTool(this.toolId);
    this.invalidate();
  }

  /** Mostra a ferramenta da posição id; edgeDz desloca a ferramenta quando o corretor D usa outro corte. */
  setTool(id, edgeDz = 0) {
    for (const [k, g] of Object.entries(this.toolMeshes)) {
      g.visible = Number(k) === id;
      g.position.x = Number(k) === id ? edgeDz : 0;
    }
    this.toolId = id;
    // a torre fica sobre o suporte da ferramenta ativa
    const h = this.toolMeshes[id]?.userData.holder;
    if (h) this.turretBox.position.set((h.z0 + h.z1) / 2 + edgeDz, h.x1 + 15, -2);
    this.invalidate();
  }

  setToolPos(z, r) {
    this.toolGroup.position.set(z, r, 0);
    this.invalidate();
  }

  setToolAlarm(on) {
    for (const g of Object.values(this.toolMeshes)) g.userData.insertMat.emissive.setHex(on ? 0xaa0000 : 0x000000);
    this.invalidate();
  }

  // ---------- Trajetória ----------
  setPath(events) {
    if (this.pathPreview) {
      this.workPlane.remove(this.pathPreview, this.pathDone);
      this.pathPreview.geometry.dispose();
      this.pathDone.geometry.dispose();
    }
    const pos = [];
    const col = [];
    this.segStart = new Int32Array(events.length + 1);
    let seg = 0;
    events.forEach((ev, i) => {
      this.segStart[i] = seg;
      if (!ev.pts) return;
      const c = PATH_COLORS[ev.type] || PATH_COLORS.feed;
      for (let k = 1; k < ev.pts.length; k++) {
        const a = ev.pts[k - 1];
        const b = ev.pts[k];
        pos.push(a[0], a[1], 0, b[0], b[1], 0);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        seg++;
      }
    });
    this.segStart[events.length] = seg;
    const posAttr = new THREE.Float32BufferAttribute(pos, 3);
    const colAttr = new THREE.Float32BufferAttribute(col, 3);
    const mk = (opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('color', colAttr);
      const l = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false })
      );
      l.renderOrder = 10;
      l.frustumCulled = false;
      return l;
    };
    this.pathPreview = mk(0.22);
    this.pathDone = mk(1);
    this.pathDone.geometry.setDrawRange(0, 0);
    this.workPlane.add(this.pathPreview, this.pathDone);
    this.setShowPath(this.showPath ?? true);
    this.invalidate();
  }

  setProgress(evIdx, segInEvent) {
    if (!this.pathDone) return;
    const s = this.segStart[Math.min(evIdx, this.segStart.length - 1)] + segInEvent;
    this.pathDone.geometry.setDrawRange(0, s * 2);
    this.invalidate();
  }

  setShowPath(on) {
    this.showPath = on;
    if (this.pathPreview) {
      this.pathPreview.visible = on && !this.finished;
      this.pathDone.visible = on && !this.finished;
    }
    this.invalidate();
  }

  setSection(on) {
    this.sectionOn = !!on;
    this.applySection();
  }

  // O corte vale na opção "Meio corte" e sempre na vista lateral (2D)
  applySection() {
    const on = this.sectionOn || this.view === 'side';
    for (const st of [this.stock, this.finishedStock]) {
      if (!st) continue;
      st.material.clippingPlanes = on ? [this.clipPlane] : [];
      st.material.needsUpdate = true;
      st.section.visible = on;
      if (on) st.updateSection(true);
    }
    if (this.stock && this.finished && this.finishedStock) this.stock.section.visible = false;
    this.invalidate();
  }

  // ---------- Cavacos ----------
  buildChips() {
    const N = 700;
    this.chipPos = new Float32Array(N * 3).fill(-1e5);
    this.chipVel = new Float32Array(N * 3);
    this.chipLife = new Float32Array(N);
    this.chipNext = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.chipPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.chips = new THREE.Points(g, new THREE.PointsMaterial({ color: materialOf(this.materialKey).chips, size: 1.4, sizeAttenuation: true }));
    this.chips.frustumCulled = false;
    this.scene.add(this.chips);
  }

  // Cavacos saem da ponta para fora da peça, no plano de trabalho; depois caem (−Y do mundo)
  spawnChips(z, r, count) {
    const N = this.chipLife.length;
    const c = Math.cos(this.sideAngle);
    const sn = Math.sin(this.sideAngle);
    for (let k = 0; k < count; k++) {
      const i = this.chipNext;
      this.chipNext = (i + 1) % N;
      // local: y = para fora (raio), z = normal ao plano; gira com o plano de trabalho
      const ly = r;
      const lz = (Math.random() - 0.5) * 2;
      const vy = 30 + Math.random() * 80;
      const vz = (Math.random() - 0.2) * 90;
      this.chipPos[i * 3] = z + Math.random() * 2;
      this.chipPos[i * 3 + 1] = ly * c - lz * sn;
      this.chipPos[i * 3 + 2] = ly * sn + lz * c;
      this.chipVel[i * 3] = 20 + Math.random() * 60;
      this.chipVel[i * 3 + 1] = vy * c - vz * sn;
      this.chipVel[i * 3 + 2] = vy * sn + vz * c;
      this.chipLife[i] = 0.6 + Math.random() * 0.8;
    }
    this.invalidate();
  }

  updateChips(dt) {
    const p = this.chipPos;
    const v = this.chipVel;
    let any = false;
    for (let i = 0; i < this.chipLife.length; i++) {
      if (this.chipLife[i] <= 0) continue;
      any = true;
      this.chipLife[i] -= dt;
      v[i * 3 + 1] -= 400 * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (this.chipLife[i] <= 0 || p[i * 3 + 1] < this.bedY) {
        this.chipLife[i] = 0;
        p[i * 3 + 1] = -1e5;
      }
    }
    const changed = any || this.chipsWereActive;
    if (changed) this.chips.geometry.attributes.position.needsUpdate = true;
    this.chipsWereActive = any;
    return changed;
  }

  // ---------- Peça cortada caindo ----------
  dropPart(mesh) {
    mesh.userData.vel = new THREE.Vector3(5, 0, 25);
    mesh.userData.spin = (Math.random() - 0.5) * 2;
    mesh.userData.life = 4;
    this.scene.add(mesh);
    this.falling.push(mesh);
    this.invalidate();
  }

  updateFalling(dt) {
    let moving = false;
    for (const m of this.falling) {
      const v = m.userData.vel;
      m.userData.life -= dt;
      const floor = (this.bedY ?? -100) - 30;
      if (m.position.y > floor + 8) {
        v.y -= 600 * dt;
        m.position.addScaledVector(v, dt);
        m.rotation.z += m.userData.spin * dt;
        moving = true;
      } else {
        m.position.y = floor + 8;
      }
    }
    return moving;
  }

  clearFalling() {
    for (const m of this.falling) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.falling = [];
    this.invalidate();
  }

  // ---------- Fuso ----------
  updateSpindle(rpm, dir, dt) {
    if (!dir || rpm <= 0) return;
    const omega = Math.min((rpm / 60) * Math.PI * 2, 22); // limitado p/ não "piscar"
    this.spindleAngle += (dir === 4 ? -1 : 1) * omega * dt;
    this.spindleGroup.rotation.x = this.spindleAngle;
    this.invalidate();
  }

  // ---------- Peça pronta ----------
  /**
   * Mostra só a peça fabricada (sem máquina, ferramenta e trajetória).
   * part: perfil da peça separada no corte; sem ele, mostra a peça como está na placa.
   */
  setFinished(on, part = null) {
    this.finished = !!on;
    if (this.finishedStock) {
      this.scene.remove(this.finishedStock.mesh);
      this.finishedStock.section.removeFromParent();
      this.finishedStock.dispose();
      this.finishedStock = null;
    }
    if (on && part) {
      this.finishedStock = Stock.fromProfile(part, this.lowPower ? 32 : 72, this.materialKey);
      this.scene.add(this.finishedStock.mesh);
      this.workPlane.add(this.finishedStock.section);
    }
    const machine = !on;
    this.machineGroup.visible = machine;
    if (this.chuckGroup) this.chuckGroup.visible = machine;
    this.toolGroup.visible = machine;
    this.chips.visible = machine;
    for (const m of this.falling) m.visible = machine;
    if (this.stock) this.stock.mesh.visible = machine || !part;
    this.setShowPath(this.showPath ?? true);
    this.applySection();
    this.frameView(this.view);
    this.invalidate();
  }

  // ---------- Aparência ----------
  /** Material do tarugo (só cores e brilho). */
  setMaterial(key) {
    this.materialKey = key;
    for (const st of [this.stock, this.finishedStock]) st?.setMaterial(key);
    this.chips.material.color.setHex(materialOf(key).chips);
    this.invalidate();
  }

  /** Lado da torre em relação à linha de centro: 'rear' (atrás), 'top' (em cima) ou 'front'. */
  setTurretSide(side) {
    this.turretSide = side in SIDE_ANGLE ? side : DEFAULT_TURRET_SIDE;
    this.sideAngle = SIDE_ANGLE[this.turretSide];
    this.workPlane.rotation.set(this.sideAngle, 0, 0);
    this.workPlane.updateMatrixWorld(true);
    // o meio corte remove a metade da peça do lado de quem olha a vista lateral
    this.clipPlane.normal.set(0, 0, -1).applyQuaternion(this.workPlane.quaternion);
    this.clipPlane.constant = 0;
    this.frameView(this.view);
    this.invalidate();
  }

  /** Ponto do plano de trabalho (z, raio) em coordenadas do mundo. */
  planeToWorld(z, y, out = new THREE.Vector3()) {
    return this.workPlane.localToWorld(out.set(z, y, 0));
  }

  /** Ponto do mundo em coordenadas do plano de trabalho (x = z, y = raio). */
  worldToPlane(v) {
    return this.workPlane.worldToLocal(v);
  }

  // ---------- Câmera e vistas ----------
  // Vistas como no SINUMERIK: 'iso' (3D), 'side' (lateral, 2D em corte), 'face' (de frente para a face)
  frameView(name = this.view) {
    if (!this.stock) return;
    this.view = name === 'front' ? 'side' : name === 'top' ? 'iso' : name;
    // caixa do que se quer enquadrar
    let zMin;
    let zMax;
    let rMax;
    const fs = this.finishedStock;
    if (this.finished) {
      const s = fs || this.stock;
      zMin = fs ? s.zAt(0) : s.zLeft;
      zMax = s.faceZ;
      rMax = s.R0;
    } else {
      const s = this.stock;
      zMin = s.zLeft - Math.min(s.clamp, JAW_LENGTH) - 20;
      zMax = s.faceZ + 60;
      rMax = s.R0 + 30;
    }
    const cz = (zMin + zMax) / 2;
    const len = zMax - zMin;
    const ortho = this.view !== 'iso';
    this.camera = ortho ? this.ortho : this.persp;
    this.controls.object = this.camera;
    this.controls.enableRotate = !ortho;
    this.camera.zoom = 1;

    // As vistas 2D olham de frente para o plano de trabalho, com +X (raio) para cima,
    // qualquer que seja o lado da torre (na torre traseira, a lateral é vista de cima)
    // Vistas 2D de cima/de baixo (torre traseira ou dianteira): o barramento ficaria de
    // fundo ou entre a câmera e a peça, então some
    const hideBed = ortho && this.turretSide !== 'top';
    for (const m of this.bedMeshes || []) m.visible = !hideBed;
    const q = this.workPlane.quaternion;
    const planeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    if (this.view === 'side') {
      this.setOrthoSize(Math.max(rMax * 1.25, (len * 0.6) / (this.aspect || 1)));
      this.camera.position.set(cz, 0, 0).addScaledVector(planeNormal, 1000);
      this.camera.up.copy(planeUp);
      this.controls.target.set(cz, 0, 0);
    } else if (this.view === 'face') {
      this.setOrthoSize(rMax * 1.3);
      this.camera.position.set(zMax + 1000, 0, 0);
      this.camera.up.copy(planeUp);
      this.controls.target.set(zMax, 0, 0);
    } else {
      // 3D: o operador olha de frente (+Z), um pouco de cima; com a torre traseira a
      // câmera sobe mais para a ferramenta não ficar escondida atrás da peça
      const target = this.finished ? new THREE.Vector3(cz, 0, 0) : new THREE.Vector3(cz + 20, 0, 0).addScaledVector(planeUp, 20);
      const dist = this.finished ? Math.max(len, rMax * 2) * 2.4 : Math.max(len + 100, rMax * 4 + 120) * 1.45;
      const elev = !this.finished && this.turretSide === 'rear' ? 0.85 : 0.4;
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(target).addScaledVector(new THREE.Vector3(0.35, elev, 1).normalize(), dist);
      this.controls.target.copy(target);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.applySection();
    this.invalidate();
  }

  /** Pede um novo desenho no próximo quadro. */
  invalidate() {
    this.needsRender = true;
  }

  /**
   * Quem desenha o WebGL: { name, software }. software = sem aceleração gráfica
   * (SwiftShader, llvmpipe, "Microsoft Basic Render Driver"…): tudo roda na CPU.
   */
  rendererInfo() {
    if (this._glInfo && this._glInfo.name !== '?') return this._glInfo;
    let name = '?';
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      /* sem acesso à informação */
    }
    const software = /swiftshader|llvmpipe|softpipe|basic render|software|warp/i.test(name);
    this._glInfo = { name, software };
    return this._glInfo;
  }

  isSoftwareRendering() {
    return this.rendererInfo().software;
  }

  /** Modo econômico (WebGL por software): menos pixels e no máximo ~24 quadros/s. */
  setLowPower(on) {
    this.lowPower = on;
    this.renderer.setPixelRatio(on ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.resize();
  }

  /**
   * Desenha só se algo mudou: câmera, peça, ferramenta, cavacos, peça caindo,
   * fuso girando ou um invalidate(). Parado, não gasta CPU nem placa de vídeo.
   */
  render(dt) {
    let changed = this.needsRender;
    changed = this.updateChips(dt) || changed;
    changed = this.updateFalling(dt) || changed;
    if (this.stock && this.stock.updateGeometry()) changed = true;
    if (this.controls.update()) changed = true;
    if (!changed) return false;
    const now = performance.now();
    if (this.lowPower && now - (this.lastRender || 0) < 1000 / 24) {
      this.needsRender = true; // desenha no próximo quadro permitido
      return false;
    }
    this.lastRender = now;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    this.renders = (this.renders || 0) + 1;
    this.onRender?.(); // camadas 2D por cima (réguas)
    return true;
  }
}
