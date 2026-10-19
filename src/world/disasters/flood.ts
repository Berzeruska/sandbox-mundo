import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Biome } from '../biomes';
import type { WorldState } from '../state';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Enchente (Bloco Desastres v2, R4, aprovada em 2026-10-18): vem da chuva, de dentro do continente,
 * devagar, e fertiliza. Começa no ponto mais baixo de uma região úmida e a água sobe a partir dele,
 * enchendo as vizinhas baixas e planas (até DEPTH metros acima do ponto de partida, na ordem da altura):
 * segue vales e planícies, não faz círculo. Sobe em ~1 s (RISE_TICKS passos), fica 1–3 anos e baixa,
 * deixando solo fértil (o relógio do chão faz alagada → solo fértil). Numa bacia fechada sobra um lago.
 */

/** Quanto a água sobe acima do ponto de partida (m). */
export const DEPTH: readonly [number, number] = [30, 80];
/** Tamanho máximo (células): natural e do jogador. */
export const FLOOD_CELLS: readonly [number, number] = [40, 260];
export const PLAYER_FLOOD_CELLS: readonly [number, number] = [160, 300];
/** Passos para a água subir toda (12 = 1 s em 1×). */
export const RISE_TICKS = 24;
/** Anos com a água em cima. */
export const WET_YEARS: readonly [number, number] = [1, 3];
/** Lago numa bacia fechada: quanto dura (anos) e a fração mais funda que vira lago. */
export const LAKE_YEARS: readonly [number, number] = [10, 30];
const LAKE_SHARE = 0.12;
/** Enchente a partir deste tamanho vira aviso. */
export const NOTABLE_FLOOD_CELLS = 110;
/** Onde procurar o ponto mais baixo em volta do toque ou do centro sorteado (passos). */
const LOW_SEARCH = 6;

const GRASSY: ReadonlySet<number> = new Set([Biome.Grassland, Biome.Steppe, Biome.Savanna, Biome.Tundra]);

/** A água pode cobrir esta célula? Terra (não mar), sem gelo, sem rocha nova. */
function floodable(world: WorldState, ground: Ground, c: number): boolean {
  if (world.isWater(c) || world.ice[c]) return false;
  const s = ground.state[c] as number;
  return s !== CellState.Lava && s !== CellState.Basalt;
}

/** Célula mais baixa (terra alagável) a até `steps` passos de `from`, ou −1. */
export function lowestNear(world: WorldState, ground: Ground, from: number, steps = LOW_SEARCH): number {
  const { neighbors } = world.grid;
  let best = floodable(world, ground, from) ? from : -1;
  const seen = new Set([from]);
  let frontier = [from];
  for (let s = 0; s < steps; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        if (floodable(world, ground, j) && (best < 0 || (world.elevation[j] as number) < (world.elevation[best] as number))) best = j;
      }
    }
    frontier = next;
  }
  return best;
}

export interface FloodPlan {
  /** Células na ordem em que a água chega (a mais baixa primeiro). */
  cells: number[];
  /** Altura da água acima do ponto de partida (m) e se a região é uma bacia fechada (sem saída para o mar). */
  depth: number;
  closed: boolean;
}

/**
 * Por onde a água vai: busca pela altura (sempre a próxima célula mais baixa encostada na água), só até
 * `depth` metros acima do ponto de partida e até `maxCells` células.
 */
export function floodPlan(world: WorldState, ground: Ground, start: number, depth: number, maxCells: number): FloodPlan {
  const { neighbors } = world.grid;
  const top = (world.elevation[start] as number) + depth;
  const seen = new Set([start]);
  // Fila de prioridade simples (as regiões são pequenas): pares [altura, célula].
  const heap: [number, number][] = [[world.elevation[start] as number, start]];
  const cells: number[] = [];
  let touchesSea = false;
  while (heap.length && cells.length < maxCells) {
    let k = 0;
    for (let i = 1; i < heap.length; i++) if ((heap[i] as [number, number])[0] < (heap[k] as [number, number])[0]) k = i;
    const [, c] = heap.splice(k, 1)[0] as [number, number];
    cells.push(c);
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c * 4 + d] as number;
      if (seen.has(j)) continue;
      seen.add(j);
      if (world.isWater(j)) {
        touchesSea = true;
        continue;
      }
      if (!floodable(world, ground, j) || (world.elevation[j] as number) > top) continue;
      heap.push([world.elevation[j] as number, j]);
    }
  }
  return { cells, depth, closed: !touchesSea };
}

/** Uma enchente em andamento: a água sobe aos poucos (na ordem da altura) e depois o relógio do chão a baixa. */
export class FloodProcess {
  private next = 0;
  private readonly lake: ReadonlySet<number>;
  private readonly lakeYears: number;

  constructor(
    private world: WorldState,
    private ground: Ground,
    private plan: FloodPlan,
    private startTick: number,
    private wetYears: number,
    rng: Rng,
  ) {
    // Bacia fechada: as células mais fundas viram lago por 10–30 anos.
    const n = plan.closed ? Math.max(1, Math.round(plan.cells.length * LAKE_SHARE)) : 0;
    this.lake = new Set(plan.cells.slice(0, n));
    this.lakeYears = rng.range(LAKE_YEARS[0], LAKE_YEARS[1]);
  }

  step(tick: number): boolean {
    const cells = this.plan.cells;
    const t = tick - this.startTick;
    const upTo = Math.min(cells.length, Math.ceil((cells.length * t) / RISE_TICKS));
    const base = this.world.elevation[cells[0] as number] as number;
    for (; this.next < upTo; this.next++) {
      const c = cells[this.next] as number;
      // Profundidade (0–1): quanto mais baixa a célula, mais fundo e mais tempo com água.
      const deep = 1 - Math.min(1, ((this.world.elevation[c] as number) - base) / Math.max(1, this.plan.depth));
      if (this.lake.has(c)) {
        this.ground.setState(c, CellState.Lake, tick, this.lakeYears, TICKS_PER_YEAR, 1);
      } else {
        this.ground.setState(c, CellState.Flooded, tick, this.wetYears * (0.7 + 0.6 * deep), TICKS_PER_YEAR, deep);
      }
      // Floresta alagada não morre (perde 10–20%); campo alagado perde a vegetação e volta verde.
      const biome = this.world.biome[c] as number;
      if (hasVegetation(biome)) this.ground.damage(c, GRASSY.has(biome) ? 0.75 + 0.2 * cellHash(c, 0xf1) : 0.1 + 0.1 * cellHash(c, 0xf1));
    }
    return this.next < cells.length;
  }
}
