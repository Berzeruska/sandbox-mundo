import { seedFrom } from '../core/rng';
import { Clock } from '../core/time';
import { applyBrush } from '../input/tools';
import { buildColors, colorCacheBytes, NO_LAYERS, type Layers } from '../render/colors';
import { dirtyRects } from '../render/dirty';
import { climateCacheBytes, computeWaterDistance, updateClimate } from '../world/climate';
import { createWorld, WORLD_STAGES } from '../world/create';
import { DEFAULT_PLATE_RATE, Tectonics } from '../world/tectonics';
import { Crust } from '../world/plates';
import { NEAR_BOUNDARY_CELLS, packPlateCell } from '../render/plate-motion';
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
  /** Movimento das placas do mundo atual e o controle "Placas" (0 a 1). */
  tectonics: Tectonics | null = null;
  plateRate = DEFAULT_PLATE_RATE;
  /** Tempo da última recomposição com clima e cores (ms), para o painel Dados. */
  private geologyMs = 0;
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
      case 'plateRate':
        this.plateRate = Math.max(0, Math.min(1, msg.rate));
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
    // Solta o mundo antigo antes de gerar o novo: no celular, ter os dois na memória ao mesmo
    // tempo força o coletor de lixo e deixa a geração bem mais lenta.
    this.world = null;
    this.tectonics = null;
    this.colors = new Uint8Array(0);
    stage('grade');
    if (!this.grid || this.grid.n !== n) this.grid = new CubeSphere(n);
    const world = createWorld({ seedText, seed: seedFrom(seedText), n, seaLevel: 0, landFraction: 0.3 }, this.grid, stage);
    stage('cores');
    this.world = world;
    // A tectônica é montada no primeiro passo do relógio (depois que o globo já apareceu).
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
        plates: world.plates.map((p) => {
          const speed = Math.hypot(p.omega[0], p.omega[1], p.omega[2]);
          const axis: Vec3 = speed > 0 ? [p.omega[0] / speed, p.omega[1] / speed, p.omega[2] / speed] : [0, 1, 0];
          return { axis, speed, center: [p.center[0], p.center[1], p.center[2]] as Vec3 };
        }),
      },
      // Cópia: o worker continua com as próprias cores; a cópia vai transferida.
      colors: this.colors.slice(),
      plateCells: packPlates(world),
    });
    this.postClock(true);
  }

  private brush(msg: Extract<ToWorker, { type: 'brush' }>): void {
    const world = this.world;
    if (!world) return;
    const t0 = this.now();
    const { region } = applyBrush(world, msg.tool, msg.point, msg.radius, msg.dt);
    // A pincelada fica gravada na placa: anda junto quando ela se mover.
    this.tectonics?.syncCells(region);
    buildColors(world, this.colors, region, this.layers);
    const patches = makePatches(this.colors, world.params.n, dirtyRects(world.grid, region));
    this.send({ type: 'patch', patches, brushMs: this.now() - t0 });
  }

  /** Repinta o mundo todo e manda as 6 faces como remendos (brushMs -1: não é pincelada). */
  private sendAllColors(): void {
    const world = this.world;
    if (!world) return;
    buildColors(world, this.colors, undefined, this.layers);
    const n = world.params.n;
    const faces = [0, 1, 2, 3, 4, 5].map((face) => ({ face, x0: 0, y0: 0, x1: n - 1, y1: n - 1 }));
    this.send({ type: 'patch', patches: makePatches(this.colors, n, faces), brushMs: -1 });
  }

  /** Depois que as placas se moveram: clima, biomas e cores do mundo todo, com os ângulos. */
  private afterRecompose(t0: number): void {
    const world = this.world;
    const tectonics = this.tectonics;
    if (!world || !tectonics) return;
    computeWaterDistance(world);
    updateClimate(world);
    buildColors(world, this.colors, undefined, this.layers);
    const n = world.params.n;
    const faces = [0, 1, 2, 3, 4, 5].map((face) => ({ face, x0: 0, y0: 0, x1: n - 1, y1: n - 1 }));
    this.geologyMs = this.now() - t0;
    this.send({
      type: 'recomposed',
      patches: makePatches(this.colors, n, faces),
      plateCells: packPlates(world),
      angles: Array.from(tectonics.angle),
    });
  }

  /** Liga/desliga camadas: repinta o mundo todo e manda as 6 faces como remendos. */
  private setLayers(layers: Layers): void {
    this.layers = layers;
    this.sendAllColors();
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

  /** Memória aproximada do worker (bytes): mundo, grade, tectônica e cores. */
  memoryBytes(): number {
    const caches = this.grid ? climateCacheBytes(this.grid) + colorCacheBytes(this.grid) : 0;
    return typedBytes(this.world) + typedBytes(this.grid) + caches + (this.tectonics?.bytes ?? 0) + this.colors.byteLength;
  }

  /** Avança o relógio pelo tempo real `dt` (segundos). Chamado pelo laço do worker. */
  advance(dt: number): void {
    // Cada passo move as placas; a recomposição acontece no passo exato em que elas andaram o
    // bastante (contado em passos, não em tempo real: o resultado não depende do aparelho).
    const ran = this.clock.advance(
      dt,
      () => {
        if (!this.world || this.plateRate <= 0) return;
        this.tectonics ??= new Tectonics(this.world);
        const t0 = this.now();
        if (this.tectonics.step(this.plateRate)) this.afterRecompose(t0);
      },
      this.now,
    );
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
    this.send({
      type: 'clock',
      tick: this.clock.tick,
      speed: this.clock.speed,
      ticksPerSecond: this.ticksWindow.rate,
      geologyMs: this.geologyMs,
      recompositions: this.tectonics?.recompositions ?? 0,
      memoryMb: this.memoryBytes() / 1e6,
      angles: this.tectonics ? Array.from(this.tectonics.angle) : [],
    });
  }
}

/** Placa de cada célula e crosta continental, no formato da textura de placas do shader. */
export function packPlates(world: WorldState): Uint8Array {
  const n = world.cellCount;
  const { neighbors } = world.grid;
  // Perto de fronteira: até NEAR_BOUNDARY_CELLS passos de uma célula com vizinha de outra placa.
  const near = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 4; d++) {
      if (world.plate[neighbors[i * 4 + d] as number] !== world.plate[i]) {
        near[i] = 1;
        frontier.push(i);
        break;
      }
    }
  }
  for (let step = 0; step < NEAR_BOUNDARY_CELLS && frontier.length; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        if (!near[nb]) {
          near[nb] = 1;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = packPlateCell(world.plate[i] as number, world.crust[i] === Crust.Continental, near[i] === 1);
  }
  return out;
}

/** Bytes dos arrays tipados de um objeto (só os campos próprios, um nível). */
function typedBytes(obj: object | null | undefined): number {
  if (!obj) return 0;
  let total = 0;
  for (const v of Object.values(obj)) if (ArrayBuffer.isView(v)) total += v.byteLength;
  return total;
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
