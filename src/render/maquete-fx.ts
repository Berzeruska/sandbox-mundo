import { bakeProps } from '../maquete/chunk-build';
import { sequence } from '../maquete/hash';
import { flameModel, logModel, lump, meteorRock, Model, rgb, smokeCube, type Rgb } from '../maquete/models';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';
import { ANIMAL_FLOATS, type InstanceBatch, type MaqueteRenderer } from './maquete-renderer';
import type { ViewCamera } from './view-camera';

/**
 * Desastres dentro da maquete (C1–C7): tudo em três dimensões e em tempo real, por cima do que a simulação já fez. Rocha caindo, poeira, fumaça que sobe, chamas,
 * destroços no vento. O raio e os clarões são da camada de cima. Só desenho: o mundo não muda por causa disto.
 */
interface Particle { mesh: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; grow: number; t0: number; life: number; yaw: number; spin: number; glow: boolean }
interface Rock { id: number; point: readonly number[]; start: number; done: number; landed: number }
interface Bolt { x: number; z: number; t0: number; seed: number; sx: number }
interface Flash { x: number; z: number; t0: number; ms: number; radius: number; rgb: Rgb }
export interface StormView { p: readonly number[]; radius: number; power: number; kind: number }

const ROCK_MS = 950, MAX_PARTICLES = 500;

export class MaqueteFx {
  private particles: Particle[] = [];
  private rocks: Rock[] = [];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private flames = new Map<number, Float32Array>();
  /** Vulcões em erupção por pedaço: x, y, z. */
  private ventCells = new Map<number, Float32Array>();
  private vents: { p: readonly number[]; until: number }[] = [];
  private batches = new Map<number, InstanceBatch>();
  private meshRock = -1;
  private meshCube = -1;
  private meshFlame = -1;
  private meshLog = -1;
  private meshCloud = -1;
  private meshSand = -1;
  private rand = sequence(12345);
  private last = 0;
  private spawnSmoke = 0;
  private spawnDebris = 0;
  private storms: StormView[] = [];
  /** Vento em cima da câmera, para os animais. */
  windHere: [number, number, number] = [0, 0, 0];
  dustHere = 0;

  constructor(private renderer: MaqueteRenderer) {}

  private mesh(data: Float32Array): number {
    return this.renderer.addMesh(bakeProps([{ model: data, x: 0, y: 0, z: 0, scale: 1, stretch: 1, yaw: 0, tint: [1, 1, 1], rigid: true }]));
  }

  /** Prepara os modelos antes de precisar. */
  prepare(): void {
    if (this.meshRock >= 0) return;
    this.meshRock = this.mesh(meteorRock());
    this.meshCube = this.mesh(smokeCube(1));
    this.meshFlame = this.mesh(flameModel(1));
    this.meshLog = this.mesh(logModel(1));
    const puff = (color: Rgb, seed: number): Float32Array => { const m = new Model(); lump(m, [0, 0, 0], [1, 0.62, 1], color, seed, { rough: 0.16, tone: 0.1, low: 0.72 }); return m.build(); };
    this.meshCloud = this.mesh(puff(rgb(226, 230, 236), 5));
    this.meshSand = this.mesh(puff(rgb(190, 146, 96), 6));
  }

  setFlames(key: number, cells: Float32Array | null): void {
    if (cells && cells.length) this.flames.set(key, cells); else this.flames.delete(key);
  }

  setVents(key: number, cells: Float32Array | null): void {
    if (cells && cells.length) this.ventCells.set(key, cells); else this.ventCells.delete(key);
  }

  setStorms(list: StormView[]): void { this.storms = list; }

  /** Resposta instantânea ao toque do jogador, antes da simulação responder (decisão 7). */
  action(kind: number, point: readonly number[], now: number): void {
    if (kind === DisasterKind.Volcano) this.vents.push({ p: point, until: now + 6000 });
    if (kind === DisasterKind.Fire) this.vents.push({ p: point, until: now + 1500 });
    if (kind === DisasterKind.Flood || kind === DisasterKind.Tsunami) this.dustAt(point, now, 6, 2);
    if (kind === DisasterKind.Quake) this.dustAt(point, now, 10, 2.2);
  }

  add(e: DisasterEvent, now: number): void {
    if (e.kind === DisasterKind.Meteor) this.rocks.push({ id: e.id, point: e.point, start: now, done: e.fallDone ?? 0, landed: 0 });
    if (e.kind === DisasterKind.Lightning) this.bolts.push({ x: NaN, z: NaN, t0: now, seed: e.id, sx: 0 });
    if (e.kind === DisasterKind.Lightning) (this.bolts[this.bolts.length - 1] as Bolt & { p?: readonly number[] }).p = e.point;
    if (e.kind === DisasterKind.Volcano) this.vents.push({ p: e.point, until: now + 9000 });
    if (e.kind === DisasterKind.Quake) this.dustAt(e.point, now, 14, 3 + (e.magnitude - 6));
  }

  land(id: number, now: number, camera: ViewCamera): void {
    const r = this.rocks.find((q) => q.id === id);
    if (!r) return;
    r.landed = now;
    const q = camera.planeOf(r.point);
    if (!q) return;
    this.flashes.push({ x: q.x, z: q.z, t0: now, ms: 520, radius: 26, rgb: [255, 226, 170] });
    // A poeira esconde o instante em que a cratera entra na malha.
    for (let k = 0; k < 34; k++) {
      const a = this.rand() * 6.283, v = 4 + this.rand() * 11;
      this.push({ mesh: this.meshCube, x: q.x + Math.cos(a) * 2, y: 1.4, z: q.z + Math.sin(a) * 2, vx: Math.cos(a) * v, vy: 2.5 + this.rand() * 9, vz: Math.sin(a) * v, size: 0.9 + this.rand() * 1.5, grow: 1.1, t0: now, life: 900 + this.rand() * 900, yaw: a, spin: 1.2, glow: false });
    }
  }

  private dustAt(point: readonly number[], now: number, count: number, reach: number): void {
    (this.pendingDust ??= []).push({ point, now, count, reach });
  }
  private pendingDust: { point: readonly number[]; now: number; count: number; reach: number }[] | null = null;

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  update(now: number, camera: ViewCamera, paused: boolean): void {
    this.prepare();
    const dt = paused ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const eyeX = camera.view.x, eyeZ = camera.view.z;
    for (const d of this.pendingDust ?? []) {
      const q = camera.planeOf(d.point);
      if (!q) continue;
      for (let k = 0; k < d.count; k++) {
        const a = this.rand() * 6.283, r = this.rand() * d.reach * 3;
        this.push({ mesh: this.meshCube, x: q.x + Math.cos(a) * r, y: 1, z: q.z + Math.sin(a) * r, vx: Math.cos(a), vy: 1 + this.rand() * 2, vz: Math.sin(a), size: 0.5 + this.rand() * 0.8, grow: 0.8, t0: d.now, life: 700 + this.rand() * 700, yaw: a, spin: 0.6, glow: false });
      }
    }
    this.pendingDust = null;
    // Rocha: fumaça atrás dela.
    for (const r of this.rocks) {
      if (r.landed) continue;
      const q = camera.planeOf(r.point);
      if (!q) continue;
      const u = Math.min(1, r.done + (now - r.start) / ROCK_MS);
      if (this.rand() < 0.7) this.push({ mesh: this.meshCube, x: q.x - 44 * (1 - u), y: 1.5 + 78 * (1 - u), z: q.z - 30 * (1 - u), vx: 0, vy: 0.8, vz: 0, size: 0.8 + this.rand() * 0.7, grow: 0.5, t0: now, life: 500 + this.rand() * 400, yaw: this.rand() * 6, spin: 0.5, glow: false });
    }
    this.rocks = this.rocks.filter((r) => !r.landed && now - r.start < 60000);
    // Fumaça de vulcão que sobe e se mexe.
    this.vents = this.vents.filter((v) => v.until > now);
    this.spawnSmoke += dt * 9;
    while (this.spawnSmoke > 1) {
      this.spawnSmoke -= 1;
      const puff = (x: number, y: number, z: number): void => {
        if (Math.hypot(x - eyeX, z - eyeZ) > 280) return;
        const a = this.rand() * 6.283, r = this.rand() * 1.6;
        this.push({ mesh: this.meshCube, x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, vx: 0.6 + (this.rand() - 0.5) * 1.2, vy: 3.2 + this.rand() * 2, vz: (this.rand() - 0.5) * 1.2, size: 0.9 + this.rand() * 1, grow: 0.42, t0: now, life: 3200 + this.rand() * 2200, yaw: this.rand() * 6, spin: 0.5, glow: false });
      };
      for (const v of this.vents) { const q = camera.planeOf(v.p); if (q) puff(q.x, 2.5, q.z); }
      for (const [key, cells] of this.ventCells) {
        const place = this.renderer.placeOf(key);
        if (!place) continue;
        for (let o = 0; o + 3 <= cells.length; o += 3) {
          const lx = cells[o] as number, lz = cells[o + 2] as number;
          puff(place[0] + place[2] * lx + place[3] * lz, cells[o + 1] as number, place[1] - place[3] * lx + place[2] * lz);
        }
      }
    }
    // Vento dos furacões e poeira das tempestades de areia onde a câmera está.
    this.windHere = [0, 0, 0];
    let dustTarget = 0;
    const center = camera.centerPoint();
    const size = 652;
    for (const s of this.storms) {
      const dot = (s.p[0] as number) * center[0] + (s.p[1] as number) * center[1] + (s.p[2] as number) * center[2];
      const dist = Math.acos(Math.max(-1, Math.min(1, dot)));
      const k = Math.max(0, 1 - dist / Math.max(1e-4, s.radius * 1.7));
      if (k <= 0) continue;
      if (s.kind === 1) { dustTarget = Math.max(dustTarget, k * Math.min(1, s.power + 0.3)); continue; }
      const q = camera.planeOf(s.p);
      if (!q) continue;
      const dx = eyeX - q.x, dz = eyeZ - q.z, l = Math.hypot(dx, dz) || 1, amp = k * Math.min(1, s.power + 0.3) * 1.9;
      // Em volta do olho.
      this.windHere = [-dz / l, dx / l, amp];
    }
    this.dustHere += (dustTarget - this.dustHere) * Math.min(1, (paused ? 0 : 0.016) * 1.8);
    this.renderer.wind = this.windHere;
    this.renderer.dust = this.dustHere * 0.62;
    // Destroços no vento: troncos e torrões voando.
    if (this.windHere[2] > 0.3) {
      this.spawnDebris += dt * 18 * this.windHere[2];
      while (this.spawnDebris > 1) {
        this.spawnDebris -= 1;
        const R = camera.view.distance * 0.45;
        const x = eyeX + (this.rand() - 0.5) * R * 2, z = eyeZ + (this.rand() - 0.5) * R * 2;
        const log = this.rand() < 0.5;
        this.push({ mesh: log ? this.meshLog : this.meshCube, x, y: 1 + this.rand() * 2, z, vx: this.windHere[0] * 26, vy: 4 + this.rand() * 7, vz: this.windHere[1] * 26, size: log ? 0.8 + this.rand() : 0.3 + this.rand() * 0.4, grow: 0, t0: now, life: 900 + this.rand() * 1300, yaw: this.rand() * 6, spin: 5, glow: false });
      }
    }
    const stormParts: [number, number, number, number, number, number][] = [];
    for (const [i, s] of this.storms.entries()) {
      const q = camera.planeOf(s.p);
      if (!q || Math.hypot(q.x - eyeX, q.z - eyeZ) > 420) continue;
      const R = s.radius * size;
      if (s.kind === 0) {
        // Furacão: braços de nuvem girando em volta do olho.
        for (let k = 0; k < 72; k++) {
          const arm = k % 3, f = (k % 24) / 24, r = R * (0.16 + f * 0.9), a = arm * 2.094 + f * 3.4 + now * 0.0011 + i;
          stormParts.push([this.meshCloud, q.x + Math.cos(a) * r, 15 + (k % 5) * 0.9, q.z + Math.sin(a) * r, a, 3.5 + (k % 7) * 0.9]);
        }
      } else {
        // Areia: paredes baixas de poeira andando.
        for (let k = 0; k < 64; k++) {
          const a = k * 2.399 + now * 0.00025 + i, r = R * Math.sqrt(((k * 37) % 64) / 64);
          stormParts.push([this.meshSand, q.x + Math.cos(a) * r, 3 + (k % 6) * 1.1 + Math.sin(now * 0.002 + k) * 0.5, q.z + Math.sin(a) * r, a, 4 + (k % 5) * 1.3]);
        }
      }
    }
    for (const b of this.batches.values()) b.count = 0;
    const add = (mesh: number, x: number, y: number, z: number, yaw: number, s: number, glow: boolean): void => {
      let b = this.batches.get(mesh);
      if (!b) { b = { mesh, data: new Float32Array(ANIMAL_FLOATS * 64), count: 0 }; this.batches.set(mesh, b); }
      if ((b.count + 1) * ANIMAL_FLOATS > b.data.length) { const n = new Float32Array(b.data.length * 2); n.set(b.data); b.data = n; }
      const o = b.count * ANIMAL_FLOATS;
      b.data[o] = x; b.data[o + 1] = y; b.data[o + 2] = z; b.data[o + 3] = yaw; b.data[o + 4] = s; b.data[o + 5] = 0; b.data[o + 6] = glow ? -1 : 0;
      b.count++;
    };
    for (const q of stormParts) add(q[0], q[1], q[2], q[3], q[4], q[5], false);
    // Rochas à vista.
    for (const r of this.rocks) {
      const q = camera.planeOf(r.point);
      if (!q) continue;
      const u = Math.min(1, r.done + (now - r.start) / ROCK_MS);
      add(this.meshRock, q.x - 44 * (1 - u), 1.5 + 78 * (1 - u), q.z - 30 * (1 - u), u * 3, 2.1, true);
    }
    // Partículas: crescem, sobem e somem encolhendo (sem transparência, que custaria caro).
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.grow < 1) { p.vy *= 1 - 0.3 * dt; } else { p.vy -= 9 * dt; p.vx *= 1 - 1.4 * dt; p.vz *= 1 - 1.4 * dt; if (p.y < 1) { p.y = 1; p.vy = 0; } }
      const u = (now - p.t0) / p.life;
      const s = p.size * (1 + p.grow * u * 3) * (u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1);
      add(p.mesh, p.x, p.y, p.z, p.yaw + p.spin * u, s, p.glow);
    }
    // Chamas em cada célula em chamas, tremendo.
    for (const [key, cells] of this.flames) {
      const place = this.renderer.placeOf(key);
      if (!place) continue;
      for (let o = 0; o + 3 <= cells.length; o += 3) {
        const lx = cells[o] as number, y = cells[o + 1] as number, lz = cells[o + 2] as number;
        const wx = place[0] + place[2] * lx + place[3] * lz, wz = place[1] - place[3] * lx + place[2] * lz;
        const w = Math.sin(now * 0.011 + o) * 0.22 + Math.sin(now * 0.023 + o * 1.7) * 0.12;
        add(this.meshFlame, wx, y, wz, o, paused ? 1.15 : 1.15 + w, true);
      }
    }
  }

  /** O que desenhar em instâncias neste quadro. */
  list(): InstanceBatch[] { return [...this.batches.values()].filter((b) => b.count > 0); }

  /** Camada de cima: raio, clarões e a névoa da tempestade de areia. */
  drawOverlay(ctx: CanvasRenderingContext2D, camera: ViewCamera, now: number): void {
    const w = camera.width, h = camera.height;
    if (this.dustHere > 0.02) {
      ctx.save();
      ctx.fillStyle = `rgba(150, 108, 62, ${Math.min(0.62, this.dustHere * 0.62)})`;
      ctx.fillRect(0, 0, w, h);
      // Faixas de areia passando.
      ctx.globalAlpha = Math.min(0.5, this.dustHere * 0.5);
      for (let k = 0; k < 9; k++) {
        const y = ((k * 137 + now * 0.05) % (h + 160)) - 80, x = ((now * (0.34 + k * 0.03) + k * 311) % (w + 800)) - 400, band = 34 + (k % 4) * 22;
        const g = ctx.createLinearGradient(0, y - band, 0, y + band);
        g.addColorStop(0, 'rgba(190,150,100,0)'); g.addColorStop(0.5, 'rgba(196,152,100,1)'); g.addColorStop(1, 'rgba(190,150,100,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 500, y - band, 1000, band * 2);
      }
      ctx.restore();
    }
    this.flashes = this.flashes.filter((f) => now - f.t0 < f.ms);
    for (const f of this.flashes) {
      const s = camera.project(f.x, 2, f.z), u = (now - f.t0) / f.ms;
      const R = (camera.cellPixels() / 4) * f.radius * (0.4 + u);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
      g.addColorStop(0, `rgba(${f.rgb[0]},${f.rgb[1]},${f.rgb[2]},${0.95 * (1 - u)})`);
      g.addColorStop(1, `rgba(${f.rgb[0]},${f.rgb[1]},${f.rgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - R, s.y - R, R * 2, R * 2);
    }
    // Raio: desce do céu, de cima da tela, com galhos; clarão no chão.
    this.bolts = this.bolts.filter((b) => now - b.t0 < 520);
    for (const b of this.bolts as (Bolt & { p?: readonly number[] })[]) {
      const q = b.p ? camera.planeOf(b.p) : null;
      if (!q) continue;
      const end = camera.project(q.x, 1, q.z);
      const age = now - b.t0, alpha = age < 90 ? 1 : age < 170 ? 0.35 : age < 260 ? 0.9 : Math.max(0, 1 - (age - 260) / 260);
      const rand = sequence(b.seed + 991);
      const start = { x: end.x + (rand() - 0.5) * 240, y: -10 };
      if (age < 120) { ctx.fillStyle = `rgba(226,232,255,${0.14 * (1 - age / 120)})`; ctx.fillRect(0, 0, w, h); }
      const trace = (x0: number, y0: number, x1: number, y1: number, steps: number, spread: number, width: number, depth: number): void => {
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let k = 1; k <= steps; k++) {
          const f = k / steps, nx = x0 + (x1 - x0) * f + (k < steps ? (rand() - 0.5) * spread : 0), ny = y0 + (y1 - y0) * f + (k < steps ? (rand() - 0.5) * spread * 0.3 : 0);
          ctx.lineTo(nx, ny);
          if (depth > 0 && k < steps && rand() < 0.3) {
            const len = (y1 - y0) * (0.12 + rand() * 0.2);
            const keep = { x: nx, y: ny };
            ctx.stroke();
            trace(keep.x, keep.y, keep.x + (rand() - 0.5) * len * 1.3, keep.y + len, 4, spread * 0.6, width * 0.5, depth - 1);
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(nx, ny);
          }
        }
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(170,190,255,0.95)';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = `rgba(240,244,255,${alpha})`;
      trace(start.x, start.y, end.x, end.y, 14, 64, 3.2, 2);
      ctx.restore();
      const R = 46 * (0.6 + alpha);
      const g = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, R);
      g.addColorStop(0, `rgba(255,248,214,${0.9 * alpha})`);
      g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g;
      ctx.fillRect(end.x - R, end.y - R, R * 2, R * 2);
    }
  }
}
