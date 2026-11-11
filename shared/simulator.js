// Motor da simulação (sem interface): executa os eventos do interpretador
// (shared/gcode.js) sobre o modelo da peça (shared/stock-model.js), movendo a
// ferramenta no tempo, removendo material e detectando colisões.
//
// A interface (public/js/main.js) e os testes usam o mesmo motor. A interface
// recebe os acontecimentos pelos "ganchos" (hooks):
//   status(s)              – 'reset' | 'run' | 'hold' | 'alarm' | 'end'
//   eventStart(ev)         – começou um evento (bloco)
//   toolChange(id, ev)     – troca de ferramenta
//   pause(ev)              – M0/M1
//   alarm(a)               – { code, params, line } (códigos traduzidos em shared/i18n.js)
//   end(ev, elapsed)       – M30/M2
//   parted(part, line)     – peça separada; part = perfil devolvido por stock.separate()
//   singleStop(nextLine)   – parou no modo bloco a bloco

export const MAX_RPM = 4000;

/** Rotação do fuso para o estado modal e o raio atual. */
export function rpmFor(state, r) {
  if (!state || !state.spindle) return 0;
  if (state.css) return Math.min(state.lims, MAX_RPM, (state.Vc * 1000) / (Math.PI * Math.max(2 * Math.abs(r), 0.01)));
  return Math.min(state.S, MAX_RPM);
}

export class Simulator {
  constructor({ stock, turret, home = { x: 150, z: 100 }, hooks = {} }) {
    this.stock = stock;
    this.turret = turret;
    this.home = home;
    this.hooks = {}; // ganchos só depois de construído (a interface pode ainda não estar pronta)
    this.events = [];
    this.single = false;
    this.rewind();
    this.hooks = hooks;
  }

  setStock(stock) {
    this.stock = stock;
    this.rewind();
  }

  setTurret(turret) {
    this.turret = turret;
    this.rewind();
  }

  firstTool() {
    if (this.turret[1]) return 1;
    return Number(Object.keys(this.turret)[0] || 1);
  }

  load(events) {
    this.events = events;
    this.rewind();
  }

  rewind() {
    this.idx = 0;
    this.t = 0;
    this.k = 0; // segmento atual dentro do evento
    this.startedIdx = -1;
    this.elapsed = 0;
    this.pos = { z: this.home.z, r: this.home.x / 2 };
    this.tool = this.firstTool();
    this.state = null;
    this.rpm = 0;
    this.dir = 0;
    this.alarm = null;
    this.chipAcc = 0;
    this.parts = [];
    this.stock?.reset();
    this.setStatus('reset');
  }

  setStatus(s) {
    this.status = s;
    this.hooks.status?.(s);
  }

  /** Inicia do começo (reset/fim/alarme) ou continua (parado). */
  run() {
    if (this.status === 'run') return;
    if (this.status !== 'hold') this.rewind();
    this.setStatus('run');
  }

  hold() {
    if (this.status === 'run') this.setStatus('hold');
  }

  raise(code, line, params = {}) {
    this.alarm = { code, params, line };
    this.setStatus('alarm');
    this.hooks.alarm?.(this.alarm);
  }

  get currentTool() {
    return this.turret[this.tool] || null;
  }

  onEventStart(ev) {
    this.state = ev.state;
    this.dir = ev.state.spindle;
    this.hooks.eventStart?.(ev);
    switch (ev.type) {
      case 'toolchange':
        this.tool = ev.state.tool;
        this.hooks.toolChange?.(this.tool, ev);
        break;
      case 'pause':
        this.setStatus('hold');
        this.hooks.pause?.(ev);
        return 'consumed';
      case 'alarm':
        this.raise(ev.code, ev.line, ev.params);
        return 'stop';
      case 'end':
        this.setStatus('end');
        this.hooks.end?.(ev, this.elapsed);
        return 'consumed';
    }
    return null;
  }

  // Move a ponta de (z0,r0) a (z1,r1) em passos menores que a resolução da peça
  carveSegment(z0, r0, z1, r1, type, line) {
    const stock = this.stock;
    const tool = this.currentTool;
    const ch = stock.chuck();
    if (Math.min(z0, z1) < ch.zFront && Math.min(r0, r1) < ch.jawOuter) {
      this.raise('A_CHUCK', line);
      return false;
    }
    if (!tool) return true;
    if (tool.kind === 'external' && r0 >= stock.R0 && r1 >= stock.R0) return true;
    const L = Math.hypot(z1 - z0, r1 - r0);
    const n = Math.max(1, Math.ceil(L / (stock.h * 0.7)));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const z = z0 + (z1 - z0) * f;
      const r = r0 + (r1 - r0) * f;
      const res = stock.carve(tool, z, r);
      if (res.collision || res.offCenter) {
        this.pos = { z, r };
        this.raise(res.collision ? 'A_BAR' : 'A_DRILL_CENTER', line);
        return false;
      }
      if (res.removed > 0) {
        if (type === 'rapid' && res.removed > 0.05) {
          this.pos = { z, r };
          this.raise('A_RAPID', line);
          return false;
        }
        if (this.rpm <= 0) {
          this.pos = { z, r };
          this.raise('A_SPINDLE', line);
          return false;
        }
        this.chipAcc += res.removed;
      }
      if (res.parted >= 0) {
        const part = stock.separate(res.parted);
        this.parts.push(part);
        this.hooks.parted?.(part, line);
      }
    }
    return true;
  }

  // Avança a ferramenta ao longo do evento até o tempo tb
  moveAlong(ev, tb) {
    const pts = ev.pts;
    let { z, r } = this.pos;
    while (this.k < pts.length - 1 && pts[this.k + 1][2] <= tb) {
      const p = pts[this.k + 1];
      this.rpm = p[3];
      if (!this.carveSegment(z, r, p[0], p[1], ev.type, ev.line)) return false;
      z = p[0];
      r = p[1];
      this.k++;
    }
    if (this.k < pts.length - 1) {
      const a = pts[this.k];
      const b = pts[this.k + 1];
      const f = (tb - a[2]) / Math.max(1e-12, b[2] - a[2]);
      const nz = a[0] + (b[0] - a[0]) * f;
      const nr = a[1] + (b[1] - a[1]) * f;
      this.rpm = a[3] + (b[3] - a[3]) * f;
      if (!this.carveSegment(z, r, nz, nr, ev.type, ev.line)) return false;
      z = nz;
      r = nr;
    }
    this.pos = { z, r };
    return true;
  }

  /**
   * Avança `seconds` de tempo de máquina (Infinity = o máximo possível).
   * timeLimitMs limita o tempo real gasto nesta chamada (para não travar a tela).
   */
  advance(seconds, timeLimitMs = Infinity) {
    let budget = seconds;
    const t0 = timeLimitMs < Infinity ? performance.now() : 0;
    const evs = this.events;
    while (this.status === 'run' && budget > 0 && this.idx < evs.length) {
      if (timeLimitMs < Infinity && performance.now() - t0 > timeLimitMs) break;
      const ev = evs[this.idx];
      if (this.startedIdx !== this.idx) {
        this.startedIdx = this.idx;
        this.k = 0;
        const act = this.onEventStart(ev);
        if (act === 'stop') return;
        if (act === 'consumed') {
          this.idx++;
          this.t = 0;
          return;
        }
      }
      const dur = ev.duration || 0;
      const step = Math.min(budget, dur - this.t);
      if (ev.pts && !this.moveAlong(ev, this.t + step)) return;
      if (!ev.pts) this.rpm = rpmFor(ev.state, this.pos.r);
      this.t += step;
      this.elapsed += step;
      budget -= step;
      if (this.t >= dur - 1e-9) {
        if (ev.pts) {
          const last = ev.pts[ev.pts.length - 1];
          this.pos = { z: last[0], r: last[1] };
          this.k = ev.pts.length - 1;
        }
        this.idx++;
        this.t = 0;
        const next = evs[this.idx];
        if (this.single && next && next.line !== ev.line) {
          this.setStatus('hold');
          this.hooks.singleStop?.(next.line);
        }
      }
    }
    if (this.idx >= evs.length && this.status === 'run') this.setStatus('end');
  }

  /** Executa até parar (fim, alarme ou parada programada). Para testes e "até o fim". */
  runToEnd() {
    if (this.status !== 'run') this.run();
    while (this.status === 'run') this.advance(Infinity);
    return { status: this.status, alarm: this.alarm, elapsed: this.elapsed };
  }
}
