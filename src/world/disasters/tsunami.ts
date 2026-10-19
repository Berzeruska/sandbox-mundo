import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { WorldState } from '../state';
import type { DisasterOutcome } from './index';
import { CellState, type Ground } from './ground';

/**
 * Tsunami (Bloco Desastres v2, R6; imagem `docs/img/m2-dv-tsunami.png`). A onda sai do epicentro e anda
 * pelo mar com velocidade √profundidade (mais rápida no oceano fundo, freia na plataforma). Tudo
 * acontece nas células, passo a passo: perto das costas que ela vai atingir o mar raso recua (fundo
 * exposto), a faixa clara de espuma chega, a água avança terra adentro até o alcance da magnitude
 * (parando onde o terreno é mais alto que a onda), volta para o mar e deixa lama; as 1–2 primeiras
 * células da costa perdem altura para sempre.
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
 * Tabela aprovada pelo usuário (2026-10-18): magnitude → células que a água entra em terra, altura que
 * ela vence (m) e alcance pelo mar (rad de oceano fundo; calibrado em N = 256 para a onda tocar ~20,
 * ~50, ~100, ~200 células de costa e o oceano todo; medido: mediana 26, 62, ~120, ~250, 1.500–1.800).
 */
const TABLE: readonly (readonly [number, number, number, number])[] = [
  [7.5, 3, 20, 0.22],
  [8, 6, 40, 0.42],
  [8.5, 10, 60, 0.65],
  [9, 17, 90, 1],
  [9.5, 28, 140, 6],
];

function lerp(m: number, col: number): number {
  const at = (row: number, k: number): number => (TABLE[row] as readonly number[])[k] as number;
  if (m <= at(0, 0)) return at(0, col);
  for (let k = 1; k < TABLE.length; k++) {
    if (m <= at(k, 0)) return at(k - 1, col) + ((at(k, col) - at(k - 1, col)) * (m - at(k - 1, 0))) / (at(k, 0) - at(k - 1, 0));
  }
  return at(TABLE.length - 1, col);
}

/** Quantas células a água entra em terra. */
export function inlandReach(m: number): number {
  return Math.round(lerp(m, 1));
}
/** Altura que a onda vence na costa mais perto (m). */
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
  /** Terra coberta pela água: quando a onda chega na costa e quantas células para dentro está. */
  land: number[];
  landTimes: number[];
  landSteps: number[];
  /** Quantas células a água entra (alcance da magnitude). */
  inland: number;
}

/** Fila de prioridade mínima (heap binário) de células por tempo. */
class Heap {
  cells: number[] = [];
  keys: number[] = [];
  push(c: number, k: number): void {
    const { cells, keys } = this;
    let i = cells.length;
    cells.push(c);
    keys.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= k) break;
      cells[i] = cells[p] as number;
      keys[i] = keys[p] as number;
      i = p;
    }
    cells[i] = c;
    keys[i] = k;
  }
  pop(): number {
    const { cells, keys } = this;
    const top = cells[0] as number;
    const lastC = cells.pop() as number;
    const lastK = keys.pop() as number;
    if (cells.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= cells.length) break;
        const r = l + 1;
        const m = r < cells.length && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[m] as number) >= lastK) break;
        cells[i] = cells[m] as number;
        keys[i] = keys[m] as number;
        i = m;
      }
      cells[i] = lastC;
      keys[i] = lastK;
    }
    return top;
  }
  topKey(): number {
    return this.keys[0] as number;
  }
  get size(): number {
    return this.cells.length;
  }
}

/** Planeja a onda a partir da célula de mar `start` (terremoto de magnitude `m`). */
export function planTsunami(world: WorldState, start: number, m: number): TsunamiPlan {
  const { neighbors, cellAngle } = world.grid;
  const reach = tsunamiReach(m);
  const time = new Map<number, number>();
  const heap = new Heap();
  time.set(start, 0);
  heap.push(start, 0);
  const sea: number[] = [];
  const times: number[] = [];
  const coast = new Map<number, number>();
  while (heap.size) {
    const t = heap.topKey();
    const c = heap.pop();
    if (t > (time.get(c) ?? Infinity)) continue;
    sea.push(c);
    times.push(t / reach);
    const speed = Math.max(MIN_SPEED, Math.sqrt(Math.max(0, -world.heightAboveSea(c)) / DEEP));
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c * 4 + d] as number;
      if (!world.isWater(j)) {
        // Costa atingida: guarda o tempo mais cedo.
        if (!world.ice[j] && (!coast.has(j) || (coast.get(j) as number) > t / reach)) coast.set(j, t / reach);
        continue;
      }
      const tj = t + cellAngle / speed;
      if (tj > reach || tj >= (time.get(j) ?? Infinity)) continue;
      time.set(j, tj);
      heap.push(j, tj);
    }
  }
  // Terra: a água entra a partir de cada costa (as atingidas antes primeiro) enquanto o terreno for mais
  // baixo que a onda, que perde altura a cada célula e com a distância percorrida no mar.
  const inland = inlandReach(m);
  const runup = tsunamiRunup(m);
  const land: number[] = [];
  const landTimes: number[] = [];
  const landSteps: number[] = [];
  const seen = new Set<number>();
  const coasts = [...coast.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [c0, t] of coasts) {
    const h = runup * (1 - 0.6 * t);
    let frontier = [c0];
    for (let step = 0; step < inland && frontier.length; step++) {
      const limit = h * (1 - step / inland);
      const next: number[] = [];
      for (const c of frontier) {
        if (seen.has(c) || world.isWater(c) || world.ice[c] || world.heightAboveSea(c) >= limit) continue;
        seen.add(c);
        land.push(c);
        landTimes.push(t);
        landSteps.push(step);
        for (let d = 0; d < 4; d++) next.push(neighbors[c * 4 + d] as number);
      }
      frontier = next;
    }
  }
  // Mar perto das costas atingidas: distância (células) até elas, pelo mar.
  const seaTime = new Map<number, number>();
  sea.forEach((c, k) => seaTime.set(c, times[k] as number));
  const dist = new Map<number, number>();
  const nearCoastTime = new Map<number, number>();
  let frontier: number[] = [];
  for (const [c0, t] of coasts) {
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c0 * 4 + d] as number;
      if (!seaTime.has(j) || dist.has(j)) continue;
      dist.set(j, 1);
      nearCoastTime.set(j, t);
      frontier.push(j);
    }
  }
  for (let step = 2; step <= BAND_CELLS && frontier.length; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (!seaTime.has(j) || dist.has(j)) continue;
        dist.set(j, step);
        nearCoastTime.set(j, nearCoastTime.get(c) as number);
        next.push(j);
      }
    }
    frontier = next;
  }
  const band: number[] = [];
  const bandTimes: number[] = [];
  const seabed: number[] = [];
  const seabedTimes: number[] = [];
  for (const [c, d] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    band.push(c);
    bandTimes.push(seaTime.get(c) as number);
    if (d <= SEABED_CELLS && -world.heightAboveSea(c) < SEABED_DEPTH) {
      seabed.push(c);
      seabedTimes.push(nearCoastTime.get(c) as number);
    }
  }
  return { sea, times, band, bandTimes, seabed, seabedTimes, land, landTimes, landSteps, inland };
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
  private scrape: { cells: number[]; deltas: number[] };

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
    const inland = plan.inland;
    const scrape = { cells: [] as number[], deltas: [] as number[] };
    plan.land.forEach((c, k) => {
      const step = plan.landSteps[k] as number;
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
