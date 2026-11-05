import type { Rng } from '../core/rng';
import type { CubeSphere, Vec3 } from './cubesphere';
import { Noise3D } from './noise';

/**
 * Riftes traçados (G3, `docs/M2-especificacao.md`): a linha por onde um continente se parte é traçada
 * célula a célula, em vez de seguir a fronteira lisa da geração.
 *
 * - Busca de caminho (Dijkstra) com custo baixo perto das suturas antigas e em terreno baixo, e alto em
 *   montanha.
 * - Ruído no custo faz o caminho serpentear na escala de 2 a 6 células.
 * - Degraus de falha transformante: ao longo do braço, o caminho prefere um desvio lateral que muda
 *   aos saltos (trechos de 6 a 14 células), então a linha anda em degraus como no Atlântico Equatorial.
 *   As duas costas se encaixam com dentes e reentrâncias, porque são os dois lados da mesma linha.
 *
 * Funções puras: a grade, as alturas e o sorteio entram como parâmetros (testáveis).
 */

/** Alcance do corredor em volta da fronteira antiga onde o braço pode passar (células). */
export const RIFT_CORRIDOR = 10;
/** Degraus de falha transformante: comprimento dos trechos e maior desvio lateral (células). */
export const RIFT_STEP_MIN = 6;
export const RIFT_STEP_MAX = 14;
export const RIFT_STEP_OFFSET = 5;
/** Escala do serpentear (células por "volta" do ruído). */
export const RIFT_MEANDER_CELLS = 4;
/** Fronteira mais curta que isto não é retraçada (fica como está). */
export const RIFT_MIN_BORDER = 6;
/** Junção tríplice: chance de um dos 3 braços falhar (vira aulacógeno). */
export const FAILED_ARM_CHANCE = 1 / 3;
/** Microcontinente: chance por ruptura e tamanho da lasca (fração do planeta). */
export const MICROCONTINENT_CHANCE = 0.25;
export const MICRO_SHARE_MIN = 0.005;
export const MICRO_SHARE_MAX = 0.02;
/** Lasca menor que isto (mesmo com a largura máxima) não vira microcontinente. */
export const MICRO_SHARE_FLOOR = 0.002;

/** Fila de prioridade mínima (custo) em arrays tipados, para o Dijkstra. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.vals);
      this.keys = k;
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] as number) <= key) break;
      this.keys[i] = this.keys[parent] as number;
      this.vals[i] = this.vals[parent] as number;
      i = parent;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Remove o menor; devolve o valor (o custo fica em `lastKey`). */
  pop(): number {
    const top = this.vals[0] as number;
    this.lastKey = this.keys[0] as number;
    const key = this.keys[--this.size] as number;
    const val = this.vals[this.size] as number;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && (this.keys[child + 1] as number) < (this.keys[child] as number)) child++;
      if ((this.keys[child] as number) >= key) break;
      this.keys[i] = this.keys[child] as number;
      this.vals[i] = this.vals[child] as number;
      i = child;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }

  lastKey = 0;
}

function pointOf(grid: CubeSphere, c: number): Vec3 {
  const p = grid.positions;
  return [p[c * 3] as number, p[c * 3 + 1] as number, p[c * 3 + 2] as number];
}

/** Desvios laterais em degraus ao longo de um braço de `length` células (0 nas pontas). */
export function stepOffsets(length: number, rng: Rng): Float32Array {
  const n = Math.max(1, Math.ceil(length) + 1);
  const out = new Float32Array(n);
  let s = 0;
  while (s < n) {
    const run = rng.int(RIFT_STEP_MIN, RIFT_STEP_MAX);
    const offset = rng.range(-RIFT_STEP_OFFSET, RIFT_STEP_OFFSET);
    for (let k = s; k < Math.min(n, s + run); k++) out[k] = offset;
    s += run;
  }
  // As pontas ficam presas (o braço começa e termina onde deve).
  const ramp = 4;
  for (let k = 0; k < n; k++) {
    const w = Math.min(1, k / ramp, (n - 1 - k) / ramp);
    out[k] = (out[k] as number) * Math.max(0, w);
  }
  return out;
}

export interface ArmInput {
  grid: CubeSphere;
  /** 1 onde o braço pode passar. */
  allowed: Uint8Array;
  start: number;
  /** Ponta final (retraçar uma fronteira) ou, sem ela, qualquer célula de `goal`. */
  end?: number;
  /** Rumo do braço livre (tangente unitária em `start`); com `end`, o rumo é para a ponta final. */
  direction?: Vec3;
  /** Onde o braço livre termina (ex.: costa). */
  goal?: (c: number) => boolean;
  /** Altura de cada célula acima do mar (m): montanha custa mais. */
  height: (c: number) => number;
  /** Distância (células) até a fronteira antiga: perto dela custa menos. Opcional. */
  attract?: Uint16Array;
  rng: Rng;
  noise: Noise3D;
}

/**
 * Traça um braço de rifte. Devolve as células do caminho (da ponta inicial à final, 4-conexo) ou
 * null se não achou caminho dentro de `allowed`.
 */
export function traceArm(a: ArmInput): number[] | null {
  const { grid, allowed, start } = a;
  const { neighbors, cellAngle } = grid;
  const s = pointOf(grid, start);
  let dir: Vec3;
  let length: number;
  if (a.end !== undefined) {
    const e = pointOf(grid, a.end);
    const k = e[0] * s[0] + e[1] * s[1] + e[2] * s[2];
    dir = [e[0] - k * s[0], e[1] - k * s[1], e[2] - k * s[2]];
    length = Math.acos(Math.max(-1, Math.min(1, k))) / cellAngle;
  } else {
    dir = a.direction ?? [1, 0, 0];
    // Braço livre: os degraus cobrem até a costa mais distante possível (~ meio planeta).
    length = Math.PI / cellAngle;
  }
  const dl = Math.hypot(...dir) || 1;
  dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const side: Vec3 = [s[1] * dir[2] - s[2] * dir[1], s[2] * dir[0] - s[0] * dir[2], s[0] * dir[1] - s[1] * dir[0]];
  const steps = stepOffsets(length, a.rng);
  const meander = 1 / (RIFT_MEANDER_CELLS * cellAngle);
  const cost = (c: number): number => {
    const p = grid.positions;
    const x = p[c * 3] as number;
    const y = p[c * 3 + 1] as number;
    const z = p[c * 3 + 2] as number;
    const along = ((x - s[0]) * dir[0] + (y - s[1]) * dir[1] + (z - s[2]) * dir[2]) / cellAngle;
    const perp = ((x - s[0]) * side[0] + (y - s[1]) * side[1] + (z - s[2]) * side[2]) / cellAngle;
    const want = steps[Math.max(0, Math.min(steps.length - 1, Math.round(along)))] as number;
    const off = Math.abs(perp - want);
    let k = 1;
    // Serpentear: ruído em [0, 1].
    k += 0.9 * (0.5 + 0.5 * a.noise.sample(x * meander, y * meander, z * meander));
    // Degraus: o caminho prefere o desvio do trecho; longe dele, cada vez mais caro.
    k += 0.5 * Math.min(off, 2) + (off > 2 ? 0.9 * (off - 2) : 0);
    // Relevo: terreno baixo é barato, montanha nova é cara.
    const h = a.height(c);
    k += 0.4 * Math.min(1, Math.max(0, h / 2000)) + 2 * Math.min(1, Math.max(0, (h - 2500) / 2500));
    // Sutura antiga: perto dela é mais barato.
    if (a.attract) k += 0.12 * Math.min(a.attract[c] as number, RIFT_CORRIDOR);
    // Braço livre não volta para trás.
    if (a.end === undefined && along < -1) k += 50;
    return k;
  };
  const { dist, prev, touched } = scratch(grid.cellCount);
  const heap = new MinHeap();
  const setDist = (c: number, d: number) => {
    if (dist[c] === Infinity) touched.push(c);
    dist[c] = d;
  };
  setDist(start, 0);
  heap.push(0, start);
  let found = -1;
  const limit = 400_000;
  let pops = 0;
  while (heap.size && pops++ < limit) {
    const c = heap.pop();
    const dc = heap.lastKey;
    if (dc > (dist[c] as number)) continue;
    if (a.end !== undefined ? c === a.end : c !== start && a.goal?.(c)) {
      found = c;
      break;
    }
    for (let d = 0; d < 4; d++) {
      const nb = neighbors[c * 4 + d] as number;
      if (!allowed[nb] && nb !== a.end) continue;
      const nd = dc + cost(nb);
      if (nd < (dist[nb] as number)) {
        setDist(nb, nd);
        prev[nb] = c;
        heap.push(nd, nb);
      }
    }
  }
  let path: number[] | null = null;
  if (found >= 0) {
    path = [];
    for (let c = found; ; ) {
      path.push(c);
      if (c === start) break;
      c = prev[c] as number;
    }
    path.reverse();
  }
  for (const c of touched) dist[c] = Infinity;
  touched.length = 0;
  return path;
}

/** Arrays de trabalho do Dijkstra, reaproveitados entre chamadas (só as células tocadas são zeradas). */
let scratchCache: { n: number; dist: Float64Array; prev: Int32Array; touched: number[] } | null = null;
function scratch(n: number): { dist: Float64Array; prev: Int32Array; touched: number[] } {
  if (!scratchCache || scratchCache.n !== n) {
    scratchCache = { n, dist: new Float64Array(n).fill(Infinity), prev: new Int32Array(n), touched: [] };
  }
  return scratchCache;
}

/** Distância em passos (até `max`) a partir de `sources`, só dentro de `within`. */
export function stepDistance(grid: CubeSphere, sources: readonly number[], within: Uint8Array, max: number): Uint16Array {
  const n = grid.cellCount;
  const { neighbors } = grid;
  const out = new Uint16Array(n).fill(0xffff);
  let frontier: number[] = [];
  for (const c of sources) {
    if (out[c] !== 0) {
      out[c] = 0;
      frontier.push(c);
    }
  }
  for (let step = 1; step <= max && frontier.length; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        if (within[nb] && (out[nb] as number) > step) {
          out[nb] = step;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return out;
}

export interface RetraceInput {
  grid: CubeSphere;
  /** 1 nas células que podem mudar de pedaço (crosta continental do bloco que racha). */
  region: Uint8Array;
  /** Pedaço de cada célula da região (entrada e saída). Fora da região, ignorado. */
  label: Int32Array;
  height: (c: number) => number;
  rng: Rng;
  /**
   * Junção tríplice: com esta chance, um dos braços dela falha (a divisa é traçada, mas não abre; os
   * dois pedaços continuam juntos e ali fica um vale, o aulacógeno).
   */
  failChance?: number;
  /** Pode juntar estes dois pedaços (braço que falha)? Ex.: não deixar um continente grande demais. */
  canKeep?: (a: number, b: number) => boolean;
}

export interface RetraceResult {
  /** Braços traçados que cortam (linhas novas entre pedaços). */
  cuts: { a: number; b: number; path: number[] }[];
  /** Braços traçados que não cortam (aulacógenos). */
  kept: { a: number; b: number; path: number[] }[];
  /** Pontos onde 3 pedaços ou mais se encontram (uma célula por junção). */
  junctions: number[];
  /** Células que mudaram de pedaço. */
  moved: number;
}

/**
 * Retraça as divisas entre pedaços dentro da região: cada trecho de divisa (de costa a costa, de
 * costa a junção ou entre junções) vira um braço traçado, e cada lado da linha nova fica com o pedaço
 * daquele lado. Junções de 3 pedaços são pontos comuns dos braços (junção tríplice).
 * Uma brecha entre braços não troca um pedaço inteiro de lado: o miolo de cada pedaço não muda.
 */
export function retraceBorders(input: RetraceInput): RetraceResult {
  const { grid, region, label, rng } = input;
  const n = grid.cellCount;
  const { neighbors } = grid;
  const noise = new Noise3D(rng);
  const result: RetraceResult = { cuts: [], kept: [], junctions: [], moved: 0 };

  // 1) Junções: células da região com 3 pedaços ou mais a até 2 passos. Só perto das divisas (a
  // até 2 passos de uma célula com vizinha de outro pedaço), sem alocar nada por célula.
  const nearBorder = new Uint8Array(n);
  /** Células da região com vizinha de outro pedaço, e a outra (a primeira encontrada). */
  const borderList: number[] = [];
  const borderOther: number[] = [];
  for (let c = 0; c < n; c++) {
    if (!region[c]) continue;
    for (let d = 0; d < 4; d++) {
      const k = neighbors[c * 4 + d] as number;
      if (region[k] && label[k] !== label[c]) {
        borderList.push(c);
        borderOther.push(label[k] as number);
        nearBorder[c] = 1;
        for (let e = 0; e < 4; e++) nearBorder[neighbors[c * 4 + e] as number] = 1;
        break;
      }
    }
  }
  const isJunction = new Uint8Array(n);
  const seen: number[] = [];
  const note = (l: number) => {
    if (!seen.includes(l)) seen.push(l);
  };
  const candidates: number[] = [];
  for (const c of borderList) {
    candidates.push(c);
    for (let e = 0; e < 4; e++) candidates.push(neighbors[c * 4 + e] as number);
  }
  const checked = new Uint8Array(n);
  for (const c of candidates) {
    if (checked[c] || !region[c] || !nearBorder[c]) continue;
    checked[c] = 1;
    seen.length = 0;
    note(label[c] as number);
    for (let d = 0; d < 4; d++) {
      const k = neighbors[c * 4 + d] as number;
      if (region[k]) note(label[k] as number);
      for (let e = 0; e < 4; e++) {
        const m = neighbors[k * 4 + e] as number;
        if (region[m]) note(label[m] as number);
      }
    }
    if (seen.length >= 3) isJunction[c] = 1;
  }
  // Uma célula representante por junção (a mais perto do centro do aglomerado).
  const junctionOf = new Int32Array(n).fill(-1);
  const junctionLabels: number[][] = [];
  {
    const stack: number[] = [];
    for (const c of candidates) {
      if (!isJunction[c] || (junctionOf[c] as number) >= 0) continue;
      const cluster: number[] = [];
      junctionOf[c] = c;
      stack.push(c);
      while (stack.length) {
        const k = stack.pop() as number;
        cluster.push(k);
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (isJunction[nb] && (junctionOf[nb] as number) < 0) {
            junctionOf[nb] = c;
            stack.push(nb);
          }
        }
      }
      let x = 0;
      let y = 0;
      let z = 0;
      for (const k of cluster) {
        const p = pointOf(grid, k);
        x += p[0];
        y += p[1];
        z += p[2];
      }
      let rep = c;
      let best = -Infinity;
      for (const k of cluster) {
        const p = pointOf(grid, k);
        const dot = p[0] * x + p[1] * y + p[2] * z;
        if (dot > best) {
          best = dot;
          rep = k;
        }
      }
      for (const k of cluster) junctionOf[k] = rep;
      result.junctions.push(rep);
      // Pedaços em volta da junção.
      const around = new Set<number>();
      for (const k of cluster) {
        around.add(label[k] as number);
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (region[nb]) around.add(label[nb] as number);
        }
      }
      junctionLabels.push([...around].sort((x, y) => x - y));
    }
  }
  // Braços que falham: um por junção tríplice, com a chance pedida.
  const keepPairs = new Set<number>();
  if (input.failChance) {
    for (const labels of junctionLabels) {
      if (labels.length < 3 || rng.next() >= input.failChance) continue;
      const pairs: [number, number][] = [];
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) pairs.push([labels[i] as number, labels[j] as number]);
      const [a, b] = pairs[rng.int(0, pairs.length - 1)] as [number, number];
      if (input.canKeep && !input.canKeep(a, b)) continue;
      keepPairs.add(a * 65536 + b);
    }
  }

  // 2) Trechos de divisa por par de pedaços (células dos dois lados, 8-conexas).
  const pairOf = new Map<number, number[]>();
  const keyOf = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  borderList.forEach((c, i) => {
    const key = keyOf(label[c] as number, borderOther[i] as number);
    const list = pairOf.get(key);
    if (list) list.push(c);
    else pairOf.set(key, [c]);
  });
  const doneMark = new Uint8Array(n);
  const cut = new Uint8Array(n);
  const inBorder = new Uint8Array(n);
  const attract = new Uint16Array(n).fill(0xffff);
  const allowed = new Uint8Array(n);
  for (const [key, cells] of [...pairOf].sort((x, y) => x[0] - y[0])) {
    const a = Math.floor(key / 65536);
    const b = key % 65536;
    for (const c of cells) inBorder[c] = 1;
    // Trechos 8-conexos.
    for (const c0 of cells) {
      if (doneMark[c0]) continue;
      const comp: number[] = [];
      const stack = [c0];
      doneMark[c0] = 1;
      while (stack.length) {
        const k = stack.pop() as number;
        comp.push(k);
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (inBorder[nb] && !doneMark[nb]) {
            doneMark[nb] = 1;
            stack.push(nb);
          }
          const diag = neighbors[nb * 4 + ((d + 1) % 4)] as number;
          if (inBorder[diag] && !doneMark[diag]) {
            doneMark[diag] = 1;
            stack.push(diag);
          }
        }
      }
      if (comp.length < RIFT_MIN_BORDER) continue;
      // Pontas: células de costa do trecho e junções encostadas nele.
      const ends: number[] = [];
      for (const k of comp) {
        if ((junctionOf[k] as number) >= 0) ends.push(junctionOf[k] as number);
        for (let d = 0; d < 4; d++) {
          if (!region[neighbors[k * 4 + d] as number]) {
            ends.push(k);
            break;
          }
        }
      }
      const uniq = [...new Set(ends)];
      if (uniq.length < 2) continue;
      // As duas pontas mais distantes entre si.
      let e1 = uniq[0] as number;
      let e2 = e1;
      let best = Infinity;
      for (let i = 0; i < uniq.length; i++) {
        const pi = pointOf(grid, uniq[i] as number);
        for (let j = i + 1; j < uniq.length; j++) {
          const pj = pointOf(grid, uniq[j] as number);
          const dot = pi[0] * pj[0] + pi[1] * pj[1] + pi[2] * pj[2];
          if (dot < best) {
            best = dot;
            e1 = uniq[i] as number;
            e2 = uniq[j] as number;
          }
        }
      }
      if (e1 === e2) continue;
      // Corredor em volta do trecho, só nos dois pedaços (e nas junções das pontas): busca em largura
      // a partir do trecho, sem percorrer o planeta inteiro.
      const corridor: number[] = [];
      let frontier: number[] = [];
      for (const c of comp) {
        if (attract[c] !== 0xffff) continue;
        attract[c] = 0;
        allowed[c] = 1;
        corridor.push(c);
        frontier.push(c);
      }
      for (let step = 1; step <= RIFT_CORRIDOR && frontier.length; step++) {
        const next: number[] = [];
        for (const c of frontier) {
          for (let d = 0; d < 4; d++) {
            const k = neighbors[c * 4 + d] as number;
            if (attract[k] !== 0xffff || !region[k] || (label[k] !== a && label[k] !== b)) continue;
            attract[k] = step;
            allowed[k] = 1;
            corridor.push(k);
            next.push(k);
          }
        }
        frontier = next;
      }
      for (const e of [e1, e2]) {
        if (!allowed[e]) {
          allowed[e] = 1;
          corridor.push(e);
        }
      }
      const path = traceArm({ grid, allowed, start: e1, end: e2, height: input.height, attract, rng, noise });
      for (const c of corridor) {
        attract[c] = 0xffff;
        allowed[c] = 0;
      }
      for (const k of comp) inBorder[k] = 0;
      if (!path) continue;
      if (keepPairs.has(a * 65536 + b)) {
        result.kept.push({ a, b, path });
        continue;
      }
      result.cuts.push({ a, b, path });
      for (const k of path) cut[k] = 1;
    }
    for (const c of cells) {
      inBorder[c] = 0;
      doneMark[c] = 0;
    }
  }
  if (!result.cuts.length && !result.kept.length) return result;

  // Braço que falhou: os dois pedaços continuam juntos (um pedaço só, o de número menor).
  const parent = new Map<number, number>();
  const root = (l: number): number => {
    while (parent.has(l) && parent.get(l) !== l) l = parent.get(l) as number;
    return l;
  };
  for (const { a, b } of result.kept) {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  // Pedaço final de cada pedaço (tabela pequena, em vez de procurar no mapa célula a célula).
  let maxLabel = 0;
  for (let c = 0; c < n; c++) if (region[c] && (label[c] as number) > maxLabel) maxLabel = label[c] as number;
  const rootOf = new Int32Array(maxLabel + 1);
  for (let l = 0; l <= maxLabel; l++) rootOf[l] = root(l);
  const base = Int32Array.from(label);
  if (result.kept.length) for (let c = 0; c < n; c++) if (region[c]) base[c] = rootOf[label[c] as number] as number;

  // 3) Cada lado da linha nova fica com o pedaço daquele lado. O miolo de cada pedaço (longe da divisa
  // antiga, fora do corredor dos braços) não muda e cresce para a faixa da divisa sem atravessar os
  // cortes. Onde um corte não fecha (brecha entre braços), a faixa se divide pelo mais perto, como
  // antes; nenhum pedaço inteiro troca de lado por causa de uma brecha.
  const borderCells = result.kept.length ? borderList.filter((c, i) => base[c] !== (rootOf[borderOther[i] as number] as number)) : borderList;
  const fromBorder = stepDistance(grid, borderCells, region, RIFT_CORRIDOR + 1);
  const next = Int32Array.from(base);
  const reached = new Uint8Array(n);
  let frontier: number[] = [];
  // O miolo (fora do corredor) já está certo; cresce só a partir da beira dele para dentro do corredor.
  for (let c = 0; c < n; c++) {
    if (!region[c]) continue;
    const f = fromBorder[c] as number;
    if (f > RIFT_CORRIDOR) {
      reached[c] = 1;
      if (f === RIFT_CORRIDOR + 1) frontier.push(c);
    }
  }
  while (frontier.length) {
    const grow: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        if (!region[k] || reached[k] || cut[k]) continue;
        reached[k] = 1;
        next[k] = next[c] as number;
        grow.push(k);
      }
    }
    frontier = grow;
  }
  // Células do corte: ficam com o próprio pedaço se ele está encostado; senão, com o vizinho.
  for (const c of result.cuts.flatMap((k) => k.path)) {
    if (!region[c]) continue;
    const around: number[] = [];
    for (let d = 0; d < 4; d++) {
      const k = neighbors[c * 4 + d] as number;
      if (region[k] && !cut[k] && reached[k]) around.push(next[k] as number);
    }
    if (around.length && !around.includes(base[c] as number)) next[c] = around[0] as number;
  }
  // Dentes de 1 a 2 células na linha nova (o traçado anda de célula em célula) viram arredondamento
  // que vai e volta quando as placas giram: a célula fica com o pedaço da maioria em volta (3×3).
  // Os degraus de 3 a 5 células ficam.
  // Só perto da linha nova (a até 2 passos de um corte).
  const nearCut = stepDistance(grid, [...result.cuts.flatMap((k) => k.path)], region, 2);
  const corridorCells: number[] = [];
  for (const k of result.cuts) {
    for (const c of k.path) {
      for (let d = -1; d < 4; d++) {
        const a0 = d < 0 ? c : (neighbors[c * 4 + d] as number);
        for (let e = -1; e < 4; e++) {
          const m = e < 0 ? a0 : (neighbors[a0 * 4 + e] as number);
          if (region[m] && (nearCut[m] as number) <= 2 && nearCut[m] !== 0xfffe) {
            corridorCells.push(m);
            nearCut[m] = 0xfffe;
          }
        }
      }
    }
  }
  const vl: number[] = [];
  const vc: number[] = [];
  const updated = new Int32Array(corridorCells.length);
  const vote = (m: number) => {
    if (!region[m]) return;
    const l = next[m] as number;
    const at = vl.indexOf(l);
    if (at >= 0) vc[at] = (vc[at] as number) + 1;
    else {
      vl.push(l);
      vc.push(1);
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    // Calcula todos com os valores de antes da passada e só depois grava (sem copiar o mundo).
    corridorCells.forEach((c, i) => {
      vl.length = 0;
      vc.length = 0;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        vote(k);
        vote(neighbors[k * 4 + ((d + 1) % 4)] as number);
      }
      const own = next[c] as number;
      const ownAt = vl.indexOf(own);
      const ownVotes = ownAt >= 0 ? (vc[ownAt] as number) : 0;
      let out = own;
      for (let q = 0; q < vl.length; q++) if (vl[q] !== own && (vc[q] as number) >= 6 && ownVotes <= 2) out = vl[q] as number;
      updated[i] = out;
    });
    corridorCells.forEach((c, i) => (next[c] = updated[i] as number));
  }
  let moved = 0;
  for (let c = 0; c < n; c++) if (region[c] && next[c] !== label[c]) moved++;
  label.set(next);
  result.moved = moved;
  return result;
}

/**
 * Lasca (microcontinente): as células de `region` do lado `side` (+1 ou -1) do braço `path`, a até
 * `width` passos dele. O lado é medido pelo rumo do braço. Devolve as células.
 */
export function sliverAlong(grid: CubeSphere, region: Uint8Array, path: readonly number[], side: 1 | -1, width: number): number[] {
  const n = grid.cellCount;
  const { neighbors } = grid;
  if (path.length < 2) return [];
  const onPath = new Uint8Array(n);
  for (const c of path) onPath[c] = 1;
  const a = pointOf(grid, path[0] as number);
  const b = pointOf(grid, path[path.length - 1] as number);
  // Normal do plano do braço (grande círculo de a a b): o lado é o sinal do produto escalar com ela.
  const nrm: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const out: number[] = [];
  const depth = new Uint16Array(n).fill(0xffff);
  let frontier: number[] = [];
  for (const c of path) {
    for (let d = 0; d < 4; d++) {
      const k = neighbors[c * 4 + d] as number;
      if (!region[k] || onPath[k] || depth[k] !== 0xffff) continue;
      const p = pointOf(grid, k);
      if (Math.sign(p[0] * nrm[0] + p[1] * nrm[1] + p[2] * nrm[2]) !== side) continue;
      depth[k] = 1;
      frontier.push(k);
      out.push(k);
    }
  }
  for (let step = 2; step <= width && frontier.length; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        if (!region[k] || onPath[k] || depth[k] !== 0xffff) continue;
        // Sempre do mesmo lado (sem contornar a ponta do braço).
        const p = pointOf(grid, k);
        if (Math.sign(p[0] * nrm[0] + p[1] * nrm[1] + p[2] * nrm[2]) !== side) continue;
        depth[k] = step;
        next.push(k);
        out.push(k);
      }
    }
    frontier = next;
  }
  return out;
}
