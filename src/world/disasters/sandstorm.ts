import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Biome } from '../biomes';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { windAt } from './fire';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Tempestade de areia (C12, aprovada em 2026-10-18 maior e desenhada como as nuvens; B4 em 2026-11-03).
 * Nasce em deserto (e na seca), anda com o vento da latitude, passa da borda perdendo força e, perto
 * dela, deixa areia por cima da vegetação, que some em alguns anos (no mundo real a tempestade não faz o
 * deserto avançar: isso vem da seca prolongada). O desenho é uma nuvem de poeira no shader, de borda
 * recortada, andando com ela.
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
/**
 * Corrente de ar que levanta areia (B4, decisão do usuário de 2026-11-03, revertendo a E4): ela passa da
 * borda do deserto e vai perdendo força até se desfazer logo depois, como no mundo real. Sobre areia
 * seca (deserto, seca, areia de outra tempestade) a força se recarrega; fora dela cai e^−1 a cada
 * SAND_DECAY_CELLS células andadas e, abaixo de SAND_END_POWER, ela se desfez (~14 células fora). A
 * areia grossa cai perto: só deixa areia no chão enquanto a força passa de COARSE_POWER (~5 células
 * fora); a poeira fina continua desenhada, cada vez mais fraca, até o fim. A areia no chão é
 * temporária: o deserto não avança.
 */
export const SAND_DECAY_CELLS = 6;
export const SAND_END_POWER = 0.1;
export const COARSE_POWER = 0.45;
/** Força recuperada por passo sobre areia seca. */
export const SAND_RECHARGE = 0.2;
/** Para nascer, areia seca até START_ROOM células em volta. */
export const START_ROOM = 3;
/** O jogador toca perto do deserto: procura onde nasce até este número de células do toque. */
export const PLAYER_SAND_SEARCH = 12;
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
  /** Força (0–1) em cada ponto do caminho: 1 sobre a areia, caindo fora dela. */
  private power: number[] = [];
  private k = 0;
  private covered = new Set<number>();
  /** Raio (células) do desenho e do estrago. */
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
    const pos = world.grid.positions;
    let p: Vec3 = [pos[start * 3] as number, pos[start * 3 + 1] as number, pos[start * 3 + 2] as number];
    const life = rng.int(SAND_TICKS[0], SAND_TICKS[1]);
    const step = world.grid.cellAngle * SAND_CELLS_PER_TICK;
    const wobble = rng.range(-0.3, 0.3);
    const decay = Math.exp(-SAND_CELLS_PER_TICK / SAND_DECAY_CELLS);
    let c = start;
    let force = 1;
    let onSand = 0;
    // A vida (6–15 s em 1×) conta sobre a areia; fora dela quem acaba com a tempestade é a força.
    for (let k = 0; k < life * 2 && onSand < life; k++) {
      const dusty = isDusty(world, ground, c);
      if (dusty) {
        onSand++;
        force = Math.min(1, force + SAND_RECHARGE);
      } else {
        force *= decay;
        if (force < SAND_END_POWER) break;
      }
      this.points.push(p);
      this.power.push(force);
      const w = windAt(world, c);
      // Leste-oeste do vento, com um pouco para o lado (sorteado por tempestade).
      const n: Vec3 = [p[1] * w[2] - p[2] * w[1], p[2] * w[0] - p[0] * w[2], p[0] * w[1] - p[1] * w[0]];
      const q: Vec3 = [p[0] + (w[0] + n[0] * wobble) * step, p[1] + (w[1] + n[1] * wobble) * step, p[2] + (w[2] + n[2] * wobble) * step];
      const l = Math.hypot(q[0], q[1], q[2]);
      p = [q[0] / l, q[1] / l, q[2] / l];
      c = world.grid.pointToCell(p[0], p[1], p[2]);
    }
    this.radiusCells = this.points.length ? radius : 0;
  }

  view(): DustView | null {
    const n = this.points.length;
    if (this.k >= n) return null;
    const p = this.points[this.k] as Vec3;
    const fade = Math.min(1, (this.k + 1) / 6, (n - this.k) / 12);
    return { id: this.startTick * 16 + 8 + this.slot, point: p, radius: this.radiusCells * this.world.grid.cellAngle, power: fade * (this.power[this.k] as number) };
  }

  step(tick: number): boolean {
    const n = this.points.length;
    if (this.k >= n) return false;
    const world = this.world;
    const p = this.points[this.k] as Vec3;
    const force = this.power[this.k] as number;
    // Areia grossa: só cai enquanto a corrente tem força (perto da borda); a poeira fina só passa.
    if (force > COARSE_POWER) {
      const ang = world.grid.cellAngle;
      const reach = this.radiusCells * 0.8;
      const coarse = (force - COARSE_POWER) / (1 - COARSE_POWER);
      for (const c of world.grid.cellsInCap(p[0], p[1], p[2], reach * ang)) {
        if (this.covered.has(c) || world.isWater(c) || world.ice[c]) continue;
        const biome = world.biome[c] as number;
        if (DESERTS.has(biome) || !hasVegetation(biome)) continue;
        this.covered.add(c);
        const pos = world.grid.positions;
        const dot = (pos[c * 3] as number) * p[0] + (pos[c * 3 + 1] as number) * p[1] + (pos[c * 3 + 2] as number) * p[2];
        const near = (1 - Math.min(1, Math.acos(Math.max(-1, Math.min(1, dot))) / ang / reach)) * coarse;
        if (near <= 0.02) continue;
        this.ground.damage(c, (SAND_DAMAGE[0] + (SAND_DAMAGE[1] - SAND_DAMAGE[0]) * near) * (0.7 + 0.3 * cellHash(c, 0x5a)));
        this.ground.setState(c, CellState.Sand, tick, SAND_YEARS[0] + (SAND_YEARS[1] - SAND_YEARS[0]) * cellHash(c, 0x5b), TICKS_PER_YEAR, near);
      }
    }
    this.k++;
    return this.k < n;
  }
}

/** Areia seca, onde a poeira pode ficar: deserto, seca ou areia deixada por outra tempestade, fora da água e do gelo. */
export function isDusty(world: WorldState, ground: Ground, c: number): boolean {
  if (world.isWater(c) || world.ice[c]) return false;
  const s = ground.state[c];
  return DESERTS.has(world.biome[c] as number) || s === CellState.Heat || s === CellState.Sand;
}

/** A célula serve para nascer uma tempestade: areia seca em volta, até START_ROOM células. */
export function canStartSandstorm(world: WorldState, ground: Ground, c: number): boolean {
  if (!isDusty(world, ground, c)) return false;
  const pos = world.grid.positions;
  return world.grid.cellsInCap(pos[c * 3] as number, pos[c * 3 + 1] as number, pos[c * 3 + 2] as number, START_ROOM * world.grid.cellAngle).every((x) => isDusty(world, ground, x));
}

/** Onde nasce uma tempestade natural: deserto ou seca onde ela cabe. Devolve a célula ou −1. */
export function pickSandstormCell(world: WorldState, ground: Ground, rng: Rng): number {
  for (let k = 0; k < 400; k++) {
    const c = rng.int(0, world.cellCount - 1);
    if (canStartSandstorm(world, ground, c)) return c;
  }
  return -1;
}
