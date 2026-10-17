import { newArray } from '../core/shared';
import { buildColors, NO_LAYERS, type Layers } from '../render/colors';
import { computeWaterDistance, updateClimate } from '../world/climate';
import type { CellsRequest } from '../world/cell-pool';
import type { CubeSphere } from '../world/cubesphere';
import type { Plate } from '../world/plates';
import { DepositFormation, REVEALED_BIT } from '../world/resources';
import { DEFAULT_PLATE_RATE, MAX_PLATE_RATE, Tectonics } from '../world/tectonics';
import { WorldState, type WorldParams } from '../world/state';
import type { PlateMotionInfo } from './protocol';
import { packPlates } from './plates-pack';

/**
 * Ajudante 2 "Terra" (correção 2; plano em `docs/01-arquitetura.md`): a recomposição das placas, o
 * clima e as cores do mundo todo saem do relógio.
 *
 * Regra que mantém o jogo determinístico: o motor da geologia anda pelos mesmos passos do relógio,
 * na ordem dos comandos (cada comando leva o passo em que aconteceu). Uma recomposição feita no passo
 * T vale para o mundo visto pelo jogador no passo T + APPLY_DELAY_TICKS, nem antes nem depois. Se o
 * ajudante não terminou até lá, o relógio espera; se terminou, o tempo não para. O resultado é o mesmo
 * com o motor no ajudante ou no próprio relógio (testes, ou página sem memória compartilhada).
 */

/**
 * Passos entre a recomposição e o mundo novo aparecer. 480 passos = 40 anos = 2 s reais a 20×: dá
 * folga a uma recomposição de ~1–1,3 s num núcleo forte do Hot 50i. Com placas a 100%, o desenho
 * desliza as placas por até ~3 células (2 entre recomposições + ~1 de espera), dentro do alcance do
 * shader (NEAR_REACH_CELLS = 3,5).
 */
export const APPLY_DELAY_TICKS = 480;

/** Arrays do mundo que mudam numa recomposição e são copiados para o mundo do relógio. */
export const COMPOSED_FIELDS = [
  'elevation',
  'temperature',
  'precipitation',
  'biome',
  'ice',
  'plate',
  'crust',
  'boundary',
  'waterDistance',
  'deposit',
] as const;
/** Arrays do mundo enviados na criação do motor (o resto nasce na geração e não muda). */
export const WORLD_FIELDS = [...COMPOSED_FIELDS, 'iceMode', 'tempNoise', 'rainNoise'] as const;
export type WorldField = (typeof WORLD_FIELDS)[number];
export type WorldArrays = Record<WorldField, Float32Array | Uint8Array | Uint16Array>;

/**
 * Pincelada vista pelo motor: para cada célula da região, a placa e o ponto do referencial dela que a
 * célula mostrava, e a altura, a crosta e o gelo pintado que ficaram.
 */
export interface BrushDelta {
  cells: Int32Array;
  plate: Uint8Array;
  ref: Int32Array;
  elevation: Float32Array;
  crust: Uint8Array;
  iceMode: Uint8Array;
  /** 1 = esta pincelada (Rebaixar) revelou o petróleo da célula (T6). */
  reveal: Uint8Array;
}

/** Tudo de que o motor precisa para começar num mundo recém-gerado. */
export interface GeologyInit {
  world: number;
  params: WorldParams;
  plates: Plate[];
  arrays: WorldArrays;
  rate: number;
  layers: Layers;
}

/** Comandos para o motor. `world` descarta o que for de um mundo anterior. */
export type GeologyCommand =
  | { type: 'advance'; world: number; tick: number }
  | { type: 'rate'; world: number; tick: number; rate: number }
  | { type: 'brush'; world: number; tick: number; delta: BrushDelta }
  | { type: 'rupture'; world: number; tick: number }
  | { type: 'layers'; world: number; layers: Layers }
  | { type: 'consumed'; world: number; index: number };

/** Uma recomposição pronta. Os arrays do mundo, as cores e os pontos de referência estão no motor. */
export interface GeologyResult {
  world: number;
  index: number;
  /** Passo do relógio em que a recomposição aconteceu (aparece em tick + APPLY_DELAY_TICKS). */
  tick: number;
  /** Ângulos das placas e deriva na recomposição; eixo, velocidade e centro de cada placa. */
  angles: number[];
  drift: number;
  motion: PlateMotionInfo[];
  plates: Plate[];
  plateCells: Uint8Array;
  /** Tempo de trabalho (ms): placas, clima e cores. */
  platesMs: number;
  climateMs: number;
  colorsMs: number;
  stats: GeologyStats;
}

export interface GeologyStats {
  welds: number;
  fragments: number;
  /** Jazidas formadas durante a deriva até agora (T6). */
  depositsFormed: number;
  ruptures: number;
  supercontinents: number;
  /** 1 dispersão, 2 montagem, 3 supercontinente. */
  cyclePhase: number;
  recompositions: number;
  /** Memória do motor (mundo de trabalho, cores, tectônica), em bytes. */
  engineBytes: number;
}

/** Mensagens do relógio para o ajudante 2. */
export type HelperRequest =
  | {
      type: 'init';
      init: GeologyInit;
      /** Grade e tabelas fixas, em memória compartilhada (o ajudante usa sem copiar). */
      grid: { n: number; positions: Float32Array; neighbors: Int32Array };
      upwind: Int32Array;
      shade: Float32Array;
    }
  | { type: 'command'; cmd: GeologyCommand }
  /** Pedaços da geração de um mundo novo (`cell-pool.ts`). */
  | CellsRequest;

/** Mensagens do ajudante 2 para o relógio: os buffers do mundo novo, ou um evento do motor. */
export type HelperReply = { type: 'ready'; buffers: GeologyBuffers } | GeologyEvent;

/** O que o motor manda de volta. */
export type GeologyEvent =
  | { type: 'progress'; world: number; tick: number }
  | { type: 'result'; result: GeologyResult }
  | { type: 'error'; message: string; stack?: string };

/** Buffers do motor que o relógio lê ao aplicar uma recomposição (compartilhados no ajudante). */
export interface GeologyBuffers {
  world: number;
  arrays: Pick<WorldArrays, (typeof COMPOSED_FIELDS)[number]>;
  colors: Uint8Array;
  cellRef: Int32Array;
}

/** Copia os arrays de um mundo (para mandar ao motor). */
export function worldArrays(world: WorldState): WorldArrays {
  const out = {} as WorldArrays;
  for (const k of WORLD_FIELDS) out[k] = world[k];
  return out;
}

/** Leitura da fase do ciclo em número (para os contadores). */
function phaseNumber(phase: string): number {
  return phase === 'dispersal' ? 1 : phase === 'assembly' ? 2 : 3;
}

/**
 * O motor da geologia. Recebe comandos na ordem em que aconteceram e anda os passos até o último
 * passo conhecido do relógio. Para (sem perder nada) quando precisa recompor e a recomposição
 * anterior ainda não foi aplicada pelo relógio: os buffers dela ainda estão em uso.
 */
export class GeologyEngine {
  readonly world: WorldState;
  readonly worldId: number;
  tectonics: Tectonics | null = null;
  /** Jazidas que nascem durante a deriva (T6). */
  readonly formation: DepositFormation;
  readonly colors: Uint8Array;
  readonly cellRef: Int32Array;
  /** Passos já processados (o mesmo relógio do jogo). */
  tick = 0;
  private target = 0;
  private rate: number;
  private layers: Layers;
  private queue: GeologyCommand[] = [];
  private nextIndex = 0;
  /** Índice da recomposição entregue e ainda não aplicada pelo relógio (-1: nenhuma). */
  private unconsumed = -1;
  private lastProgress = -1;

  constructor(
    init: GeologyInit,
    grid: CubeSphere,
    private emit: (event: GeologyEvent, transfer?: ArrayBuffer[]) => void,
    private now: () => number = () => performance.now(),
  ) {
    this.worldId = init.world;
    const world = new WorldState(init.params, grid);
    for (const k of WORLD_FIELDS) world[k].set(init.arrays[k]);
    world.plates = init.plates.map((p) => ({ ...p, seed: [...p.seed], center: [...p.center], omega: [...p.omega] }) as Plate);
    this.world = world;
    this.rate = init.rate;
    this.layers = init.layers;
    this.formation = new DepositFormation(init.params.seed);
    this.colors = newArray(Uint8Array, world.cellCount * 4);
    this.cellRef = newArray(Int32Array, world.cellCount);
    for (let c = 0; c < world.cellCount; c++) this.cellRef[c] = c;
  }

  /** Buffers que o relógio lê ao aplicar uma recomposição. */
  get buffers(): GeologyBuffers {
    const arrays = {} as GeologyBuffers['arrays'];
    const w = this.world;
    arrays.elevation = w.elevation;
    arrays.temperature = w.temperature;
    arrays.precipitation = w.precipitation;
    arrays.biome = w.biome;
    arrays.ice = w.ice;
    arrays.plate = w.plate;
    arrays.crust = w.crust;
    arrays.boundary = w.boundary;
    arrays.waterDistance = w.waterDistance;
    arrays.deposit = w.deposit;
    return { world: this.worldId, arrays, colors: this.colors, cellRef: this.cellRef };
  }

  /** Bytes próprios do motor (mundo de trabalho, cores, referências e tectônica). */
  get bytes(): number {
    let total = this.colors.byteLength + this.cellRef.byteLength + (this.tectonics?.bytes ?? 0);
    for (const k of WORLD_FIELDS) total += this.world[k].byteLength;
    return total;
  }

  receive(cmd: GeologyCommand): void {
    if (cmd.world !== this.worldId) return;
    switch (cmd.type) {
      case 'advance':
        this.target = Math.max(this.target, cmd.tick);
        break;
      case 'layers':
        this.layers = cmd.layers;
        return;
      case 'consumed':
        if (cmd.index === this.unconsumed) this.unconsumed = -1;
        break;
      default:
        this.queue.push(cmd);
        this.target = Math.max(this.target, cmd.tick);
    }
    this.process();
  }

  /** Anda até o próximo comando (ou até o passo do relógio), aplica, repete. */
  private process(): void {
    for (;;) {
      const cmd = this.queue[0];
      const until = cmd && 'tick' in cmd ? cmd.tick : this.target;
      while (this.tick < until) {
        if (!this.stepOnce()) return this.progress();
      }
      if (!cmd) break;
      if (cmd.type === 'rupture' && this.unconsumed >= 0) return this.progress();
      this.queue.shift();
      this.apply(cmd);
    }
    this.progress();
  }

  private progress(): void {
    if (this.tick === this.lastProgress) return;
    this.lastProgress = this.tick;
    this.emit({ type: 'progress', world: this.worldId, tick: this.tick });
  }

  /** Um passo; false se precisa recompor e a recomposição anterior ainda não foi aplicada. */
  private stepOnce(): boolean {
    if (this.rate <= 0) {
      this.tick++;
      return true;
    }
    // A tectônica nasce no primeiro passo com placas ligadas (como antes da correção 2).
    this.tectonics ??= new Tectonics(this.world);
    if (this.unconsumed >= 0 && this.tectonics.willRecompose(this.rate)) return false;
    this.tick++;
    const t0 = this.now();
    if (this.tectonics.step(this.rate)) this.finish(t0);
    return true;
  }

  private apply(cmd: GeologyCommand): void {
    if (cmd.type === 'rate') {
      this.rate = Math.max(0, Math.min(1, cmd.rate));
    } else if (cmd.type === 'brush') {
      this.applyBrush(cmd.delta);
    } else if (cmd.type === 'rupture') {
      // Racha e recompõe já, no passo do comando.
      const t0 = this.now();
      if (this.tectonics?.forceRupture()) {
        this.tectonics.recompose();
        this.finish(t0);
      }
    }
  }

  private applyBrush(d: BrushDelta): void {
    const world = this.world;
    const t = this.tectonics;
    for (let k = 0; k < d.cells.length; k++) {
      const c = d.cells[k] as number;
      // O gelo pintado fica no lugar (não anda com a placa).
      world.iceMode[c] = d.iceMode[k] as number;
      const reveal = d.reveal[k] ? REVEALED_BIT : 0;
      if (t) {
        t.syncSample(d.plate[k] as number, d.ref[k] as number, d.elevation[k] as number, d.crust[k] as number, reveal);
      } else {
        // Antes da primeira recomposição cada célula mostra a si mesma: o mundo é a fonte.
        const ref = d.ref[k] as number;
        world.elevation[ref] = d.elevation[k] as number;
        world.crust[ref] = d.crust[k] as number;
        if (world.deposit[ref]) world.deposit[ref] = (world.deposit[ref] as number) | reveal;
      }
    }
  }

  /** Depois de recompor: clima, cores, textura das placas, e entrega ao relógio. */
  private finish(t0: number): void {
    const world = this.world;
    const tectonics = this.tectonics;
    if (!tectonics) return;
    const t1 = this.now();
    computeWaterDistance(world);
    updateClimate(world);
    // Jazidas: as da crosta (andaram com as placas) e as que nascem nas frentes ativas (T6).
    tectonics.writeDeposits(world.deposit);
    this.formation.step(world, tectonics.driftNow, (c, code) => tectonics.setDeposit(c, code));
    const t2 = this.now();
    buildColors(world, this.colors, undefined, this.layers);
    tectonics.writeCellRefs(this.cellRef);
    const plateCells = packPlates(world);
    const t3 = this.now();
    const cycle = tectonics.cycle;
    const result: GeologyResult = {
      world: this.worldId,
      index: this.nextIndex++,
      tick: this.tick,
      angles: Array.from(tectonics.angle),
      drift: tectonics.driftNow,
      motion: world.plates.map((pl, k) => ({ ...tectonics.plateMotion(k), center: [pl.center[0], pl.center[1], pl.center[2]] })),
      plates: world.plates.map((p) => ({ ...p, seed: [...p.seed], center: [...p.center], omega: [...p.omega] }) as Plate),
      plateCells,
      platesMs: t1 - t0,
      climateMs: t2 - t1,
      colorsMs: t3 - t2,
      stats: {
        welds: tectonics.welds,
        fragments: tectonics.fragmentsAbsorbed,
        depositsFormed: this.formation.formed.length,
        ruptures: cycle.ruptures,
        supercontinents: cycle.supercontinents,
        cyclePhase: phaseNumber(cycle.phase),
        recompositions: tectonics.recompositions,
        engineBytes: this.bytes,
      },
    };
    this.unconsumed = result.index;
    this.emit({ type: 'result', result }, [plateCells.buffer as ArrayBuffer]);
  }
}

/** Mesma soma do `Tectonics.step` para a deriva (o relógio acompanha os ângulos sem a tectônica). */
export function driftStep(rate: number): number {
  return rate > 0 ? MAX_PLATE_RATE * rate : 0;
}

export { DEFAULT_PLATE_RATE, NO_LAYERS };
