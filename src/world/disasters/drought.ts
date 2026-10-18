import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Biome } from '../biomes';
import type { WorldState } from '../state';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Seca (Bloco Desastres v2, R4; imagem `docs/img/m2-dv-seca-v2.png`). Uma região grande, de borda
 * irregular, vira semiárido enquanto a seca dura: a vegetação vai morrendo ano a ano (mais no miolo) e
 * as células são desenhadas como mato seco e chão claro, avermelhado no miolo mais quente (a cor sai de
 * `src/render/colors.ts`, pela intensidade guardada em `Ground.level`). Lógica pura e determinística.
 */

/** Raio da seca natural (células): 12 a 30, as grandes raras. A do jogador: 22 a 30. */
export const DROUGHT_RADIUS: readonly [number, number] = [12, 30];
export const PLAYER_DROUGHT_RADIUS: readonly [number, number] = [22, 30];
/** Duração (anos). */
export const DROUGHT_YEARS: readonly [number, number] = [3, 15];
/** Quanto a borda varia (fração do raio): a região não é um círculo. */
const ROUGH = 0.8;
/** Vegetação perdida por ano no miolo (15–35%); na borda, menos. */
export const YEARLY_LOSS: readonly [number, number] = [0.15, 0.35];
/** Campo, estepe e savana secam primeiro (×1,3); floresta resiste mais (×0,8). */
const FAST_DRY: ReadonlySet<number> = new Set([Biome.Grassland, Biome.Steppe, Biome.Savanna]);
/** Calor: +2 °C na borda a +6 °C no miolo (só aparece nas células e no toque). */
export const HEAT_C: readonly [number, number] = [2, 6];
/** Seca a partir deste raio vira aviso. */
export const NOTABLE_DROUGHT_RADIUS = 22;

/** Ruído em manchas (fixo, preso à posição): `scale` em "células" aproximadas. */
export function patchNoise(world: WorldState, c: number, scale: number): number {
  const p = world.grid.positions;
  const q0 = Math.floor(((p[c * 3] as number) * 256) / scale);
  const q1 = Math.floor(((p[c * 3 + 1] as number) * 256) / scale);
  const q2 = Math.floor(((p[c * 3 + 2] as number) * 256) / scale);
  return (Math.imul((Math.imul(q0, 73856093) ^ Math.imul(q1, 19349663) ^ Math.imul(q2, 83492791)) >>> 0, 2654435761) >>> 0) / 4294967296;
}

/**
 * Células da seca em volta de `center`, com a intensidade (1 no miolo, 0 na borda): um círculo de borda
 * recortada por ruído em três escalas. Só terra sem gelo.
 */
export function droughtRegion(world: WorldState, center: number, radius: number): { cells: number[]; level: number[] } {
  const p = world.grid.positions;
  const cx = p[center * 3] as number;
  const cy = p[center * 3 + 1] as number;
  const cz = p[center * 3 + 2] as number;
  const ang = world.grid.cellAngle;
  const cells: number[] = [];
  const level: number[] = [];
  for (const c of world.grid.cellsInCap(cx, cy, cz, radius * 1.4 * ang)) {
    if (world.isWater(c) || world.ice[c]) continue;
    const dot = (p[c * 3] as number) * cx + (p[c * 3 + 1] as number) * cy + (p[c * 3 + 2] as number) * cz;
    const d = Math.acos(Math.max(-1, Math.min(1, dot))) / ang;
    const rough = 0.55 * patchNoise(world, c, 16) + 0.3 * patchNoise(world, c, 7) + 0.15 * patchNoise(world, c, 3);
    const lim = radius * (1 - ROUGH / 2 + ROUGH * rough);
    if (d > lim) continue;
    cells.push(c);
    level.push(Math.min(1, 1.5 * (1 - d / lim)));
  }
  return { cells, level };
}

/** Uma seca em andamento: uma vez por ano tira vegetação das células dela; acaba quando o calor sai. */
export class DroughtProcess {
  private readonly until: number;

  constructor(
    private world: WorldState,
    private ground: Ground,
    private cells: number[],
    private startTick: number,
    years: number,
  ) {
    this.until = startTick + Math.round(years * TICKS_PER_YEAR);
  }

  step(tick: number): boolean {
    if (tick >= this.until) return false;
    if ((tick - this.startTick) % TICKS_PER_YEAR !== 0) return true;
    this.dryYear();
    return true;
  }

  /** As placas andaram: a seca vai junto com a crosta. */
  remap(moved: ReadonlyMap<number, number>): void {
    this.cells = this.cells.map((c) => moved.get(c) ?? -1).filter((c) => c >= 0);
  }

  /** Um ano de seca: cada célula perde 15–35% da vegetação no miolo, menos na borda. */
  dryYear(): void {
    for (const c of this.cells) {
      if (this.ground.state[c] !== CellState.Heat) continue;
      const biome = this.world.biome[c] as number;
      if (!hasVegetation(biome)) continue;
      const k = this.ground.levelOf(c);
      const loss = (YEARLY_LOSS[0] + (YEARLY_LOSS[1] - YEARLY_LOSS[0]) * cellHash(c, 0xd7)) * (0.3 + 0.7 * k);
      this.ground.damage(c, loss * (FAST_DRY.has(biome) ? 1.3 : 0.8));
    }
  }
}

/** Começa uma seca: marca o calor nas células (com a intensidade) e devolve o processo. */
export function startDrought(world: WorldState, ground: Ground, center: number, radius: number, years: number, tick: number): { process: DroughtProcess; cells: number[] } | null {
  const { cells, level } = droughtRegion(world, center, radius);
  if (!cells.length) return null;
  cells.forEach((c, k) => ground.setState(c, CellState.Heat, tick, years, TICKS_PER_YEAR, level[k] as number));
  const process = new DroughtProcess(world, ground, cells, tick, years);
  // O primeiro ano de perda já na hora: a seca aparece assim que começa.
  process.dryYear();
  return { process, cells };
}

/** Raio de uma seca sorteada (as grandes raras; a do jogador sempre grande). */
export function sampleDroughtRadius(rng: Rng, manual: boolean): number {
  const [lo, hi] = manual ? PLAYER_DROUGHT_RADIUS : DROUGHT_RADIUS;
  return lo + Math.floor((hi - lo + 1) * (manual ? rng.next() : rng.next() ** 2));
}

/** Calor da seca na célula (°C a mais), pela intensidade (0–1). */
export function droughtHeat(level: number): number {
  return HEAT_C[0] + (HEAT_C[1] - HEAT_C[0]) * level;
}
