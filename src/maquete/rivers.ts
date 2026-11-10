import { Biome } from '../world/biomes';
import { coarseIndex } from './chart';

/**
 * Rios e lagos da maquete (T5), calculados só para o desenho: a simulação não sabe deles. Enche as bacias a partir do mar (toda célula passa a ter caminho até ele),
 * soma a chuva descendo e marca como rio o que junta água bastante. Bacia funda que sobrou vira lago.
 */
export interface Hydro {
  /** Para onde a água vai (-1: mar ou sem saída). */
  parent: Int32Array;
  /** Altura da água em metros (a bacia cheia). */
  filled: Float32Array;
  /** Água juntada, em células com chuva média. */
  flow: Float32Array;
  /** 1 onde há lago. */
  lake: Uint8Array;
}

/** Quanta água junta para virar rio. */
export const RIVER_FLOW = 75;
const LAKE_DEPTH = 45;
const LAKE_MIN_CELLS = 4;

const RAIN: Partial<Record<number, number>> = {
  [Biome.HotDesert]: 0.06, [Biome.ColdDesert]: 0.1, [Biome.Steppe]: 0.45, [Biome.Savanna]: 0.7, [Biome.Tundra]: 0.5, [Biome.Taiga]: 0.9,
  [Biome.Grassland]: 0.9, [Biome.TemperateForest]: 1.3, [Biome.TropicalForest]: 1.6, [Biome.Swamp]: 1.6, [Biome.Mountain]: 1.2, [Biome.SnowyPeak]: 0.7, [Biome.Beach]: 0.3,
};

export function neighborTable(n: number): Int32Array {
  const out = new Int32Array(6 * n * n * 4);
  for (let f = 0; f < 6; f++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = (f * n * n + y * n + x) * 4;
    out[o] = coarseIndex(n, f, x + 1, y);
    out[o + 1] = coarseIndex(n, f, x - 1, y);
    out[o + 2] = coarseIndex(n, f, x, y + 1);
    out[o + 3] = coarseIndex(n, f, x, y - 1);
  }
  return out;
}

export function computeHydro(n: number, height: Int16Array, rgba: Uint8Array, ice: Uint8Array, neighbors: Int32Array): Hydro {
  const count = 6 * n * n;
  const parent = new Int32Array(count).fill(-1), filled = new Float32Array(count), flow = new Float32Array(count), lake = new Uint8Array(count);
  const seen = new Uint8Array(count);
  // Fila por altura: um balde por metro (rápido e sem depender da ordem do sorteio).
  const MAX = 12000;
  const head = new Int32Array(MAX).fill(-1), next = new Int32Array(count).fill(-1);
  let lowest = MAX;
  const push = (c: number, m: number): void => {
    const b = Math.max(0, Math.min(MAX - 1, Math.round(m)));
    next[c] = head[b] as number;
    head[b] = c;
    if (b < lowest) lowest = b;
  };
  for (let c = 0; c < count; c++) if ((height[c] as number) <= 0) { seen[c] = 1; filled[c] = 0; push(c, 0); }
  const order: number[] = [];
  while (lowest < MAX) {
    const c = head[lowest] as number;
    if (c < 0) { lowest++; continue; }
    head[lowest] = next[c] as number;
    if ((height[c] as number) > 0) order.push(c);
    const level = filled[c] as number;
    for (let k = 0; k < 4; k++) {
      const nb = neighbors[c * 4 + k] as number;
      if (seen[nb]) continue;
      seen[nb] = 1;
      parent[nb] = c;
      const f = Math.max(height[nb] as number, level + 0.5);
      filled[nb] = f;
      push(nb, f);
    }
  }
  // Da nascente para o mar: do mais alto para o mais baixo, na ordem inversa.
  for (let i = 0; i < count; i++) if ((height[i] as number) > 0) flow[i] = ice[i] ? 0 : (RAIN[(rgba[i * 4 + 3] as number) & 15] ?? 0.8);
  for (let i = order.length - 1; i >= 0; i--) {
    const c = order[i] as number, p = parent[c] as number;
    if (p >= 0 && (height[p] as number) > 0) flow[p] = (flow[p] as number) + (flow[c] as number);
  }
  // Lagos: bacias fundas e com mais de umas poucas células.
  const mark = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) {
    if (mark[c] !== -1 || (height[c] as number) <= 0 || (filled[c] as number) - (height[c] as number) < LAKE_DEPTH) continue;
    const stack = [c], cells: number[] = [];
    mark[c] = c;
    while (stack.length) {
      const q = stack.pop() as number;
      cells.push(q);
      for (let k = 0; k < 4; k++) {
        const nb = neighbors[q * 4 + k] as number;
        if (mark[nb] === -1 && (height[nb] as number) > 0 && (filled[nb] as number) - (height[nb] as number) >= LAKE_DEPTH) { mark[nb] = c; stack.push(nb); }
      }
    }
    if (cells.length >= LAKE_MIN_CELLS && !ice[c]) for (const q of cells) lake[q] = 1;
  }
  return { parent, filled, flow, lake };
}
