import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { WorldState } from '../state';
import { patchNoise } from './drought';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * O que o terremoto faz no chão (Bloco Desastres v2, R5; imagem `docs/img/m2-dv-terremoto-v2.png`):
 * uma fenda irregular ao longo da fronteira de placa, deslizamentos descendo as encostas mais íngremes
 * e a vegetação perdendo parte da cobertura. Tudo cresce com a magnitude. Lógica pura e determinística.
 */

/** Pontos da tabela da especificação: magnitude → raio do estrago e comprimento da fenda (células). */
const TABLE: readonly (readonly [number, number, number])[] = [
  [6, 1, 0],
  [7, 3, 6],
  [8, 5, 12],
  [9, 8, 24],
  [9.5, 11, 32],
];
/** Deslizamentos por magnitude (no máximo). */
const SLIDES: readonly (readonly [number, number])[] = [
  [6, 0],
  [7, 2],
  [8, 4],
  [9, 8],
  [9.5, 12],
];
/** A fenda some em ~50 anos; o deslizamento fica marcado por 20–40 (a vegetação cobre). */
export const CRACK_YEARS = 50;
export const SLIDE_YEARS: readonly [number, number] = [20, 40];
/** Queda mínima até a vizinha (m) para uma célula ser encosta que pode deslizar. */
export const SLIDE_MIN_DROP = 180;
/** Quanto a encosta perde (m, para sempre): o topo desce, o entulho embaixo sobe um pouco. */
export const SLIDE_METERS: readonly [number, number] = [10, 60];

function lerp(table: readonly (readonly number[])[], m: number, col: number): number {
  const at = (row: number, k: number): number => (table[row] as readonly number[])[k] as number;
  // Abaixo da primeira linha (M 6) vai a zero em M 5,5.
  if (m <= at(0, 0)) return at(0, col) * Math.max(0, m - 5.5) * 2;
  for (let k = 1; k < table.length; k++) {
    if (m <= at(k, 0)) return at(k - 1, col) + ((at(k, col) - at(k - 1, col)) * (m - at(k - 1, 0))) / (at(k, 0) - at(k - 1, 0));
  }
  return at(table.length - 1, col);
}

/** Raio do estrago (células): M 6 → 1, M 7 → 3, M 8 → 5, M 9 → 8, M 9,5 → 11. */
export function damageRadius(m: number): number {
  return lerp(TABLE, m, 1);
}

/** Comprimento da fenda (células): M 6 quase nada, M 7 ~6, M 8 ~12, M 9 ~24, M 9,5 ~32. */
export function crackLength(m: number): number {
  return lerp(TABLE, m, 2);
}

export function slideCount(m: number): number {
  return Math.round(lerp(SLIDES, m, 1));
}

type V3 = [number, number, number];

/** Leste e norte locais da célula (vetores unitários na superfície). */
function frame(world: WorldState, c: number): { p: V3; e: V3; n: V3 } {
  const pos = world.grid.positions;
  const p: V3 = [pos[c * 3] as number, pos[c * 3 + 1] as number, pos[c * 3 + 2] as number];
  const el = Math.hypot(p[2], p[0]) || 1;
  const e: V3 = [p[2] / el, 0, -p[0] / el];
  const n: V3 = [p[1] * e[2] - p[2] * e[1], p[2] * e[0] - p[0] * e[2], p[0] * e[1] - p[1] * e[0]];
  return { p, e, n };
}

/**
 * Direção da fronteira de placa perto do epicentro (ângulo no plano leste-norte): o eixo principal das
 * células de fronteira a até 5 células. Sem fronteira perto: sorteada.
 */
export function faultAngle(world: WorldState, c: number, rng: Rng): number {
  const { p, e, n } = frame(world, c);
  const pos = world.grid.positions;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let count = 0;
  for (const j of world.grid.cellsInCap(p[0], p[1], p[2], 5 * world.grid.cellAngle)) {
    if (!world.boundary[j]) continue;
    const dx = (pos[j * 3] as number) - p[0];
    const dy = (pos[j * 3 + 1] as number) - p[1];
    const dz = (pos[j * 3 + 2] as number) - p[2];
    const x = dx * e[0] + dy * e[1] + dz * e[2];
    const y = dx * n[0] + dy * n[1] + dz * n[2];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    count++;
  }
  if (count < 3) return rng.range(0, Math.PI);
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/**
 * Fenda irregular: anda em passos de meia célula a partir do epicentro para os dois lados, com desvios
 * suaves (sem retas e sem ângulos retos), mais larga perto do epicentro e afinando nas pontas; as
 * grandes (M ≥ 9) têm galhos. Devolve a largura (0–1) de cada célula.
 */
export function crackCells(world: WorldState, center: number, m: number, rng: Rng): Map<number, number> {
  const crack = new Map<number, number>();
  const length = crackLength(m);
  if (length < 1) return crack;
  const { p: p0, e, n } = frame(world, center);
  const ang = world.grid.cellAngle;
  const { neighbors } = world.grid;
  const base = faultAngle(world, center, rng);
  const width0 = m >= 9 ? 1 : 0.75;
  const walk = (a0: number, len: number, width: number): void => {
    let p: V3 = [p0[0], p0[1], p0[2]];
    let a = a0;
    let drift = 0;
    const steps = Math.max(1, Math.round(len / 0.5));
    for (let s = 0; s < steps; s++) {
      // Desvio suave: a direção muda aos poucos e volta para a da fronteira.
      drift = drift * 0.85 + (rng.next() - 0.5) * 0.5;
      a += drift * 0.25 + (a0 - a) * 0.08;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const qx = p[0] + (e[0] * dx + n[0] * dy) * ang * 0.5;
      const qy = p[1] + (e[1] * dx + n[1] * dy) * ang * 0.5;
      const qz = p[2] + (e[2] * dx + n[2] * dy) * ang * 0.5;
      const l = Math.hypot(qx, qy, qz);
      p = [qx / l, qy / l, qz / l];
      const cell = world.grid.pointToCell(p[0], p[1], p[2]);
      const w = width * (1 - s / steps);
      crack.set(cell, Math.max(crack.get(cell) ?? 0, w));
      // Perto do epicentro a fenda abre para as vizinhas.
      if (w > 0.55) {
        for (let d = 0; d < 4; d++) {
          const j = neighbors[cell * 4 + d] as number;
          if (rng.next() < w - 0.45) crack.set(j, Math.max(crack.get(j) ?? 0, w * 0.6));
        }
      }
    }
  };
  walk(base, length / 2, width0);
  walk(base + Math.PI, length / 2, width0);
  if (m >= 9) {
    walk(base + 0.8, length * 0.18, 0.5);
    walk(base + Math.PI - 0.7, length * 0.15, 0.5);
  }
  return crack;
}

/** Queda até a vizinha mais baixa (m) e qual é ela. */
function steepest(world: WorldState, c: number): { drop: number; to: number } {
  const { neighbors } = world.grid;
  let drop = 0;
  let to = -1;
  const h = world.elevation[c] as number;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[c * 4 + d] as number;
    const dj = h - (world.elevation[j] as number);
    if (dj > drop) {
      drop = dj;
      to = j;
    }
  }
  return { drop, to };
}

export interface Slide {
  /** Do topo (cicatriz) para baixo (entulho); `side` = células da largura da língua. */
  path: number[];
  cells: number[];
  /** Posição de cada célula em `cells` na língua (0 topo, 1 pé). */
  along: number[];
}

/**
 * Deslizamentos: começam nas células mais íngremes do raio e descem pela encosta (sempre para a
 * vizinha mais baixa) em línguas de 2–6 células, separadas umas das outras.
 */
export function slides(world: WorldState, zone: readonly number[], closeness: readonly number[], m: number, rng: Rng): Slide[] {
  const { neighbors } = world.grid;
  const max = slideCount(m);
  if (!max) return [];
  const starts: [number, number][] = [];
  zone.forEach((c, k) => {
    if (world.isWater(c) || world.ice[c]) return;
    const { drop } = steepest(world, c);
    if (drop > SLIDE_MIN_DROP) starts.push([drop * (0.5 + (closeness[k] as number)), c]);
  });
  starts.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const used = new Set<number>();
  const near = (c: number): boolean => {
    let frontier = [c];
    const seen = new Set(frontier);
    for (let s = 0; s < 3; s++) {
      const next: number[] = [];
      for (const x of frontier) {
        if (used.has(x)) return true;
        for (let d = 0; d < 4; d++) {
          const j = neighbors[x * 4 + d] as number;
          if (!seen.has(j)) {
            seen.add(j);
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return frontier.some((x) => used.has(x));
  };
  const out: Slide[] = [];
  for (const [, s0] of starts) {
    if (out.length >= max) break;
    if (near(s0)) continue;
    const path = [s0];
    let c = s0;
    for (let k = 0; k < 5; k++) {
      const { to } = steepest(world, c);
      if (to < 0 || world.isWater(to) || path.includes(to)) break;
      c = to;
      path.push(c);
    }
    if (path.length < 2) continue;
    const cells: number[] = [];
    const along: number[] = [];
    path.forEach((p, k) => {
      const t = path.length > 1 ? k / (path.length - 1) : 0;
      cells.push(p);
      along.push(t);
      if (k === 0) return;
      // Largura: a vizinha mais alta ao lado (a língua tem 2 células de largura) e, no pé, o entulho espalha.
      let side = -1;
      let sideH = -Infinity;
      for (let d = 0; d < 4; d++) {
        const j = neighbors[p * 4 + d] as number;
        if (path.includes(j) || world.isWater(j)) continue;
        if ((world.elevation[j] as number) > sideH) {
          sideH = world.elevation[j] as number;
          side = j;
        }
      }
      if (side >= 0) {
        cells.push(side);
        along.push(t);
      }
      if (t > 0.6) {
        for (let d = 0; d < 4; d++) {
          const j = neighbors[p * 4 + d] as number;
          if (!path.includes(j) && !cells.includes(j) && !world.isWater(j) && rng.next() < 0.5) {
            cells.push(j);
            along.push(t);
          }
        }
      }
    });
    for (const x of cells) used.add(x);
    out.push({ path, cells, along });
  }
  return out;
}

export interface QuakeDamage {
  /** Células e intensidade (1 no epicentro) da área do estrago. */
  zone: number[];
  crack: Map<number, number>;
  slides: Slide[];
  /** Relevo mudado (para sempre): células e metros. */
  terrainCells: number[];
  terrainDeltas: number[];
}

/** Aplica o estrago do terremoto de magnitude `m` com epicentro em `center` e devolve o que mudou. */
export function quakeDamage(world: WorldState, ground: Ground, center: number, m: number, tick: number, rng: Rng): QuakeDamage {
  const pos = world.grid.positions;
  const cx = pos[center * 3] as number;
  const cy = pos[center * 3 + 1] as number;
  const cz = pos[center * 3 + 2] as number;
  const radius = damageRadius(m);
  const ang = world.grid.cellAngle;
  const zone: number[] = [];
  const closeness: number[] = [];
  if (radius > 0) {
    for (const c of world.grid.cellsInCap(cx, cy, cz, (radius + 1) * ang)) {
      const dot = (pos[c * 3] as number) * cx + (pos[c * 3 + 1] as number) * cy + (pos[c * 3 + 2] as number) * cz;
      const d = Math.acos(Math.max(-1, Math.min(1, dot))) / ang;
      // Borda um pouco recortada.
      const lim = radius * (0.8 + 0.4 * patchNoise(world, c, 5));
      if (d > lim) continue;
      zone.push(c);
      closeness.push(1 - d / Math.max(lim, 1e-6));
    }
  }
  // Vegetação perde 20–60% (mais perto do epicentro).
  zone.forEach((c, k) => {
    if (world.isWater(c) || world.ice[c] || !hasVegetation(world.biome[c] as number)) return;
    const near = closeness[k] as number;
    ground.damage(c, (0.2 + 0.4 * near) * (0.7 + 0.5 * cellHash(c, 0x9a)));
  });
  const crack = crackCells(world, center, m, rng);
  const slideList = slides(world, zone, closeness, m, rng);
  const terrainCells: number[] = [];
  const terrainDeltas: number[] = [];
  for (const s of slideList) {
    const meters = SLIDE_METERS[0] + (SLIDE_METERS[1] - SLIDE_METERS[0]) * rng.next();
    s.cells.forEach((c, k) => {
      const t = s.along[k] as number;
      ground.damage(c, 1);
      ground.setState(c, CellState.Slide, tick, rng.range(SLIDE_YEARS[0], SLIDE_YEARS[1]), TICKS_PER_YEAR, t);
      // O topo desce; o pé (entulho) sobe a metade.
      if (t < 0.35) {
        terrainCells.push(c);
        terrainDeltas.push(-meters * (1 - t));
      } else if (t > 0.7) {
        terrainCells.push(c);
        terrainDeltas.push(meters * 0.5 * t);
      }
    });
  }
  for (const [c, w] of crack) {
    if (world.isWater(c) || world.ice[c]) continue;
    ground.setState(c, CellState.Crack, tick, CRACK_YEARS, TICKS_PER_YEAR, w);
  }
  return { zone, crack, slides: slideList, terrainCells, terrainDeltas };
}
