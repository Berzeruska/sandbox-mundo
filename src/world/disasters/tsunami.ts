import type { WorldState } from '../state';

/**
 * Tsunami (T8): a onda sai do epicentro e anda pelo mar com velocidade √profundidade (mais rápida no
 * oceano fundo, freia na plataforma). O alcance e a altura na costa crescem com a magnitude. Terra
 * baixa encostada no mar atingido fica alagada por um tempo.
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
/** Alcance (rad de oceano fundo) e altura máxima na costa (m), pela magnitude. */
export function tsunamiReach(m: number): number {
  return 0.3 + 0.35 * Math.max(0, m - TSUNAMI_MIN_MAGNITUDE);
}
export function tsunamiRunup(m: number): number {
  return 8 + 14 * Math.max(0, m - TSUNAMI_MIN_MAGNITUDE);
}
/** Até quantas células para dentro da terra a água entra. */
const INLAND_STEPS = 3;
/** Pontos da frente de onda enviados à tela, no máximo. */
const MAX_WAVE_POINTS = 5000;

export interface TsunamiResult {
  /** Células de mar atingidas e quando (0–1 do alcance). */
  sea: number[];
  times: number[];
  /** Células de terra alagadas. */
  flooded: number[];
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

/** Propaga a onda a partir da célula de mar `start` (terremoto de magnitude `m`). */
export function propagateTsunami(world: WorldState, start: number, m: number): TsunamiResult {
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
        if (!coast.has(j) || (coast.get(j) as number) > t) coast.set(j, t);
        continue;
      }
      const tj = t + cellAngle / speed;
      if (tj > reach || tj >= (time.get(j) ?? Infinity)) continue;
      time.set(j, tj);
      heap.push(j, tj);
    }
  }
  // Alagamento: a altura na costa cai com a distância percorrida; a água entra enquanto o terreno é baixo.
  const runup = tsunamiRunup(m);
  const flooded: number[] = [];
  const seen = new Set<number>();
  for (const [c0, t] of [...coast.entries()].sort((a, b) => a[0] - b[0])) {
    const h = runup * (1 - 0.6 * (t / reach));
    let frontier = [c0];
    for (let step = 0; step < INLAND_STEPS && frontier.length; step++) {
      const limit = h * (1 - step / INLAND_STEPS);
      const next: number[] = [];
      for (const c of frontier) {
        if (seen.has(c) || world.isWater(c) || world.heightAboveSea(c) >= limit || world.ice[c]) continue;
        seen.add(c);
        flooded.push(c);
        for (let d = 0; d < 4; d++) next.push(neighbors[c * 4 + d] as number);
      }
      frontier = next;
    }
  }
  return { sea, times, flooded };
}

/** Amostra a frente de onda para a tela (xyz e tempo de cada ponto), no máximo MAX_WAVE_POINTS. */
export function wavePoints(world: WorldState, r: TsunamiResult): { path: Float32Array; times: Float32Array } {
  const { positions } = world.grid;
  const every = Math.max(1, Math.ceil(r.sea.length / MAX_WAVE_POINTS));
  const count = Math.ceil(r.sea.length / every);
  const path = new Float32Array(count * 3);
  const times = new Float32Array(count);
  for (let k = 0, i = 0; i < r.sea.length; i += every, k++) {
    const c = r.sea[i] as number;
    path[k * 3] = positions[c * 3] as number;
    path[k * 3 + 1] = positions[c * 3 + 1] as number;
    path[k * 3 + 2] = positions[c * 3 + 2] as number;
    times[k] = r.times[i] as number;
  }
  return { path, times };
}
