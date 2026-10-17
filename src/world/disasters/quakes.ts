import type { Rng } from '../../core/rng';
import { Boundary } from '../plates';
import type { WorldState } from '../state';

/**
 * Terremotos (T8): a tensão se acumula em cada trecho de fronteira (par de placas + tipo de fronteira)
 * e é liberada num terremoto quando passa de um limite sorteado. Lógica pura, determinística (sorteios
 * do `Rng` dos desastres, na ordem fixa dos trechos).
 */

/** Quanto cada tipo de fronteira acumula (convergente mais, divergente pouco: crosta fina e quente). */
const TYPE_FACTOR: Record<number, number> = { [Boundary.Convergent]: 1, [Boundary.Transform]: 0.7, [Boundary.Divergent]: 0.25 };
/** Maior magnitude possível por tipo (subducção chega a 9+, falha transformante a ~8, dorsal a ~7). */
export const MAX_MAGNITUDE: Record<number, number> = { [Boundary.Convergent]: 9.3, [Boundary.Transform]: 8, [Boundary.Divergent]: 6.8 };
/** Menor terremoto que entra no jogo (abaixo disso ninguém notaria de longe). */
export const MIN_MAGNITUDE = 5.5;
/** Inclinação de Gutenberg–Richter (muitos pequenos, poucos grandes). */
const GR_B = 0.8;
/** A partir desta magnitude é "grande" (aviso na tela). */
export const NOTABLE_MAGNITUDE = 7;
/** Tensão acumulada por ano por (radiano de fronteira × velocidade relativa × fator do tipo). */
export const STRESS_PER_YEAR = 0.0018;

export interface Fault {
  key: number;
  type: number;
  cells: number[];
  /** Comprimento (rad) e velocidade relativa média das duas placas (unidades de `Plate.omega`). */
  length: number;
  speed: number;
  /** Tensão acumulada e limite sorteado para o próximo terremoto. */
  stress: number;
  threshold: number;
}

/** Magnitude sorteada (Gutenberg–Richter truncada entre MIN_MAGNITUDE e `max`). */
export function sampleMagnitude(u: number, max: number): number {
  const span = 1 - Math.pow(10, -GR_B * (max - MIN_MAGNITUDE));
  return MIN_MAGNITUDE - Math.log10(1 - u * span) / GR_B;
}

/** Quanto da tensão um terremoto de magnitude `m` libera (o pequeno alivia pouco, o maior zera). */
export function stressDrop(m: number, max: number): number {
  return 0.12 + 0.88 * Math.max(0, Math.min(1, (m - MIN_MAGNITUDE) / (max - MIN_MAGNITUDE)));
}

/**
 * Trechos de fronteira do mundo atual. A tensão de um trecho que já existia continua; trecho novo nasce
 * com tensão sorteada (os trechos não chegam todos ao limite juntos).
 */
export function buildFaults(world: WorldState, old: ReadonlyMap<number, Fault>, rng: Rng): Map<number, Fault> {
  const { neighbors, positions, cellAngle } = world.grid;
  const faults = new Map<number, Fault>();
  for (let c = 0; c < world.cellCount; c++) {
    const type = world.boundary[c] as number;
    if (!type) continue;
    const a = world.plate[c] as number;
    let b = -1;
    for (let d = 0; d < 4 && b < 0; d++) {
      const j = neighbors[c * 4 + d] as number;
      if (world.plate[j] !== a) b = world.plate[j] as number;
    }
    if (b < 0) continue;
    const key = (Math.min(a, b) * 64 + Math.max(a, b)) * 4 + type;
    let f = faults.get(key);
    if (!f) {
      f = { key, type, cells: [], length: 0, speed: 0, stress: 0, threshold: 1 };
      faults.set(key, f);
    }
    f.cells.push(c);
    // Velocidade relativa das duas placas neste ponto: |ωa × p − ωb × p|.
    const pa = world.plates[a]?.omega;
    const pb = world.plates[b]?.omega;
    if (pa && pb) {
      const wx = pa[0] - pb[0];
      const wy = pa[1] - pb[1];
      const wz = pa[2] - pb[2];
      const px = positions[c * 3] as number;
      const py = positions[c * 3 + 1] as number;
      const pz = positions[c * 3 + 2] as number;
      f.speed += Math.hypot(wy * pz - wz * py, wz * px - wx * pz, wx * py - wy * px);
    }
  }
  // Ordem fixa (pela chave) para os sorteios.
  const sorted = new Map<number, Fault>();
  for (const key of [...faults.keys()].sort((x, y) => x - y)) {
    const f = faults.get(key) as Fault;
    f.speed /= f.cells.length;
    // Fronteira nas duas placas: cada lado conta uma vez.
    f.length = (f.cells.length / 2) * cellAngle;
    const prev = old.get(key);
    if (prev) {
      f.stress = prev.stress;
      f.threshold = prev.threshold;
    } else {
      f.threshold = rng.range(0.3, 1);
      f.stress = rng.range(0, f.threshold);
    }
    sorted.set(key, f);
  }
  return sorted;
}

/** Tensão acumulada num ano (antes do fator de frequência). */
export function yearlyStress(f: Fault): number {
  return STRESS_PER_YEAR * f.length * f.speed * (TYPE_FACTOR[f.type] ?? 0);
}

/** Raio (rad) em que o tremor é sentido, para o desenho: ~1° no M 5,5, ~18° no M 9. */
export function feltRadius(m: number): number {
  return 0.02 * Math.pow(2, m - 5);
}
