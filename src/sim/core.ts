import { seedFrom } from '../core/rng';
import { Clock } from '../core/time';
import { applyBrush } from '../input/tools';
import { buildColors, NO_LAYERS, type Layers } from '../render/colors';
import { dirtyRects } from '../render/dirty';
import { createWorld, WORLD_STAGES } from '../world/create';
import { CubeSphere, type Vec3 } from '../world/cubesphere';
import type { WorldState } from '../world/state';
import { makePatches, transferables, type FromWorker, type ToWorker } from './protocol';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/** Etapas da geração vistas pelo jogador e o peso aproximado de cada uma no tempo total. */
export const GENERATION_STAGES: readonly { name: string; weight: number }[] = [
  { name: 'grade', weight: 0.08 },
  ...WORLD_STAGES.map((name) => ({
    name,
    weight: name === 'terreno' ? 0.52 : name === 'clima' ? 0.18 : name === 'placas' ? 0.12 : 0.02,
  })),
  { name: 'cores', weight: 0.08 },
];

/** Fração total concluída, dada a etapa atual e quanto dela já foi feito. */
export function overallProgress(stage: string, fraction: number): number {
  let done = 0;
  for (const s of GENERATION_STAGES) {
    if (s.name === stage) return Math.min(1, done + s.weight * fraction);
    done += s.weight;
  }
  return done;
}

/**
 * O "cérebro" que roda dentro do Web Worker: guarda o mundo e o relógio, responde a comandos e
 * avisa a thread principal do que mudou. Não sabe que está num worker (recebe mensagens por
 * `handle` e responde por `post`), por isso é testado direto no Vitest.
 */
export class SimulationCore {
  world: WorldState | null = null;
  colors: Uint8Array = new Uint8Array(0);
  readonly clock = new Clock();
  /** Camadas opcionais ligadas no menu (ex.: "Ver placas"). */
  layers: Layers = NO_LAYERS;
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
      case 'layers':
        this.setLayers(msg.layers);
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
    const t0 = this.now();
    const stagesMs: Record<string, number> = {};
    let current = '';
    let mark = t0;
    const stage = (name: string, fraction = 0): void => {
      if (name !== current) {
        const t = this.now();
        if (current) stagesMs[current] = t - mark;
        current = name;
        mark = t;
      }
      this.send({ type: 'progress', stage: name, fraction: overallProgress(name, fraction) });
    };
    stage('grade');
    if (!this.grid || this.grid.n !== n) this.grid = new CubeSphere(n);
    const world = createWorld({ seedText, seed: seedFrom(seedText), n, seaLevel: 0, landFraction: 0.3 }, this.grid, stage);
    stage('cores');
    this.world = world;
    this.colors = new Uint8Array(world.cellCount * 4);
    buildColors(world, this.colors, undefined, this.layers);
    stagesMs[current] = this.now() - mark;
    const generationMs = this.now() - t0;
    this.clock.tick = 0;
    this.send({
      type: 'world',
      info: {
        n,
        cellCount: world.cellCount,
        seedText,
        seed: world.params.seed,
        generationMs,
        stagesMs,
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
    buildColors(world, this.colors, region, this.layers);
    const patches = makePatches(this.colors, world.params.n, dirtyRects(world.grid, region));
    this.send({ type: 'patch', patches, brushMs: this.now() - t0 });
  }

  /** Liga/desliga camadas: repinta o mundo todo e manda as 6 faces como remendos. */
  private setLayers(layers: Layers): void {
    this.layers = layers;
    const world = this.world;
    if (!world) return;
    buildColors(world, this.colors, undefined, layers);
    const n = world.params.n;
    const faces = [0, 1, 2, 3, 4, 5].map((face) => ({ face, x0: 0, y0: 0, x1: n - 1, y1: n - 1 }));
    // brushMs = -1: não é pincelada (não entra no tempo do pincel do painel Dados).
    this.send({ type: 'patch', patches: makePatches(this.colors, n, faces), brushMs: -1 });
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
