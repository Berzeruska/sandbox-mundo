import type { Rng } from '../../core/rng';
import type { Vec3 } from '../cubesphere';
import { Boundary, Crust } from '../plates';
import type { WorldState } from '../state';

/**
 * Vulcões (T9): arcos de subducção (fortes), dorsais (fracos) e pontos quentes fixos no manto. Toda
 * erupção ergue o terreno para sempre (pode criar ilha) e espalha cinzas que somem com o tempo.
 * Lógica pura; quem ergue o terreno é o relógio (como um pincel de Elevar gravado na placa).
 */

/** Erupções por ano por (radiano de fronteira × velocidade relativa), antes da frequência. */
export const ERUPTIONS_PER_YEAR: Record<number, number> = { [Boundary.Convergent]: 0.0035, [Boundary.Divergent]: 0.0012 };
/** A partir deste índice de explosividade (IEV) a erupção é "grande" (aviso). */
export const NOTABLE_VEI = 4;
/** Maior IEV (o das supererupções). */
export const MAX_VEI = 7;
/** Pontos quentes por mundo. */
export const HOTSPOTS: readonly [number, number] = [3, 6];
/**
 * Ponto quente: quanto ergue (m) em média por célula que a placa anda por cima dele, aplicado de
 * HOTSPOT_YEARS em HOTSPOT_YEARS anos. Medido pela distância andada, a cadeia nasce igual com placa
 * rápida ou lenta. O magma vem em pulsos (ativo em metade de cada HOTSPOT_PULSE_CELLS células andadas):
 * por isso nascem ilhas separadas em fila, não uma crista contínua. Teto por ano (placa quase parada não
 * vira uma torre num instante).
 */
export const HOTSPOT_METERS_PER_CELL = 3500;
export const HOTSPOT_PULSE_CELLS = 3;
export const HOTSPOT_YEARS = 10;
export const HOTSPOT_MAX_PER_YEAR = 150;
/** Fator do pulso no instante em que a placa já andou `cells` células: média 1, zero na metade do tempo. */
export function hotspotPulse(cells: number): number {
  return Math.PI * Math.max(0, Math.sin((2 * Math.PI * cells) / HOTSPOT_PULSE_CELLS));
}
/** Erupção visível de ponto quente: chance por ano (antes da frequência). */
export const HOTSPOT_ERUPTION_CHANCE = 0.01;

/** IEV sorteado: cada nível acima de `min` é 4× mais raro. */
export function sampleVei(u: number, min: number, max: number): number {
  const k = Math.floor(-Math.log(Math.max(1e-12, 1 - u)) / Math.log(4));
  return Math.min(max, min + k);
}

/** Altura (m) que a erupção ergue no centro e raio (células), pelo IEV. */
export function eruptionUplift(vei: number): { meters: number; radius: number } {
  return { meters: 250 + 180 * vei, radius: 1 + 0.25 * vei };
}

/** Raio das cinzas (células), pelo IEV: ~2 no IEV 2, ~13 no IEV 7. */
export function ashRadius(vei: number): number {
  return Math.round(0.6 * Math.pow(1.6, vei) + 1);
}

/** Pontos quentes fixos (direções no mundo, não na placa: a placa anda por cima). */
export function makeHotspots(rng: Rng): Vec3[] {
  const count = rng.int(HOTSPOTS[0], HOTSPOTS[1]);
  const out: Vec3[] = [];
  while (out.length < count) {
    const z = rng.range(-0.85, 0.85);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    const p: Vec3 = [r * Math.cos(a), z, r * Math.sin(a)];
    // Longe uns dos outros (≥ 30°).
    if (out.every((q) => q[0] * p[0] + q[1] * p[1] + q[2] * p[2] < Math.cos(Math.PI / 6))) out.push(p);
  }
  return out;
}

/**
 * Onde nasce o vulcão de um arco: a 2–3 células da fronteira convergente, para dentro da placa de cima
 * (a continental, ou a mais alta se as duas forem oceânicas). Dorsal: na própria fronteira.
 */
export function ventCell(world: WorldState, boundaryCell: number, type: number, rng: Rng): number {
  if (type !== Boundary.Convergent) return boundaryCell;
  const { neighbors } = world.grid;
  const a = world.plate[boundaryCell] as number;
  let other = -1;
  for (let d = 0; d < 4 && other < 0; d++) {
    const j = neighbors[boundaryCell * 4 + d] as number;
    if (world.plate[j] !== a) other = j;
  }
  // A célula do outro lado é da placa de cima? Então o vulcão nasce do lado de lá.
  let start = boundaryCell;
  if (other >= 0) {
    const mineCont = world.crust[boundaryCell] === Crust.Continental;
    const otherCont = world.crust[other] === Crust.Continental;
    if ((otherCont && !mineCont) || (otherCont === mineCont && world.heightAboveSea(other) > world.heightAboveSea(boundaryCell))) start = other;
  }
  const plate = world.plate[start];
  const steps = rng.int(2, 3);
  let c = start;
  let from = -1;
  const turn = rng.int(0, 3);
  for (let s = 0; s < steps; s++) {
    // Anda para longe da fronteira: vizinha da mesma placa e sem fronteira, se houver.
    let next = -1;
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c * 4 + ((d + turn) & 3)] as number;
      if (j === from || world.plate[j] !== plate) continue;
      if (!world.boundary[j]) {
        next = j;
        break;
      }
      if (next < 0) next = j;
    }
    if (next < 0) break;
    from = c;
    c = next;
  }
  return c;
}
