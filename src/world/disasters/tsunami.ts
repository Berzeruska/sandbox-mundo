import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { WorldState } from '../state';
import type { DisasterOutcome } from './index';
import { CellState, type Ground } from './ground';

/**
 * Tsunami (Bloco Desastres v2, R6; imagem `docs/img/m2-dv-tsunami.png`). A onda sai do epicentro e anda
 * pelo mar com velocidade √profundidade (mais rápida no oceano fundo, freia na plataforma). Tudo
 * acontece nas células, passo a passo: perto das costas que ela vai atingir o mar raso recua (fundo
 * exposto), a faixa clara de espuma chega, a água avança terra adentro pelo terreno baixo, até cerca de
 * 1/5 da largura do continente atingido num tsunami máximo (decisão do usuário, 2026-11-05), volta para o
 * mar e deixa lama; as 1–2 primeiras células da costa perdem altura para sempre.
 */

/** Magnitude mínima de um terremoto no mar para gerar tsunami. */
export const TSUNAMI_MIN_MAGNITUDE = 7.5;
/** Profundidade de referência (m): o "tempo" da onda é medido em radianos de oceano fundo. */
const DEEP = 4000;
/**
 * Velocidade mínima (fração da do oceano fundo): na plataforma larga a onda freia, mas não fica presa
 * (com √profundidade pura ela andava 1/6 e o alcance acabava antes de sair da plataforma).
 */
const MIN_SPEED = 0.4;

/**
 * Magnitude → parte da largura do continente que a água percorre, terreno que ela vence (m) e alcance pelo
 * mar (rad de oceano fundo; calibrado em N = 256 para a onda tocar ~20, ~50, ~100, ~200 células de costa e o
 * oceano todo). O alto da tabela vem do pedido do usuário (2026-11-05): "até cerca de 1/5 da largura do
 * continente, seguindo o terreno baixo". Até 400 m é o quarto mais baixo da terra (medido: 1/4 da terra
 * fica abaixo de ~450 m, em 3 sementes, antes e depois de a Pangeia se partir); os menores ficam
 * proporcionais. Antes eram 3 a 28 células, com altura de 20 a 140 m caindo a cada célula, e a água parava
 * na primeira subida.
 */
const TABLE: readonly (readonly [number, number, number, number])[] = [
  [7.5, 0.05, 60, 0.22],
  [8, 0.08, 120, 0.42],
  [8.5, 0.12, 200, 0.65],
  [9, 0.16, 300, 1],
  [9.5, 0.2, 400, 6],
];

function lerp(m: number, col: number): number {
  const at = (row: number, k: number): number => (TABLE[row] as readonly number[])[k] as number;
  if (m <= at(0, 0)) return at(0, col);
  for (let k = 1; k < TABLE.length; k++) {
    if (m <= at(k, 0)) return at(k - 1, col) + ((at(k, col) - at(k - 1, col)) * (m - at(k - 1, 0))) / (at(k, 0) - at(k - 1, 0));
  }
  return at(TABLE.length - 1, col);
}

/** Que parte da largura do continente a água percorre, pela magnitude. */
export function inlandFraction(m: number): number {
  return lerp(m, 1);
}
/** Quantas células a água entra num continente com esta largura (células): pelo menos 1, a costa. */
export function inlandReach(m: number, width: number): number {
  return Math.max(1, Math.round(inlandFraction(m) * width));
}
/** Terreno que a onda vence na costa mais perto (m): para onde ele for mais alto. */
export function tsunamiRunup(m: number): number {
  return lerp(m, 2);
}
/** Alcance pelo mar (rad de oceano fundo). */
export function tsunamiReach(m: number): number {
  return lerp(m, 3);
}

/** Faixa de espuma desenhada no mar até esta distância (células) das costas atingidas. */
const BAND_CELLS = 8;
/** Fundo exposto: mar raso (menos de SEABED_DEPTH m) a até SEABED_CELLS células da costa atingida. */
const SEABED_CELLS = 4;
const SEABED_DEPTH = 200;

export interface TsunamiPlan {
  /** Células de mar atingidas e quando (0–1 do alcance). */
  sea: number[];
  times: number[];
  /** Mar perto das costas atingidas (faixa de espuma) e quando a onda passa. */
  band: number[];
  bandTimes: number[];
  /** Mar raso que fica exposto antes da onda, e quando a onda chega na costa dele. */
  seabed: number[];
  seabedTimes: number[];
  /** Terra coberta pela água: quando a onda chega na costa, quantas células para dentro está e o alcance ali. */
  land: number[];
  landTimes: number[];
  landSteps: number[];
  landReach: number[];
}

/**
 * Memória de rascunho do plano, reaproveitada entre tsunamis (F3: com mapas, o plano de um M 9,5 em
 * N = 256 levava ~200–300 ms e travava o relógio a cada toque). Cada uso ganha uma marca nova: um valor
 * só vale se a marca da célula for a do uso atual, então nada precisa ser zerado.
 */
class Scratch {
  stamp = 0;
  readonly mark: Uint32Array;
  readonly closed: Uint32Array;
  readonly time: Float64Array;
  readonly coastMark: Uint32Array;
  readonly coastTime: Float64Array;
  readonly seenMark: Uint32Array;
  readonly distMark: Uint32Array;
  readonly dist: Uint8Array;
  readonly nearTime: Float64Array;
  /** Continente de cada célula de terra (marca própria): o valor é o alcance da água nele. */
  readonly massMark: Uint32Array;
  readonly massReach: Int32Array;
  constructor(readonly size: number) {
    this.mark = new Uint32Array(size);
    this.closed = new Uint32Array(size);
    this.time = new Float64Array(size);
    this.coastMark = new Uint32Array(size);
    this.coastTime = new Float64Array(size);
    this.seenMark = new Uint32Array(size);
    this.distMark = new Uint32Array(size);
    this.dist = new Uint8Array(size);
    this.nearTime = new Float64Array(size);
    this.massMark = new Uint32Array(size);
    this.massReach = new Int32Array(size);
  }
  next(): number {
    if (++this.stamp === 0xffffffff) {
      for (const a of [this.mark, this.closed, this.coastMark, this.seenMark, this.distMark, this.massMark]) a.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }
}
let scratch: Scratch | null = null;

/**
 * Quantas células de mar o plano percorre por passo do relógio (F3). Um M 9,5 cobre o oceano inteiro
 * (~270 mil células em N = 256, 40–60 ms de uma vez): dividido assim, cada passo gasta ~4 ms (o tempo de
 * um passo em 20×) e a onda começa ~12 passos (1 s em 1×) depois do terremoto; o fechamento do plano
 * (terra alagada e faixa de espuma) vale um pedaço. Conta em células, não em tempo, para o mundo ser o
 * mesmo em qualquer velocidade e aparelho.
 */
export const PLAN_CELLS_PER_TICK = 25_000;

/**
 * Plano da onda a partir da célula de mar `start` (terremoto de magnitude `m`), feito aos pedaços
 * (`run`). Usa a memória de rascunho comum: um plano por vez (os outros esperam na fila).
 */
export class TsunamiPlanner {
  private id = 0;
  private readonly reach: number;
  private width = 0;
  private readonly buckets: number[][] = [];
  private bucket = 0;
  private pos = 0;
  private readonly sea: number[] = [];
  private readonly times: number[] = [];
  private readonly coastCells: number[] = [];
  /** Pronto (null enquanto anda pelo mar). */
  plan: TsunamiPlan | null = null;

  constructor(
    private readonly world: WorldState,
    private readonly start: number,
    private readonly m: number,
  ) {
    this.reach = tsunamiReach(m);
  }

  /** Começa no primeiro pedaço: a memória de rascunho é de um plano por vez. */
  private begin(): void {
    const world = this.world;
    if (!scratch || scratch.size !== world.cellCount) scratch = new Scratch(world.cellCount);
    this.id = scratch.next();
    // Dijkstra com baldes de tempo: cada balde tem a largura do menor passo possível (uma célula no mar
    // mais fundo), então quem sai de um balde só entra nos seguintes e os tempos são os exatos.
    let deepest = 0;
    for (let c = 0; c < world.cellCount; c++) deepest = Math.max(deepest, -world.heightAboveSea(c));
    this.width = world.grid.cellAngle / Math.max(MIN_SPEED, Math.sqrt(deepest / DEEP));
    scratch.mark[this.start] = this.id;
    scratch.time[this.start] = 0;
    this.buckets[0] = [this.start];
  }

  /** Anda até `budget` células de mar; devolve quantas usou. Termina o plano quando o mar acaba. */
  run(budget: number): number {
    if (this.plan) return 0;
    if (!this.id) this.begin();
    const sc = scratch as Scratch;
    const { mark, time, closed, coastMark, coastTime } = sc;
    const { world, id, reach, width, buckets } = this;
    const { neighbors, cellAngle } = world.grid;
    let used = 0;
    while (this.bucket < buckets.length && used < budget) {
      const list = buckets[this.bucket];
      if (!list || this.pos >= list.length) {
        buckets[this.bucket] = [];
        this.bucket++;
        this.pos = 0;
        continue;
      }
      const c = list[this.pos++] as number;
      if (closed[c] === id) continue;
      closed[c] = id;
      used++;
      const t = time[c] as number;
      this.sea.push(c);
      this.times.push(t / reach);
      const speed = Math.max(MIN_SPEED, Math.sqrt(Math.max(0, -world.heightAboveSea(c)) / DEEP));
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (!world.isWater(j)) {
          // Costa atingida: guarda o tempo mais cedo.
          if (!world.ice[j]) {
            if (coastMark[j] !== id) {
              coastMark[j] = id;
              coastTime[j] = t / reach;
              this.coastCells.push(j);
            } else if ((coastTime[j] as number) > t / reach) coastTime[j] = t / reach;
          }
          continue;
        }
        const tj = t + cellAngle / speed;
        if (tj > reach || (mark[j] === id && tj >= (time[j] as number))) continue;
        mark[j] = id;
        time[j] = tj;
        const b = Math.floor(tj / width);
        const into = buckets[b];
        if (into) into.push(j);
        else buckets[b] = [j];
      }
    }
    // O fechamento (terra alagada, faixa de espuma) vale um pedaço inteiro e fica para o passo seguinte.
    if (this.bucket >= buckets.length && used === 0) {
      this.plan = this.finish();
      return budget;
    }
    return used;
  }

  /**
   * Alcance da água no continente da célula `c0`, com a largura medida uma vez por continente. Largura = o
   * dobro da maior distância até o mar dentro dele: o lado curto, o que se chama de largura de um continente
   * (a área enganaria num continente comprido, que é estreito).
   */
  private reachOf(c0: number): number {
    const { massMark, massReach } = scratch as Scratch;
    const { world, id, m } = this;
    if (massMark[c0] === id) return massReach[c0] as number;
    const { neighbors } = world.grid;
    const members = [c0];
    massMark[c0] = id;
    let deepest = 0;
    for (let head = 0; head < members.length; head++) {
      const c = members[head] as number;
      deepest = Math.max(deepest, world.waterDistance[c] as number);
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (massMark[j] === id || world.isWater(j)) continue;
        massMark[j] = id;
        members.push(j);
      }
    }
    const reach = inlandReach(m, deepest * 2);
    for (const c of members) massReach[c] = reach;
    return reach;
  }

  private finish(): TsunamiPlan {
    const sc = scratch as Scratch;
    const { time, coastTime, seenMark, distMark, dist, nearTime, mark } = sc;
    const { world, id, reach, m, sea, times } = this;
    const { neighbors } = world.grid;
    // Terra: a água entra a partir de todas as costas ao mesmo tempo, uma célula por rodada, enquanto o
    // terreno for mais baixo que a onda (que perde altura com a distância percorrida no mar, não em terra) e
    // até o alcance do continente. Juntas, uma costa não corta o caminho da vizinha.
    const land: number[] = [];
    const landTimes: number[] = [];
    const landSteps: number[] = [];
    const landReach: number[] = [];
    const coasts = this.coastCells.sort((a, b) => (coastTime[a] as number) - (coastTime[b] as number) || a - b);
    let cells = coasts.slice();
    let from = coasts.map((c) => coastTime[c] as number);
    for (let step = 0; cells.length; step++) {
      const nextCells: number[] = [];
      const nextFrom: number[] = [];
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k] as number;
        const t = from[k] as number;
        if (seenMark[c] === id || world.isWater(c) || world.ice[c]) continue;
        const reach = this.reachOf(c);
        if (step >= reach || world.heightAboveSea(c) >= tsunamiRunup(m) * (1 - 0.6 * t)) continue;
        seenMark[c] = id;
        land.push(c);
        landTimes.push(t);
        landSteps.push(step);
        landReach.push(reach);
        for (let d = 0; d < 4; d++) {
          nextCells.push(neighbors[c * 4 + d] as number);
          nextFrom.push(t);
        }
      }
      cells = nextCells;
      from = nextFrom;
    }
    // Mar perto das costas atingidas: distância (células) até elas, pelo mar. O mar atingido é o que tem
    // a marca deste uso e foi fechado (todo o que entrou na fila sai dela, com o tempo final).
    const isSea = (j: number): boolean => mark[j] === id;
    let frontier: number[] = [];
    const bandCells: number[] = [];
    for (const c0 of coasts) {
      const t = (coastTime[c0] as number);
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c0 * 4 + d] as number;
        if (!isSea(j) || distMark[j] === id) continue;
        distMark[j] = id;
        dist[j] = 1;
        nearTime[j] = t;
        frontier.push(j);
        bandCells.push(j);
      }
    }
    for (let step = 2; step <= BAND_CELLS && frontier.length; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let d = 0; d < 4; d++) {
          const j = neighbors[c * 4 + d] as number;
          if (!isSea(j) || distMark[j] === id) continue;
          distMark[j] = id;
          dist[j] = step;
          nearTime[j] = (nearTime[c] as number);
          next.push(j);
          bandCells.push(j);
        }
      }
      frontier = next;
    }
    const band: number[] = [];
    const bandTimes: number[] = [];
    const seabed: number[] = [];
    const seabedTimes: number[] = [];
    bandCells.sort((a, b) => a - b);
    for (const c of bandCells) {
      band.push(c);
      bandTimes.push((time[c] as number) / reach);
      if ((dist[c] as number) <= SEABED_CELLS && -world.heightAboveSea(c) < SEABED_DEPTH) {
        seabed.push(c);
        seabedTimes.push((nearTime[c] as number));
      }
    }
    return { sea, times, band, bandTimes, seabed, seabedTimes, land, landTimes, landSteps, landReach };
  }
}

/** Planeja a onda inteira de uma vez (testes e ferramentas). */
export function planTsunami(world: WorldState, start: number, m: number): TsunamiPlan {
  const p = new TsunamiPlanner(world, start, m);
  while (!p.plan) p.run(Infinity);
  return p.plan;
}

/** Passos da viagem da onda pelo mar (2–5 s em 1×, pelo alcance). */
export function travelTicks(m: number): number {
  return Math.round(48 + 72 * Math.min(1, tsunamiReach(m) / 1.5));
}
/** O mar recua este tanto de passos antes de a onda chegar; a água fica este tanto no ponto mais longe. */
const LEAD_TICKS = 12;
const HOLD_TICKS = 12;
/** A água entra em terra uma célula a cada INLAND_TICKS passos. */
const INLAND_TICKS = 2;
/** Lama que fica onde a água passou (anos; o relógio do chão faz água do tsunami → lama). */
export const MUD_YEARS: readonly [number, number] = [15, 30];
/** A costa raspada perde 5–20 m (para sempre; a que fica abaixo do mar vira mar raso). */
export const SCRAPE_METERS: readonly [number, number] = [5, 20];

interface Action {
  cell: number;
  state: CellState;
  ticks: number;
  level: number;
}

/** O tsunami em andamento: cada passo põe nas células o que acontece naquele passo. */
export class TsunamiProcess {
  private schedule = new Map<number, Action[]>();
  private lastTick: number;
  private scrape: { cells: number[]; deltas: number[]; local: true };

  constructor(
    private ground: Ground,
    plan: TsunamiPlan,
    m: number,
    start: number,
    rng: Rng,
  ) {
    const travel = travelTicks(m);
    const at = (t: number): number => start + LEAD_TICKS + Math.round(t * travel);
    const add = (tick: number, a: Action): void => {
      const list = this.schedule.get(tick);
      if (list) list.push(a);
      else this.schedule.set(tick, [a]);
    };
    let last = start;
    // 1. O mar raso recua (fundo exposto) até a onda chegar na costa dele.
    plan.seabed.forEach((c, k) => {
      const arrive = at(plan.seabedTimes[k] as number);
      add(Math.max(start + 1, arrive - LEAD_TICKS), { cell: c, state: CellState.Seabed, ticks: LEAD_TICKS, level: 1 });
    });
    // 2. A faixa de espuma passa por cada célula de mar perto das costas.
    plan.band.forEach((c, k) => {
      const tick = at(plan.bandTimes[k] as number);
      add(tick, { cell: c, state: CellState.Wave, ticks: 3, level: 1 });
      last = Math.max(last, tick + 3);
    });
    // 3. A água entra em terra uma célula por passo, fica e volta (de dentro para a costa).
    const scrape = { cells: [] as number[], deltas: [] as number[], local: true as const };
    plan.land.forEach((c, k) => {
      const step = plan.landSteps[k] as number;
      const inland = plan.landReach[k] as number;
      const coastTick = at(plan.landTimes[k] as number);
      const arrive = coastTick + step * INLAND_TICKS;
      const until = coastTick + (inland + (inland - step)) * INLAND_TICKS + HOLD_TICKS;
      add(arrive, { cell: c, state: CellState.Surge, ticks: Math.max(1, until - arrive), level: 1 - step / Math.max(1, inland) });
      last = Math.max(last, until);
      // As 1–2 primeiras células da costa perdem altura para sempre.
      if (step <= 1) {
        scrape.cells.push(c);
        scrape.deltas.push(-(SCRAPE_METERS[0] + (SCRAPE_METERS[1] - SCRAPE_METERS[0]) * rng.next()) * (step === 0 ? 1 : 0.5));
      }
    });
    this.scrape = scrape;
    this.lastTick = last + 1;
  }

  step(tick: number, out: DisasterOutcome): boolean {
    const list = this.schedule.get(tick);
    if (list) {
      this.schedule.delete(tick);
      for (const a of list) this.ground.setState(a.cell, a.state as Exclude<CellState, 0>, tick, a.ticks / TICKS_PER_YEAR, TICKS_PER_YEAR, a.level);
    }
    if (tick < this.lastTick) return true;
    // 4. A água voltou: a costa fica raspada.
    if (this.scrape.cells.length) out.terrain.push(this.scrape);
    return false;
  }
}
