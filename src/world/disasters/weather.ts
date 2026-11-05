import type { Rng } from '../../core/rng';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';

/**
 * Desastres climáticos (T10): seca, enchente e furacão (o incêndio e o raio estão em `fire.ts`, R3).
 * Lógica pura e determinística; as marcas (seco, alagado) são temporárias. O furacão devolve a trilha para o desenho (nuvem em
 * redemoinho andando por ela).
 */

/** Chance por ano (antes da frequência) de cada um começar em algum lugar do mundo. */
export const DROUGHT_CHANCE = 0.02;
export const FLOOD_CHANCE = 0.02;
export const HURRICANE_CHANCE = 0.03;

/** Furacão: nasce entre 8° e 20° de latitude, em mar com pelo menos 26 °C. */
export const HURRICANE_LAT: readonly [number, number] = [(8 * Math.PI) / 180, (20 * Math.PI) / 180];
export const HURRICANE_MIN_TEMP = 26;
/** Abaixo desta temperatura do mar ele perde força. */
const HURRICANE_DECAY_TEMP = 22;
/** Passo da trilha (rad, ~70 km) e número máximo de pontos. */
const TRACK_STEP = 0.012;
const TRACK_POINTS = 90;

export function latitudeOf(world: WorldState, c: number): number {
  return Math.asin(Math.max(-1, Math.min(1, world.grid.positions[c * 3 + 1] as number)));
}

/** Uma célula sorteada que cumpre `ok` (tenta `tries` vezes), ou −1. */
export function pickCell(world: WorldState, rng: Rng, ok: (c: number) => boolean, tries = 400): number {
  for (let k = 0; k < tries; k++) {
    const c = rng.int(0, world.cellCount - 1);
    if (ok(c)) return c;
  }
  return -1;
}

/** Células de terra (sem gelo) a até `radius` células de `center`, que cumprem `ok`. */
export function landAround(world: WorldState, center: number, radius: number, ok: (c: number) => boolean = () => true): number[] {
  const p = world.grid.positions;
  const cells = world.grid.cellsInCap(p[center * 3] as number, p[center * 3 + 1] as number, p[center * 3 + 2] as number, radius * world.grid.cellAngle);
  return cells.filter((c) => !world.isWater(c) && !world.ice[c] && ok(c));
}

export interface HurricaneTrack {
  points: Vec3[];
  /** Força em cada ponto (categoria, 0 = dissipado). */
  strength: number[];
  /** Células de terra que ele atravessou (para a chuva forte). */
  landCells: number[];
  /** Maior categoria e se tocou terra. */
  category: number;
  landfall: boolean;
}

/** Categoria inicial sorteada (1 a 5; a 5 é rara). */
export function sampleCategory(u: number): number {
  return u < 0.4 ? 1 : u < 0.65 ? 2 : u < 0.83 ? 3 : u < 0.95 ? 4 : 5;
}

/**
 * Trilha de um furacão a partir da célula de mar `start`: anda para oeste com os ventos alísios, vai
 * curvando para o polo e, passando de ~25°, para leste. Perde força em terra (uma categoria a cada ~3
 * passos) e em mar frio; some quando chega a 0.
 */
export function hurricaneTrack(
  world: WorldState,
  start: number,
  category: number,
  rng: Rng,
  step = TRACK_STEP,
  maxPoints = TRACK_POINTS,
  steady = false,
  /** Primeiros pontos em terra em que o do jogador não perde força (E7). */
  holdPoints = 0,
): HurricaneTrack {
  // Ganho e perda de força por ponto, na escala do passo (os números são para TRACK_STEP).
  const k = step / TRACK_STEP;
  // O do jogador segura a categoria escolhida: não enfraquece em mar frio e perde a metade em terra.
  const cold = steady ? 0 : 0.35 * k;
  const land = (steady ? 0.175 : 0.35) * k;
  const pos = world.grid.positions;
  let p: Vec3 = [pos[start * 3] as number, pos[start * 3 + 1] as number, pos[start * 3 + 2] as number];
  const hemi = p[1] >= 0 ? 1 : -1;
  let strength = category;
  let peak = category;
  const points: Vec3[] = [];
  const strengths: number[] = [];
  const landCells: number[] = [];
  let landfall = false;
  const wobble = rng.range(-0.15, 0.15);
  for (let n = 0; n < maxPoints && strength > 0.2; n++) {
    points.push(p);
    strengths.push(strength);
    const c = world.grid.pointToCell(p[0], p[1], p[2]);
    if (world.isWater(c)) {
      const t = world.temperature[c] as number;
      if (t < HURRICANE_DECAY_TEMP) strength -= cold;
      else if (t >= HURRICANE_MIN_TEMP && strength < 5) strength = Math.min(5, strength + 0.05 * k);
    } else {
      landfall = true;
      landCells.push(c);
      if (landCells.length > holdPoints) strength -= land;
    }
    peak = Math.max(peak, strength);
    // Leste e norte locais.
    let ex = p[2];
    let ez = -p[0];
    const el = Math.hypot(ex, ez) || 1;
    ex /= el;
    ez /= el;
    const nx = -p[1] * p[0];
    const ny = 1 - p[1] * p[1];
    const nz = -p[1] * p[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    // Quanto já curvou: 0 até 15°, 1 em 30°.
    const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, p[1]))));
    const s = Math.max(0, Math.min(1, (lat - Math.PI / 12) / (Math.PI / 12)));
    const west = 1 - s;
    const pole = 0.35 + 0.6 * s + wobble;
    const east = Math.max(0, s - 0.5) * 2;
    const dx = (east - west) * ex + ((hemi * pole * nx) / nl);
    const dy = (hemi * pole * ny) / nl;
    const dz = (east - west) * ez + ((hemi * pole * nz) / nl);
    const dl = Math.hypot(dx, dy, dz) || 1;
    const q: Vec3 = [p[0] + (dx / dl) * step, p[1] + (dy / dl) * step, p[2] + (dz / dl) * step];
    const ql = Math.hypot(q[0], q[1], q[2]);
    p = [q[0] / ql, q[1] / ql, q[2] / ql];
  }
  return { points, strength: strengths, landCells, category: Math.round(peak), landfall };
}
