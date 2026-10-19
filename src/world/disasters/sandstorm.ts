import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Biome } from '../biomes';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { windAt } from './fire';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Tempestade de areia (C12, aprovada em 2026-10-18 maior e desenhada como as nuvens). Nasce em deserto
 * (e na seca), anda com o vento da latitude e, fora do deserto, deixa areia por cima da vegetação, que
 * some em alguns anos (no mundo real a tempestade não faz o deserto avançar: isso vem da seca
 * prolongada). O desenho é uma nuvem de poeira no shader, de borda recortada, andando com ela.
 */

/** Raio (células): natural 10–24 (as grandes raras), do jogador 18–24. */
export const SAND_RADIUS: readonly [number, number] = [10, 24];
export const PLAYER_SAND_RADIUS: readonly [number, number] = [18, 24];
/** Vida (passos): 6–15 s em 1×; anda meia célula por passo. */
export const SAND_TICKS: readonly [number, number] = [72, 180];
export const SAND_CELLS_PER_TICK = 0.5;
/** Chance por ano (antes da frequência) de nascer uma em algum deserto, e quantas ao mesmo tempo. */
export const SANDSTORM_CHANCE = 0.03;
export const MAX_SANDSTORMS = 4;
/** A vegetação embaixo perde 20–50% (mais perto do miolo); a areia fica 3–10 anos. */
export const SAND_DAMAGE: readonly [number, number] = [0.2, 0.5];
export const SAND_YEARS: readonly [number, number] = [3, 10];
/** Tempestade a partir deste raio vira aviso. */
export const NOTABLE_SAND_RADIUS = 20;

export const DESERTS: ReadonlySet<number> = new Set([Biome.HotDesert, Biome.ColdDesert]);

export interface DustView {
  id: number;
  point: Vec3;
  /** Raio do desenho (rad) e força 0–1. */
  radius: number;
  power: number;
}

/** Uma tempestade de areia andando com o vento. */
export class SandstormProcess {
  private points: Vec3[] = [];
  private k = 0;
  private covered = new Set<number>();
  readonly radiusCells: number;

  constructor(
    private world: WorldState,
    private ground: Ground,
    start: number,
    radius: number,
    rng: Rng,
    readonly startTick: number,
    private slot: number,
  ) {
    this.radiusCells = radius;
    const pos = world.grid.positions;
    let p: Vec3 = [pos[start * 3] as number, pos[start * 3 + 1] as number, pos[start * 3 + 2] as number];
    const life = rng.int(SAND_TICKS[0], SAND_TICKS[1]);
    const step = world.grid.cellAngle * SAND_CELLS_PER_TICK;
    const wobble = rng.range(-0.3, 0.3);
    for (let k = 0; k < life; k++) {
      this.points.push(p);
      const c = world.grid.pointToCell(p[0], p[1], p[2]);
      const w = windAt(world, c);
      // Leste-oeste do vento, com um pouco para o lado (sorteado por tempestade).
      const n: Vec3 = [p[1] * w[2] - p[2] * w[1], p[2] * w[0] - p[0] * w[2], p[0] * w[1] - p[1] * w[0]];
      const q: Vec3 = [p[0] + (w[0] + n[0] * wobble) * step, p[1] + (w[1] + n[1] * wobble) * step, p[2] + (w[2] + n[2] * wobble) * step];
      const l = Math.hypot(q[0], q[1], q[2]);
      p = [q[0] / l, q[1] / l, q[2] / l];
    }
  }

  view(): DustView | null {
    const n = this.points.length;
    if (this.k >= n) return null;
    const p = this.points[this.k] as Vec3;
    const fade = Math.min(1, (this.k + 1) / 6, (n - this.k) / 12);
    return { id: this.startTick * 16 + 8 + this.slot, point: p, radius: this.radiusCells * this.world.grid.cellAngle, power: fade };
  }

  step(tick: number): boolean {
    const n = this.points.length;
    if (this.k >= n) return false;
    const world = this.world;
    const p = this.points[this.k] as Vec3;
    const ang = world.grid.cellAngle;
    const reach = this.radiusCells * 0.8;
    for (const c of world.grid.cellsInCap(p[0], p[1], p[2], reach * ang)) {
      if (this.covered.has(c) || world.isWater(c) || world.ice[c]) continue;
      const biome = world.biome[c] as number;
      if (DESERTS.has(biome) || !hasVegetation(biome)) continue;
      this.covered.add(c);
      const pos = world.grid.positions;
      const dot = (pos[c * 3] as number) * p[0] + (pos[c * 3 + 1] as number) * p[1] + (pos[c * 3 + 2] as number) * p[2];
      const near = 1 - Math.min(1, Math.acos(Math.max(-1, Math.min(1, dot))) / ang / reach);
      this.ground.damage(c, (SAND_DAMAGE[0] + (SAND_DAMAGE[1] - SAND_DAMAGE[0]) * near) * (0.7 + 0.3 * cellHash(c, 0x5a)));
      this.ground.setState(c, CellState.Sand, tick, SAND_YEARS[0] + (SAND_YEARS[1] - SAND_YEARS[0]) * cellHash(c, 0x5b), TICKS_PER_YEAR, near);
    }
    this.k++;
    return this.k < n;
  }
}

/** Onde nasce uma tempestade natural: deserto, ou a seca. Devolve a célula ou −1. */
export function pickSandstormCell(world: WorldState, ground: Ground, rng: Rng): number {
  for (let k = 0; k < 400; k++) {
    const c = rng.int(0, world.cellCount - 1);
    if (world.isWater(c) || world.ice[c]) continue;
    if (DESERTS.has(world.biome[c] as number) || ground.state[c] === CellState.Heat) return c;
  }
  return -1;
}
