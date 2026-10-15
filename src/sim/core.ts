import { seedFrom } from '../core/rng';
import { Clock } from '../core/time';
import { applyBrush } from '../input/tools';
import { buildColors } from '../render/colors';
import { dirtyRects } from '../render/dirty';
import { createWorld } from '../world/create';
import { CubeSphere, type Vec3 } from '../world/cubesphere';
import type { WorldState } from '../world/state';
import { makePatches, transferables, type FromWorker, type ToWorker } from './protocol';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/**
 * O "cérebro" que roda dentro do Web Worker: guarda o mundo e o relógio, responde a comandos e
 * avisa a thread principal do que mudou. Não sabe que está num worker (recebe mensagens por
 * `handle` e responde por `post`), por isso é testado direto no Vitest.
 */
export class SimulationCore {
  world: WorldState | null = null;
  colors: Uint8Array = new Uint8Array(0);
  readonly clock = new Clock();
  private grid: CubeSphere | null = null;
  private lastPostedTick = -1;
  private ticksWindow = { since: 0, ticks: 0, rate: 0 };

  constructor(
    private post: Post,
    private now: () => number = () => performance.now(),
  ) {}

  private send(msg: FromWorker): void {
    this.post(msg, transferables(msg));
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'newWorld':
        this.newWorld(msg.seedText, msg.n);
        break;
      case 'brush':
        this.brush(msg);
        break;
      case 'speed':
        this.clock.speed = msg.speed;
        this.postClock(true);
        break;
      case 'query':
        this.query(msg.id, msg.point);
        break;
    }
  }

  private newWorld(seedText: string, n: number): void {
    if (!this.grid || this.grid.n !== n) this.grid = new CubeSphere(n);
    const t0 = this.now();
    const world = createWorld({ seedText, seed: seedFrom(seedText), n, seaLevel: 0, landFraction: 0.3 }, this.grid);
    const generationMs = this.now() - t0;
    this.world = world;
    this.colors = new Uint8Array(world.cellCount * 4);
    buildColors(world, this.colors);
    this.clock.tick = 0;
    this.send({
      type: 'world',
      info: {
        n,
        cellCount: world.cellCount,
        seedText,
        seed: world.params.seed,
        generationMs,
        landCenter: landCenter(world),
      },
      // Cópia: o worker continua com as próprias cores; a cópia vai transferida.
      colors: this.colors.slice(),
    });
    this.postClock(true);
  }

  private brush(msg: Extract<ToWorker, { type: 'brush' }>): void {
    const world = this.world;
    if (!world) return;
    const t0 = this.now();
    const { region } = applyBrush(world, msg.tool, msg.point, msg.radius, msg.dt);
    buildColors(world, this.colors, region);
    const patches = makePatches(this.colors, world.params.n, dirtyRects(world.grid, region));
    this.send({ type: 'patch', patches, brushMs: this.now() - t0 });
  }

  private query(id: number, point: Vec3): void {
    const world = this.world;
    if (!world) return;
    const c = world.grid.pointToCell(point[0], point[1], point[2]);
    this.send({
      type: 'query',
      id,
      cell: { elevation: world.elevation[c] as number, biome: world.biome[c] as number, water: world.isWater(c), ice: world.ice[c] === 1 },
    });
  }

  /** Avança o relógio pelo tempo real `dt` (segundos). Chamado pelo laço do worker. */
  advance(dt: number): void {
    const ran = this.clock.advance(dt, undefined, this.now);
    const w = this.ticksWindow;
    const t = this.now();
    if (!w.since) w.since = t;
    w.ticks += ran;
    if (t - w.since >= 500) {
      w.rate = (w.ticks * 1000) / (t - w.since);
      w.ticks = 0;
      w.since = t;
    }
    this.postClock(false);
  }

  /** Avisa o relógio quando o calendário mudou (no máximo uma vez por chamada). */
  private postClock(force: boolean): void {
    if (!force && this.clock.tick === this.lastPostedTick) return;
    this.lastPostedTick = this.clock.tick;
    this.send({ type: 'clock', tick: this.clock.tick, speed: this.clock.speed, ticksPerSecond: this.ticksWindow.rate });
  }
}

/** Direção média da terra firme: onde a câmera começa olhando. */
export function landCenter(world: WorldState): Vec3 {
  const { positions } = world.grid;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < world.cellCount; i++) {
    if (world.isWater(i)) continue;
    x += positions[i * 3] as number;
    y += positions[i * 3 + 1] as number;
    z += positions[i * 3 + 2] as number;
  }
  const len = Math.hypot(x, y, z);
  return len > 1e-9 ? [x / len, y / len, z / len] : [0, 0, 1];
}
