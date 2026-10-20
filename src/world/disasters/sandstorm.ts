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
/**
 * A poeira só aparece sobre areia seca (E4: "só onde há areia e o lugar é seco"; teste da `58f53e7`:
 * nem mar nem outro bioma): deserto quente ou frio, seca ou areia de outra tempestade. Quem garante o
 * desenho é o shader, que só pinta a poeira nas células marcadas com SAND_BIT (`src/render/colors.ts`),
 * as mesmas que ele desenha com as placas andando. Aqui o centro anda só sobre areia seca (na borda
 * ele para e sopra ali até o fim) e o raio acompanha o espaço até a borda: num deserto estreito a
 * tempestade fica do tamanho dele, recortada só na borda. Raio mínimo do desenho: MIN_DUST_RADIUS
 * células (menor que isso o ruído da poeira quase não aparece); para nascer basta areia seca até
 * START_ROOM células em volta.
 */
export const DUST_ACROSS = 1.6;
export const MIN_DUST_RADIUS = 6;
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
  /** Raio (células) em cada ponto do caminho. */
  private radii: number[] = [];
  private k = 0;
  private covered = new Set<number>();
  /** Raio (células) no começo (o do aviso). */
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
    const room = dryRoom(world, ground, start, SAND_TICKS[1] * SAND_CELLS_PER_TICK + 2);
    const fit = (c: number): number => Math.min(radius, Math.max(MIN_DUST_RADIUS, ((room.get(c) ?? 0) * 0.6 * 2) / DUST_ACROSS));
    let c = start;
    for (let k = 0; k < life; k++) {
      this.points.push(p);
      this.radii.push(fit(c));
      const w = windAt(world, c);
      // Leste-oeste do vento, com um pouco para o lado (sorteado por tempestade).
      const n: Vec3 = [p[1] * w[2] - p[2] * w[1], p[2] * w[0] - p[0] * w[2], p[0] * w[1] - p[1] * w[0]];
      const q: Vec3 = [p[0] + (w[0] + n[0] * wobble) * step, p[1] + (w[1] + n[1] * wobble) * step, p[2] + (w[2] + n[2] * wobble) * step];
      const l = Math.hypot(q[0], q[1], q[2]);
      const next: Vec3 = [q[0] / l, q[1] / l, q[2] / l];
      const nc = world.grid.pointToCell(next[0], next[1], next[2]);
      // Na borda da areia seca ela não sai: fica soprando ali.
      if (!isDusty(world, ground, nc)) continue;
      p = next;
      c = nc;
    }
    this.radiusCells = this.radii[0] ?? 0;
  }

  view(): DustView | null {
    const n = this.points.length;
    if (this.k >= n) return null;
    const p = this.points[this.k] as Vec3;
    // O chão mudou debaixo dela (a seca acabou, o fogo passou, o mar subiu): ela se desfaz.
    if (!isDusty(this.world, this.ground, this.world.grid.pointToCell(p[0], p[1], p[2]))) {
      this.k = n;
      return null;
    }
    const fade = Math.min(1, (this.k + 1) / 6, (n - this.k) / 12);
    return { id: this.startTick * 16 + 8 + this.slot, point: p, radius: (this.radii[this.k] as number) * this.world.grid.cellAngle, power: fade };
  }

  step(tick: number): boolean {
    const n = this.points.length;
    if (!this.view()) return false;
    const world = this.world;
    const p = this.points[this.k] as Vec3;
    const ang = world.grid.cellAngle;
    const reach = (this.radii[this.k] as number) * 0.8;
    for (const c of world.grid.cellsInCap(p[0], p[1], p[2], reach * ang)) {
      if (this.covered.has(c) || !isDusty(world, this.ground, c)) continue;
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

/** Areia seca, onde a poeira pode ficar: deserto, seca ou areia deixada por outra tempestade, fora da água e do gelo. */
export function isDusty(world: WorldState, ground: Ground, c: number): boolean {
  if (world.isWater(c) || world.ice[c]) return false;
  const s = ground.state[c];
  return DESERTS.has(world.biome[c] as number) || s === CellState.Heat || s === CellState.Sand;
}

/**
 * Distância (em passos de célula) de cada célula até a areia acabar, numa região de `reach` células em
 * volta de `start`. A borda da região conta como fim (estimativa por baixo, nunca por cima).
 */
export function dryRoom(world: WorldState, ground: Ground, start: number, reach: number): Map<number, number> {
  const pos = world.grid.positions;
  const region = world.grid.cellsInCap(pos[start * 3] as number, pos[start * 3 + 1] as number, pos[start * 3 + 2] as number, reach * world.grid.cellAngle);
  const inside = new Set(region);
  const room = new Map<number, number>();
  let frontier: number[] = [];
  const { neighbors } = world.grid;
  for (const c of region) {
    let edge = !isDusty(world, ground, c);
    for (let d = 0; d < 4 && !edge; d++) edge = !inside.has(neighbors[c * 4 + d] as number);
    if (!edge) continue;
    room.set(c, 0);
    frontier.push(c);
  }
  for (let s = 1; frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (!inside.has(j) || room.has(j)) continue;
        room.set(j, s);
        next.push(j);
      }
    }
    frontier = next;
  }
  return room;
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
