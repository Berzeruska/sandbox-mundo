import { seedFrom } from '../core/rng';
import { Clock } from '../core/time';
import { applyBrush } from '../input/tools';
import { buildColors, colorCacheBytes, NO_LAYERS, withRing, type Layers } from '../render/colors';
import { dirtyRects } from '../render/dirty';
import { climateCacheBytes, updateClimate, updateWaterDistance } from '../world/climate';
import type { CellPool } from '../world/cell-pool';
import { createWorld, WORLD_STAGES } from '../world/create';
import { DEFAULT_PLATE_RATE, type Tectonics } from '../world/tectonics';
import { CONTINENTAL_DEPTH, Crust } from '../world/plates';
import { REVEALED_BIT } from '../world/resources';
import { CubeSphere, type Vec3 } from '../world/cubesphere';
import type { WorldState } from '../world/state';
import { emptyWork, type WorkCounters } from '../ui/benchmark';
import { makePatches, transferables, type FromWorker, type ToWorker } from './protocol';
import {
  APPLY_DELAY_TICKS,
  COMPOSED_FIELDS,
  driftStep,
  GeologyEngine,
  worldArrays,
  type BrushDelta,
  type GeologyBuffers,
  type GeologyCommand,
  type GeologyEvent,
  type GeologyInit,
  type GeologyResult,
  type GeologyStats,
} from './geology';
import { packPlates } from './plates-pack';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/**
 * Intervalo mínimo entre mensagens de relógio à tela (ms). A data a 20× muda 240 vezes por segundo,
 * ninguém lê tão rápido; e o desenho das placas adianta os ângulos sozinho entre uma mensagem e
 * outra. Menos mensagens = menos trabalho na thread principal (o celular-alvo só tem 2 núcleos fortes).
 */
export const CLOCK_POST_MS = 100;

/** Etapas da geração vistas pelo jogador e o peso aproximado de cada uma no tempo total. */
export const GENERATION_STAGES: readonly { name: string; weight: number }[] = [
  { name: 'grade', weight: 0.08 },
  ...WORLD_STAGES.map((name) => ({
    name,
    weight: name === 'terreno' ? 0.5 : name === 'clima' ? 0.18 : name === 'placas' ? 0.12 : 0.02,
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
 * Ligação com o motor da geologia (correção 2). No próprio relógio (`LocalGeology`: testes, ou
 * página sem memória compartilhada) ou no ajudante 2 (`worker.ts`). O resultado é o mesmo.
 */
export interface GeologyPort {
  /** Começa um mundo novo no motor. As respostas chegam por `SimulationCore.onGeology*`. */
  start(init: GeologyInit, grid: CubeSphere): void;
  send(cmd: GeologyCommand): void;
  /** Divide com o motor o trabalho por célula da geração (só no ajudante, com memória compartilhada). */
  readonly pool?: CellPool;
  /** Larga o mundo atual na hora (antes de gerar outro): para de trabalhar e solta a memória. */
  stop(): void;
  /** true: o relógio avisa o motor a cada passo (no próprio relógio); false: uma vez por laço. */
  readonly perTick: boolean;
  /** Bytes do motor que não estão no mundo do relógio (para o painel Dados). */
  readonly bytes: number;
}

/** Motor da geologia rodando no próprio relógio (síncrono). */
export class LocalGeology implements GeologyPort {
  readonly perTick = true;
  engine: GeologyEngine | null = null;

  constructor(
    private core: SimulationCore,
    private now: () => number,
  ) {}

  start(init: GeologyInit, grid: CubeSphere): void {
    this.engine = new GeologyEngine(init, grid, (event) => this.core.onGeologyEvent(event), this.now);
    this.core.onGeologyBuffers(this.engine.buffers);
  }

  send(cmd: GeologyCommand): void {
    this.engine?.receive(cmd);
  }

  stop(): void {
    this.engine = null;
  }

  get bytes(): number {
    return this.engine?.bytes ?? 0;
  }
}

/** Composição que o jogador vê: ângulos e velocidades das placas e a deriva naquele momento. */
interface ShownComposition {
  angles: number[];
  speeds: number[];
  drift: number;
}

/**
 * O "cérebro" que roda dentro do Web Worker: guarda o mundo e o relógio, responde a comandos e
 * avisa a thread principal do que mudou. Não sabe que está num worker (recebe mensagens por
 * `handle` e responde por `post`), por isso é testado direto no Vitest.
 *
 * A geologia pesada (recomposição, clima e cores do mundo todo) fica no motor (`geology.ts`); o
 * relógio aplica cada recomposição APPLY_DELAY_TICKS passos depois e nunca passa disso à frente do
 * motor.
 */
export class SimulationCore {
  world: WorldState | null = null;
  colors: Uint8Array = new Uint8Array(0);
  readonly clock = new Clock();
  /** Camadas opcionais ligadas no menu (ex.: "Ver placas"). */
  layers: Layers = NO_LAYERS;
  plateRate = DEFAULT_PLATE_RATE;
  /** Tempo da última recomposição com clima e cores (ms), para o painel Dados. */
  private geologyMs = 0;
  /** Contadores acumulados de trabalho (para o "Medir desempenho"). */
  readonly work: WorkCounters = emptyWork();
  private grid: CubeSphere | null = null;
  private lastPostedTick = -1;
  private lastPostedAt = -Infinity;
  private ticksWindow = { since: 0, ticks: 0, rate: 0 };
  readonly geology: GeologyPort;
  /** Mundo atual (descarta respostas atrasadas do motor sobre um mundo anterior). */
  private worldId = 0;
  private buffers: GeologyBuffers | null = null;
  /** Passo até onde o motor já andou, e recomposições prontas esperando a vez de aparecer. */
  private engineTick = 0;
  private pending: GeologyResult[] = [];
  /** Ponto do referencial da placa que cada célula mostra (para as pinceladas chegarem às placas). */
  private cellRef: Int32Array = new Int32Array(0);
  /** Pinceladas desde a última recomposição aplicada: valem de novo sobre a composição seguinte. */
  private brushLog: { tick: number; delta: BrushDelta }[] = [];
  /** Deriva no relógio (a mesma soma da tectônica) e a composição mostrada, para os ângulos. */
  private drift = 0;
  private shown: ShownComposition = { angles: [], speeds: [], drift: 0 };
  private platesMoving = false;
  private stats: GeologyStats | null = null;
  /** Desde quando o relógio está parado esperando o motor (0: não está). */
  private waitingSince = 0;

  constructor(
    private post: Post,
    private now: () => number = () => performance.now(),
    geology?: (core: SimulationCore) => GeologyPort,
  ) {
    this.geology = geology ? geology(this) : new LocalGeology(this, now);
  }

  /** A tectônica do motor no próprio relógio (testes); no ajudante, null. */
  get tectonics(): Tectonics | null {
    return this.geology instanceof LocalGeology ? (this.geology.engine?.tectonics ?? null) : null;
  }

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
        if (this.world) this.geology.send({ type: 'rate', world: this.worldId, tick: this.clock.tick, rate: this.plateRate });
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
      case 'resetWorst':
        this.work.worstGeology = 0;
        break;
      case 'forceRupture':
        // Racha no passo atual; o mundo rachado aparece APPLY_DELAY_TICKS passos depois.
        if (this.world) this.geology.send({ type: 'rupture', world: this.worldId, tick: this.clock.tick });
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
    this.geology.stop();
    this.buffers = null;
    this.colors = new Uint8Array(0);
    this.worldId++;
    this.pending = [];
    this.brushLog = [];
    this.engineTick = 0;
    this.stats = null;
    stage('grade');
    if (!this.grid || this.grid.n !== n) this.grid = new CubeSphere(n);
    const world = createWorld({ seedText, seed: seedFrom(seedText), n, seaLevel: 0, landFraction: 0.3 }, this.grid, stage, this.geology.pool);
    stage('cores');
    this.world = world;
    this.colors = new Uint8Array(world.cellCount * 4);
    buildColors(world, this.colors, undefined, this.layers);
    this.cellRef = new Int32Array(world.cellCount);
    for (let c = 0; c < world.cellCount; c++) this.cellRef[c] = c;
    stagesMs[current] = this.now() - mark;
    const generationMs = this.now() - t0;
    this.clock.tick = 0;
    this.drift = 0;
    this.platesMoving = false;
    const motion = world.plates.map((p) => {
      const speed = Math.hypot(p.omega[0], p.omega[1], p.omega[2]);
      const axis: Vec3 = speed > 0 ? [p.omega[0] / speed, p.omega[1] / speed, p.omega[2] / speed] : [0, 1, 0];
      return { axis, speed, center: [p.center[0], p.center[1], p.center[2]] as Vec3 };
    });
    this.shown = { angles: motion.map(() => 0), speeds: motion.map((m) => m.speed), drift: 0 };
    // O motor da geologia começa com o mundo recém-gerado; a tectônica nasce no primeiro passo
    // com placas ligadas.
    this.geology.start(
      { world: this.worldId, params: world.params, plates: world.plates, arrays: worldArrays(world), rate: this.plateRate, layers: this.layers },
      this.grid,
    );
    this.send({
      type: 'world',
      info: {
        n,
        cellCount: world.cellCount,
        seedText,
        seed: world.params.seed,
        generationMs,
        stagesMs,
        helperShare: this.geology.pool?.helperShare ?? 0,
        landCenter: landCenter(world),
        plates: motion,
      },
      // Cópia: o worker continua com as próprias cores; a cópia vai transferida.
      colors: this.colors.slice(),
      plateCells: packPlates(world),
      deposits: world.deposit.slice(),
    });
    this.postClock(true);
  }

  /** O motor informou onde estão os buffers do mundo atual. */
  onGeologyBuffers(buffers: GeologyBuffers): void {
    if (buffers.world === this.worldId) this.buffers = buffers;
  }

  /** Resposta do motor: andou até um passo, ou terminou uma recomposição. */
  onGeologyEvent(event: GeologyEvent): void {
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'progress') {
      if (event.world === this.worldId) this.engineTick = Math.max(this.engineTick, event.tick);
      return;
    }
    if (event.result.world === this.worldId) this.pending.push(event.result);
  }

  private brush(msg: Extract<ToWorker, { type: 'brush' }>): void {
    const world = this.world;
    if (!world) return;
    const t0 = this.now();
    const { region, revealed } = applyBrush(world, msg.tool, msg.point, msg.radius, msg.dt);
    const revealedSet = new Set(revealed);
    // A pincelada fica gravada na placa: anda junto quando ela se mover. Vai para o motor com o passo
    // em que aconteceu e fica guardada até a próxima recomposição aparecer (que ainda não a tem).
    const count = region.length;
    const delta: BrushDelta = {
      cells: Int32Array.from(region),
      plate: new Uint8Array(count),
      ref: new Int32Array(count),
      elevation: new Float32Array(count),
      crust: new Uint8Array(count),
      iceMode: new Uint8Array(count),
      reveal: new Uint8Array(count),
    };
    for (let k = 0; k < count; k++) {
      const c = region[k] as number;
      world.crust[c] = world.heightAboveSea(c) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic;
      delta.plate[k] = world.plate[c] as number;
      delta.ref[k] = this.cellRef[c] as number;
      delta.elevation[k] = world.elevation[c] as number;
      delta.crust[k] = world.crust[c] as number;
      delta.iceMode[k] = world.iceMode[c] as number;
      delta.reveal[k] = revealedSet.has(c) ? 1 : 0;
    }
    this.brushLog.push({ tick: this.clock.tick, delta });
    this.geology.send({ type: 'brush', world: this.worldId, tick: this.clock.tick, delta });
    const painted = withRing(world.grid, region);
    buildColors(world, this.colors, painted, this.layers);
    const patches = makePatches(this.colors, world.params.n, dirtyRects(world.grid, painted));
    // Petróleo revelado: a tela recebe as jazidas de novo (raro: só quando o Rebaixar acha petróleo).
    const brushMs = this.now() - t0;
    this.send(revealed.length ? { type: 'patch', patches, brushMs, deposits: world.deposit.slice() } : { type: 'patch', patches, brushMs });
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

  /**
   * A recomposição feita no passo `r.tick` aparece agora: copia o mundo do motor, refaz por cima as
   * pinceladas que vieram depois dela e manda tudo à tela.
   */
  private applyResult(r: GeologyResult): void {
    const world = this.world;
    const buffers = this.buffers;
    if (!world || !buffers) return;
    const t0 = this.now();
    for (const k of COMPOSED_FIELDS) world[k].set(buffers.arrays[k]);
    this.colors.set(buffers.colors);
    this.cellRef.set(buffers.cellRef);
    world.plates = r.plates;
    this.shown = { angles: r.angles, speeds: r.motion.map((m) => m.speed), drift: r.drift };
    this.platesMoving = true;
    // Os buffers do motor estão livres para a próxima recomposição.
    this.geology.send({ type: 'consumed', world: this.worldId, index: r.index });
    this.brushLog = this.brushLog.filter((b) => b.tick >= r.tick);
    if (this.brushLog.length) this.replayBrushes(world);
    const n = world.params.n;
    const faces = [0, 1, 2, 3, 4, 5].map((face) => ({ face, x0: 0, y0: 0, x1: n - 1, y1: n - 1 }));
    this.send({ type: 'recomposed', patches: makePatches(this.colors, n, faces), plateCells: r.plateCells, angles: r.angles, plates: r.motion, deposits: world.deposit.slice() });
    const w = this.work;
    w.plates += r.platesMs;
    w.climate += r.climateMs;
    w.colors += r.colorsMs;
    const applyMs = this.now() - t0;
    w.send += applyMs;
    w.recompositions++;
    this.geologyMs = r.platesMs + r.climateMs + r.colorsMs + applyMs;
    w.worstGeology = Math.max(w.worstGeology, this.geologyMs);
    this.stats = r.stats;
  }

  /** Pinceladas feitas depois da recomposição que acabou de aparecer: valem de novo sobre ela. */
  private replayBrushes(world: WorldState): void {
    const n = world.cellCount;
    const shown = new Map<number, { elevation: number; crust: number; reveal: number }>();
    const region = new Set<number>();
    for (const { delta } of this.brushLog) {
      for (let k = 0; k < delta.cells.length; k++) {
        const key = (delta.plate[k] as number) * n + (delta.ref[k] as number);
        const reveal = (delta.reveal[k] as number) | (shown.get(key)?.reveal ?? 0);
        shown.set(key, { elevation: delta.elevation[k] as number, crust: delta.crust[k] as number, reveal });
        world.iceMode[delta.cells[k] as number] = delta.iceMode[k] as number;
        region.add(delta.cells[k] as number);
      }
    }
    for (let c = 0; c < n; c++) {
      const ref = this.cellRef[c] as number;
      if (ref < 0) continue;
      const hit = shown.get((world.plate[c] as number) * n + ref);
      if (!hit) continue;
      world.elevation[c] = hit.elevation;
      world.crust[c] = hit.crust;
      if (hit.reveal && world.deposit[c]) world.deposit[c] = (world.deposit[c] as number) | REVEALED_BIT;
      region.add(c);
    }
    const cells = [...region];
    updateWaterDistance(world, cells);
    updateClimate(world, cells);
    buildColors(world, this.colors, withRing(world.grid, cells), this.layers);
  }

  /** Liga/desliga camadas: repinta o mundo todo e manda as 6 faces como remendos. */
  private setLayers(layers: Layers): void {
    this.layers = layers;
    if (this.world) this.geology.send({ type: 'layers', world: this.worldId, layers });
    this.sendAllColors();
  }

  private query(id: number, point: Vec3): void {
    const world = this.world;
    if (!world) return;
    const c = world.grid.pointToCell(point[0], point[1], point[2]);
    this.send({
      type: 'query',
      id,
      cell: { elevation: world.elevation[c] as number, biome: world.biome[c] as number, water: world.isWater(c), ice: world.ice[c] === 1, deposit: depositNear(world, c) },
    });
  }

  /** Memória aproximada da simulação (bytes): mundo, grade, caches, cores e o motor da geologia. */
  memoryBytes(): number {
    const caches = this.grid ? climateCacheBytes(this.grid) + colorCacheBytes(this.grid) : 0;
    return typedBytes(this.world) + typedBytes(this.grid) + caches + this.colors.byteLength + this.cellRef.byteLength + this.geology.bytes;
  }

  /** Avança o relógio pelo tempo real `dt` (segundos). Chamado pelo laço do worker. */
  advance(dt: number): void {
    const start = this.now();
    let blocked = false;
    const ran = this.clock.advance(
      dt,
      (tick) => this.stepTick(tick),
      this.now,
      // Nunca mais que APPLY_DELAY_TICKS passos à frente do motor: assim toda recomposição que
      // deve aparecer já chegou. Se o motor atrasar, o relógio espera (o resultado não muda).
      (next) => {
        const ok = !this.world || next <= this.engineTick + APPLY_DELAY_TICKS;
        if (!ok) blocked = true;
        return ok;
      },
    );
    // Tempo parado esperando o motor (para o "Medir desempenho": o celular acompanha?).
    if (ran > 0 && this.waitingSince) {
      this.work.waitMs += start - this.waitingSince;
      this.waitingSince = 0;
    }
    if (blocked && !this.waitingSince) this.waitingSince = this.now();
    if (ran && this.world && !this.geology.perTick) this.geology.send({ type: 'advance', world: this.worldId, tick: this.clock.tick });
    const w = this.ticksWindow;
    const t = this.now();
    if (!w.since) w.since = t;
    w.ticks += ran;
    this.work.ticks += ran;
    this.work.ms += t - start;
    if (t - w.since >= 500) {
      w.rate = (w.ticks * 1000) / (t - w.since);
      w.ticks = 0;
      w.since = t;
    }
    this.postClock(false);
  }

  private stepTick(tick: number): void {
    if (!this.world) return;
    if (this.plateRate > 0) {
      this.drift += driftStep(this.plateRate);
      this.platesMoving = true;
    }
    if (this.geology.perTick) this.geology.send({ type: 'advance', world: this.worldId, tick });
    while (this.pending.length && (this.pending[0] as GeologyResult).tick + APPLY_DELAY_TICKS <= tick) {
      this.applyResult(this.pending.shift() as GeologyResult);
    }
  }

  /** Ângulo atual de cada placa (para o desenho), a partir da composição mostrada. */
  private currentAngles(): number[] {
    if (!this.platesMoving) return [];
    const { angles, speeds, drift } = this.shown;
    return angles.map((a, p) => a + (speeds[p] as number) * (this.drift - drift));
  }

  /**
   * O laço do relógio precisa rodar? Só com mundo e tempo correndo; parado, o worker dorme até a
   * próxima mensagem (não acorda 60 vezes por segundo à toa num núcleo que a tela quer usar).
   */
  get running(): boolean {
    return this.world !== null && this.clock.speed !== 0;
  }

  /**
   * Avisa o relógio quando o calendário mudou, no máximo a cada CLOCK_POST_MS (`force`: já, ex.:
   * mudou a velocidade ou nasceu um mundo).
   */
  private postClock(force: boolean): void {
    if (!force && this.clock.tick === this.lastPostedTick) return;
    const t = this.now();
    if (!force && t - this.lastPostedAt < CLOCK_POST_MS) return;
    this.lastPostedAt = t;
    this.lastPostedTick = this.clock.tick;
    this.work.clockMessages++;
    const s = this.stats;
    if (s) {
      this.work.welds = s.welds;
      this.work.fragments = s.fragments;
      this.work.ruptures = s.ruptures;
      this.work.supercontinents = s.supercontinents;
      this.work.cyclePhase = s.cyclePhase;
    }
    this.send({
      type: 'clock',
      tick: this.clock.tick,
      speed: this.clock.speed,
      ticksPerSecond: this.ticksWindow.rate,
      geologyMs: this.geologyMs,
      memoryMb: this.memoryBytes() / 1e6,
      angles: this.currentAngles(),
      work: { ...this.work },
    });
  }
}

export { packPlates };

/** Bytes dos arrays tipados de um objeto (só os campos próprios, um nível). */
function typedBytes(obj: object | null | undefined): number {
  if (!obj) return 0;
  let total = 0;
  for (const v of Object.values(obj)) if (ArrayBuffer.isView(v)) total += v.byteLength;
  return total;
}

/**
 * Jazida na célula tocada ou, se não houver, numa vizinha (o dedo não acerta uma célula de perto
 * nem com as placas andando entre recomposições). 0 = nenhuma.
 */
export function depositNear(world: WorldState, c: number): number {
  if (world.deposit[c]) return world.deposit[c] as number;
  const { neighbors } = world.grid;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[c * 4 + d] as number;
    if (world.deposit[j]) return world.deposit[j] as number;
  }
  return 0;
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
