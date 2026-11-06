import { CHUNK_CELLS, type ChartChunk } from '../maquete/chart';
import type { FromMaqueteWorker, ToMaqueteWorker } from '../maquete/worker';
import type { CoarseWorld } from '../maquete/world-fields';
import { AnimalHerds } from './maquete-animals';
import { MaqueteFx } from './maquete-fx';
import { eyeOf, MAQUETE_LIGHT, MaqueteRenderer } from './maquete-renderer';
import type { ViewCamera } from './view-camera';

/** Pedaços da maquete: pede ao ajudante os que a câmera enxerga, sobe poucos por quadro e solta os que ficaram longe (T3). */
type Arrived = Extract<FromMaqueteWorker, { type: 'chunk' }>;

interface Wanted { chunk: ChartChunk; pcx: number; pcz: number; order: number }

/** Plantas de perto: pedem a esta distância da câmera, soltam a esta. */
const NEAR_ASK = 185, NEAR_DROP = 240;

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
  private rebuilding = new Set<number>();
  private nearAsked = new Set<number>();
  private nearArrived: Extract<FromMaqueteWorker, { type: 'near' }>[] = [];
  readonly animals: AnimalHerds;
  readonly fx: MaqueteFx;
  buildMs: number[] = [];
  uploadMs: number[] = [];

  constructor(gl: WebGL2RenderingContext) {
    const aa = new URLSearchParams(location.search).get('aa');
    this.renderer = new MaqueteRenderer(gl, aa === 'msaa4' || aa === 'off' ? aa : 'fxaa');
    this.animals = new AnimalHerds(this.renderer);
    this.fx = new MaqueteFx(this.renderer);
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
      if (m.type === 'near') { this.nearAsked.delete(m.key); this.nearArrived.push(m); return; }
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
      this.nearArrived = [];
      this.nearAsked.clear();
      this.asked.clear();
      this.stale.clear();
      for (const k of [...this.renderer.keys()]) { this.renderer.removeChunk(k); this.animals.removeChunk(k); this.fx.setFlames(k, null); this.fx.setVents(k, null); }
    }
    this.hasWorld = true;
    this.worldId++;
    const q = new URLSearchParams(location.search), relief = q.get('relevo');
    const msg: ToMaqueteWorker = { type: 'world', world, id: this.worldId, relief: relief === 'lisa' || relief === 'rampa' || relief === 'degrau' ? relief : 'terraco', stones: q.get('pedras') ?? '', oil: q.get('oleo') ?? '' };
    this.worker.postMessage(msg, [world.height.buffer, world.rgba.buffer, world.cover.buffer, world.state.buffer, world.deposit.buffer, world.ice.buffer, world.temp.buffer, world.volcano.buffer] as ArrayBuffer[]);
  }

  /** Um desenho escondido para o navegador terminar de preparar os programas. */
  warm(width: number, height: number): void {
    this.renderer.warm(width, height);
    this.fx.prepare();
  }

  get ready(): boolean { return this.hasWorld; }

  /** Marca tudo à vista para refazer (medição da recomposição). */
  rebuildAll(): void {
    for (const k of this.renderer.keys()) { this.stale.add(k); this.asked.delete(k); }
    this.rebuilding = new Set(this.stale);
  }
  get pendingRebuild(): number { return this.rebuilding.size; }

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
    const budgetEnd = performance.now() + 3;
    while (n < uploads && this.arrived.length && performance.now() < budgetEnd) {
      const m = this.arrived.shift() as Arrived;
      const w = this.wanted.get(m.key);
      if (!w) { this.rebuilding.delete(m.key); continue; }
      // O pedaço refeito volta a pedir as plantas de perto.
      this.nearAsked.delete(m.key);
      const t0 = performance.now();
      this.rebuilding.delete(m.key);
      this.renderer.setChunk(m.key, m, w.chunk.place, [true, true, true, true], [(w.chunk.cx + 0.5) * CHUNK_CELLS, (w.chunk.cz + 0.5) * CHUNK_CELLS]);
      this.animals.setChunk(m.key, m.animals, m.walkY, m.walkMask);
      this.fx.setFlames(m.key, m.flames);
      this.fx.setVents(m.key, m.vents);
      this.uploadMs.push(performance.now() - t0);
      this.openDirty = true;
      n++;
    }
    this.animals.prepareOne();
    this.updateNear(camera);
    if (this.openDirty) this.updateOpenSides();
    // Com o globo na tela, a sombra já vai sendo desenhada: a maquete crava pronta.
    if (!camera.inMaquete) { this.placeShadow(camera); this.renderer.ensureScene(camera.width, camera.height); this.renderer.stepShadow(5); }
  }

  /** Plantas de perto só nos pedaços perto da câmera: no corte, nenhum precisa delas e sobe muito menos coisa. */
  private updateNear(camera: ViewCamera): void {
    const r = this.renderer;
    if (!camera.inMaquete) return;
    const eye = eyeOf(camera.view);
    const up = this.nearArrived.shift();
    if (up && r.hasChunk(up.key) && r.chunkDistance(up.key, eye) < NEAR_DROP) r.setNear(up.key, up.props);
    for (const w of this.wanted.values()) {
      const key = w.chunk.key;
      if (!r.hasChunk(key)) continue;
      const d = r.chunkDistance(key, eye);
      if (d > NEAR_DROP) { if (r.hasNear(key)) r.dropNear(key); continue; }
      if (d > NEAR_ASK || r.hasNear(key) || this.nearAsked.has(key) || this.inFlight >= 6) continue;
      this.nearAsked.add(key);
      this.inFlight++;
      const msg: ToMaqueteWorker = { type: 'build', key, face: w.chunk.face, cx: w.chunk.cx, cz: w.chunk.cz, gen: this.gen, near: true };
      this.worker.postMessage(msg);
    }
  }

  private placeShadow(camera: ViewCamera): void {
    const r = this.renderer, v = camera.view;
    const radius = Math.min(150, v.distance * 0.72 + 20), step = radius * 0.2;
    const cx = Math.round(v.x / step) * step, cz = Math.round(v.z / step) * step;
    if (Math.abs(cx - r.shadowCenter[0]) > 0.5 || Math.abs(cz - r.shadowCenter[2]) > 0.5 || Math.abs(radius - r.shadowRadius) > radius * 0.1) {
      r.shadowCenter = [cx, 2, cz];
      r.shadowRadius = radius;
      r.markShadowDirty();
    }
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
    for (const k of [...this.renderer.keys()]) if (!this.wanted.has(k)) { this.renderer.removeChunk(k); this.animals.removeChunk(k); this.fx.setFlames(k, null); this.fx.setVents(k, null); }
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

  draw(camera: ViewCamera, width: number, height: number, time: number, paused: boolean): void {
    const r = this.renderer, v = camera.view;
    this.fx.update(time * 1000, camera, paused);
    this.animals.update(time, paused, this.fx.windHere);
    r.batches = [...this.animals.list(), ...this.fx.list()];
    // A sombra anda em passos, para não tremer.
    this.placeShadow(camera);
    // Tremor do terremoto: a câmera balança um pouco, como no globo.
    if (camera.shakeX || camera.shakeY) {
      const k = v.distance / height;
      r.draw({ ...v, x: v.x + camera.shakeX * k, z: v.z + camera.shakeY * k }, width, height, time);
    } else r.draw(v, width, height, time);
  }
}
