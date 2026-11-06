import { CHUNK_CELLS, type ChartChunk } from '../maquete/chart';
import type { FromMaqueteWorker, ToMaqueteWorker } from '../maquete/worker';
import type { CoarseWorld } from '../maquete/world-fields';
import { MAQUETE_LIGHT, MaqueteRenderer } from './maquete-renderer';
import type { ViewCamera } from './view-camera';

/** Pedaços da maquete: pede ao ajudante os que a câmera enxerga, sobe poucos por quadro e solta os que ficaram longe (T3). */
type Arrived = Extract<FromMaqueteWorker, { type: 'chunk' }>;

interface Wanted { chunk: ChartChunk; pcx: number; pcz: number; order: number }

/** Lados na ordem da malha (+x, -x, +z, -z), vistos no plano depois de girar. */
const SIDE_DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class MaqueteWorld {
  readonly renderer: MaqueteRenderer;
  private worker: Worker;
  private hasWorld = false;
  private worldId = 0;
  private gen = 1;
  private arrived: Arrived[] = [];
  private asked = new Set<number>();
  private stale = new Set<number>();
  private inFlight = 0;
  private wanted = new Map<number, Wanted>();
  private lastChart = -1;
  private lastKeyX = NaN;
  private lastKeyZ = NaN;
  private lastDistance = 0;
  private openDirty = true;
  buildMs: number[] = [];
  uploadMs: number[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.renderer = new MaqueteRenderer(gl);
    this.worker = new Worker(new URL('../maquete/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromMaqueteWorker>) => {
      const m = e.data;
      if (m.type === 'changed') {
        // Só os que estão na tela: continuam desenhados até o novo chegar.
        for (const k of m.keys) if (this.renderer.hasChunk(k) || this.asked.has(k)) { this.stale.add(k); this.asked.delete(k); }
        return;
      }
      this.inFlight--;
      if (m.gen !== this.gen) return;
      this.arrived.push(m);
      this.buildMs.push(m.ms);
    };
    this.worker.onerror = (e) => { console.error('Ajudante da maquete:', e.message); };
  }

  /** Cópia nova do mundo. `fresh`: outro planeta, tudo sai. */
  setWorld(world: CoarseWorld, fresh: boolean): void {
    if (fresh) {
      this.gen++;
      this.arrived = [];
      this.asked.clear();
      this.stale.clear();
      for (const k of [...this.renderer.keys()]) this.renderer.removeChunk(k);
    }
    this.hasWorld = true;
    this.worldId++;
    const msg: ToMaqueteWorker = { type: 'world', world, id: this.worldId };
    this.worker.postMessage(msg, [world.height.buffer, world.rgba.buffer, world.cover.buffer, world.state.buffer, world.deposit.buffer, world.ice.buffer] as ArrayBuffer[]);
  }

  get ready(): boolean { return this.hasWorld; }

  /** Quantos dos pedaços no raio de `radius` da câmera ainda faltam (e os que estão na vista). */
  missing(camera: ViewCamera): number {
    let miss = 0;
    const k = camera.view;
    const cx = Math.floor(k.x / CHUNK_CELLS), cz = Math.floor(k.z / CHUNK_CELLS);
    for (const w of this.wanted.values()) if (Math.max(Math.abs(w.pcx - cx), Math.abs(w.pcz - cz)) <= 3 && !this.renderer.hasChunk(w.chunk.key)) miss++;
    return miss;
  }

  get pendingCount(): number { return this.wanted.size - [...this.wanted.values()].filter((w) => this.renderer.hasChunk(w.chunk.key)).length; }

  /** A cada quadro: decide o que falta, sobe o que chegou. */
  update(camera: ViewCamera, uploads: number): void {
    if (!this.hasWorld) return;
    const v = camera.view;
    const kx = Math.floor(v.x / 8), kz = Math.floor(v.z / 8);
    const changed = kx !== this.lastKeyX || kz !== this.lastKeyZ || camera.chart !== this.lastChart || Math.abs(v.distance - this.lastDistance) > v.distance * 0.04 || this.stale.size > 0;
    if (changed) {
      this.lastKeyX = kx; this.lastKeyZ = kz; this.lastDistance = v.distance;
      if (camera.chart !== this.lastChart) { this.lastChart = camera.chart; this.replaceAll(camera); }
      this.computeWanted(camera);
      this.evict();
      this.openDirty = true;
    }
    this.request();
    let n = 0;
    while (n < uploads && this.arrived.length) {
      const m = this.arrived.shift() as Arrived;
      const w = this.wanted.get(m.key);
      if (!w) continue;
      const t0 = performance.now();
      this.renderer.setChunk(m.key, m, w.chunk.place, [true, true, true, true]);
      this.uploadMs.push(performance.now() - t0);
      this.openDirty = true;
      n++;
    }
    if (this.openDirty) this.updateOpenSides();
  }

  private replaceAll(camera: ViewCamera): void {
    // Trocou a face central: os mesmos pedaços, em outro lugar do plano.
    const sun = MAQUETE_LIGHT.sunDir, c = Math.cos(camera.chartTurn), s = Math.sin(camera.chartTurn);
    this.renderer.sunDir = [c * sun[0] + s * sun[2], sun[1], -s * sun[0] + c * sun[2]];
    this.renderer.markShadowDirty();
  }

  private computeWanted(camera: ViewCamera): void {
    const v = camera.view, pts = camera.footprint();
    const next = new Map<number, Wanted>();
    const pad = CHUNK_CELLS * 1.2;
    let minX = v.x - 64, maxX = v.x + 64, minZ = v.z - 64, maxZ = v.z + 64;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    // Dentro do trapézio visto, com folga.
    const inside = (x: number, z: number): boolean => {
      if (pts.length < 3) return true;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i] as { x: number; z: number }, b = pts[(i + 1) % pts.length] as { x: number; z: number };
        const ex = b.x - a.x, ez = b.z - a.z, len = Math.hypot(ex, ez) || 1;
        // Sentido: o centro da vista dá o lado de dentro.
        const side = (ex * (v.z - a.z) - ez * (v.x - a.x)) >= 0 ? 1 : -1;
        if (side * (ex * (z - a.z) - ez * (x - a.x)) / len < -pad) return false;
      }
      return true;
    };
    const cx0 = Math.floor(minX / CHUNK_CELLS) - 1, cx1 = Math.floor(maxX / CHUNK_CELLS) + 1, cz0 = Math.floor(minZ / CHUNK_CELLS) - 1, cz1 = Math.floor(maxZ / CHUNK_CELLS) + 1;
    const fx = v.x / CHUNK_CELLS, fz = v.z / CHUNK_CELLS;
    for (let pcz = cz0; pcz <= cz1; pcz++) for (let pcx = cx0; pcx <= cx1; pcx++) {
      const mx = (pcx + 0.5) * CHUNK_CELLS, mz = (pcz + 0.5) * CHUNK_CELLS;
      if (!inside(mx, mz)) continue;
      const chunk = camera.chunkAt(pcx, pcz);
      next.set(chunk.key, { chunk, pcx, pcz, order: Math.hypot(pcx + 0.5 - fx, pcz + 0.5 - fz) });
    }
    this.wanted = next;
    for (const w of next.values()) if (this.renderer.hasChunk(w.chunk.key)) this.renderer.setPlace(w.chunk.key, w.chunk.place);
  }

  private evict(): void {
    for (const k of [...this.renderer.keys()]) if (!this.wanted.has(k)) this.renderer.removeChunk(k);
    for (const k of [...this.asked]) if (!this.wanted.has(k)) this.asked.delete(k);
    this.arrived = this.arrived.filter((a) => this.wanted.has(a.key));
  }

  private request(): void {
    if (this.inFlight >= 6) return;
    const list = [...this.wanted.values()].filter((w) => !this.asked.has(w.chunk.key) && (!this.renderer.hasChunk(w.chunk.key) || this.stale.has(w.chunk.key))).sort((a, b) => a.order - b.order);
    for (const w of list) {
      if (this.inFlight >= 6) break;
      const c = w.chunk;
      this.asked.add(c.key);
      this.stale.delete(c.key);
      this.inFlight++;
      const msg: ToMaqueteWorker = { type: 'build', key: c.key, face: c.face, cx: c.cx, cz: c.cz, gen: this.gen };
      this.worker.postMessage(msg);
    }
    for (const k of [...this.stale]) if (!this.wanted.has(k)) this.stale.delete(k);
  }

  /** Só mostra a borda de terra nos lados sem vizinho carregado. */
  private updateOpenSides(): void {
    const at = new Map<number, Wanted>();
    const posKey = (x: number, z: number) => (z + 4096) * 8192 + x + 4096;
    for (const w of this.wanted.values()) if (this.renderer.hasChunk(w.chunk.key)) at.set(posKey(w.pcx, w.pcz), w);
    for (const w of at.values()) {
      const open = SIDE_DIRS.map(([dx, dz]) => {
        const c = w.chunk.place[2], s = w.chunk.place[3];
        const wx = Math.round(c * dx + s * dz), wz = Math.round(-s * dx + c * dz);
        return !at.has(posKey(w.pcx + wx, w.pcz + wz));
      });
      this.renderer.setOpen(w.chunk.key, open);
    }
    this.openDirty = false;
  }

  draw(camera: ViewCamera, width: number, height: number, time: number): void {
    const r = this.renderer, v = camera.view;
    // A sombra anda em passos, para não tremer.
    const radius = Math.min(150, v.distance * 0.72 + 20), step = radius * 0.2;
    const cx = Math.round(v.x / step) * step, cz = Math.round(v.z / step) * step;
    if (Math.abs(cx - r.shadowCenter[0]) > 0.5 || Math.abs(cz - r.shadowCenter[2]) > 0.5 || Math.abs(radius - r.shadowRadius) > radius * 0.1) {
      r.shadowCenter = [cx, 2, cz];
      r.shadowRadius = radius;
      r.markShadowDirty();
    }
    // Tremor do terremoto: a câmera balança um pouco, como no globo.
    if (camera.shakeX || camera.shakeY) {
      const k = v.distance / height;
      r.draw({ ...v, x: v.x + camera.shakeX * k, z: v.z + camera.shakeY * k }, width, height, time);
    } else r.draw(v, width, height, time);
  }
}
