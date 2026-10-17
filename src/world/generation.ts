import { createRng, type Rng } from '../core/rng';
import { newArray } from '../core/shared';
import type { CellJob, CellPool } from './cell-pool';
import type { WorldState } from './state';
import { createNoise3D, fbm, ridged, type Noise3D } from './noise';
import { latLonToPoint, type Vec3 } from './cubesphere';

/** Bacias internas por mundo (mares internos e golfos), geração v2. */
const BASINS_MIN = 2;
const BASINS_MAX = 4;
/** Ruído costeiro (geração v2): largura da faixa em torno da costa e amplitude, no relevo bruto. */
/** Plataforma continental: largura (fração da faixa de profundidade) e profundidade na borda (m). */
const SHELF_WIDTH = 0.28;
const SHELF_DEPTH = 160;
const COAST_BAND = 0.12;
const COAST_AMPLITUDE = 0.24;

/** A cada quantas células (potência de 2, menos 1) o progresso é avisado. */
const PROGRESS_MASK = 16383;

/** Profundidade máxima do oceano e altura máxima das montanhas geradas (metros). */
export const MAX_DEPTH = 5000;
export const MAX_HEIGHT = 5500;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Anda `angle` radianos a partir do ponto `p`, no rumo `bearing` (0 = norte). */
export function moveAlong(p: Vec3, bearing: number, angle: number): Vec3 {
  // Base local: leste e norte no ponto p.
  let ex = p[2];
  let ez = -p[0];
  const elen = Math.hypot(ex, ez) || 1;
  ex /= elen;
  ez /= elen;
  const nx = p[1] * ez;
  const ny = p[2] * ex - p[0] * ez;
  const nz = -p[1] * ex;
  const dx = Math.cos(bearing) * nx + Math.sin(bearing) * ex;
  const dy = Math.cos(bearing) * ny;
  const dz = Math.cos(bearing) * nz + Math.sin(bearing) * ez;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + dx * s, p[1] * c + dy * s, p[2] * c + dz * s];
}

/** Valor que deixa `fraction` dos elementos acima dele. */
export function thresholdForFraction(values: Float32Array, fraction: number): number {
  const a = Float32Array.from(values);
  const k = Math.min(a.length - 1, Math.max(0, Math.floor((1 - fraction) * a.length)));
  return selectKth(a, k);
}

/**
 * O k-ésimo menor valor (o mesmo que ordenar e pegar a posição k), sem ordenar tudo: seleção rápida
 * (Hoare), que só separa a parte onde o k está. Mexe na ordem de `a`.
 */
function selectKth(a: Float32Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (hi > lo) {
    // Pivô: mediana do primeiro, do meio e do último (determinístico).
    const mid = (lo + hi) >> 1;
    const x = a[lo] as number;
    const y = a[mid] as number;
    const z = a[hi] as number;
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((a[i] as number) < pivot) i++;
      while ((a[j] as number) > pivot) j--;
      if (i <= j) {
        const t = a[i] as number;
        a[i] = a[j] as number;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k] as number;
  }
  return a[k] as number;
}

/** Sorteios e ruídos da primeira passada do terreno (os mesmos em qualquer worker). */
interface TerrainSetup {
  rng: Rng;
  baseNoise: Noise3D;
  warpNoise: Noise3D;
  ridgeNoise: Noise3D;
  ridgeMask: Noise3D;
  tempNoise: Noise3D;
  rainNoise: Noise3D;
  center: Vec3;
  radius: number;
  lobes: { p: Vec3; r: number }[];
  offset: number;
}

function terrainSetup(seed: number, landFraction: number): TerrainSetup {
  const rng = createRng(seed);
  const baseNoise = createNoise3D(rng);
  const warpNoise = createNoise3D(rng);
  const ridgeNoise = createNoise3D(rng);
  const ridgeMask = createNoise3D(rng);
  const tempNoise = createNoise3D(rng);
  const rainNoise = createNoise3D(rng);

  // Supercontinente = união de alguns "lobos" (calotas) em volta de um centro, com a borda
  // deformada por ruído. Isso dá um formato irregular, com baías e penínsulas, e não um círculo.
  const lat = rng.range(-0.6, 0.6);
  const lon = rng.range(-Math.PI, Math.PI);
  const center = latLonToPoint(lat, lon);
  const radius = Math.acos(1 - 2 * landFraction);
  const lobes: { p: Vec3; r: number }[] = [{ p: center, r: radius * 0.55 }];
  // Lobos espalhados ao longo de um eixo principal: o continente fica alongado e recortado.
  const axis = rng.range(0, Math.PI * 2);
  const lobeCount = rng.int(4, 6);
  for (let k = 0; k < lobeCount; k++) {
    const dir = axis + (k % 2 === 0 ? 0 : Math.PI) + rng.range(-0.9, 0.9);
    lobes.push({ p: moveAlong(center, dir, radius * rng.range(0.5, 1.05)), r: radius * rng.range(0.3, 0.5) });
  }
  const offset = rng.range(0, 100);
  return { rng, baseNoise, warpNoise, ridgeNoise, ridgeMask, tempNoise, rainNoise, center, radius, lobes, offset };
}

interface TerrainBaseOut {
  raw: Float32Array;
  continent: Float32Array;
  tempNoise: Float32Array;
  rainNoise: Float32Array;
}

/** Primeira passada do terreno nas células [from, to): só depende da célula (pura). */
function baseCells(s: TerrainSetup, positions: Float32Array, from: number, to: number, out: TerrainBaseOut): void {
  const { lobes, offset } = s;
  for (let i = from; i < to; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    const warp = 0.3 * fbm(s.warpNoise, x * 2 + offset, y * 2, z * 2, 3);
    let mask = 0;
    for (const lobe of lobes) {
      const dot = Math.min(1, Math.max(-1, x * lobe.p[0] + y * lobe.p[1] + z * lobe.p[2]));
      const d = Math.acos(dot) + warp;
      const m = smoothstep(lobe.r + 0.25, lobe.r - 0.25, d);
      if (m > mask) mask = m;
    }
    out.continent[i] = mask;
    // Variação regional do clima (usada em climate.ts) para os biomas não virarem listras retas.
    out.tempNoise[i] = fbm(s.tempNoise, x * 2.5, y * 2.5, z * 2.5, 3) * 1.6;
    out.rainNoise[i] = fbm(s.rainNoise, x * 3, y * 3, z * 3, 4) * 1.6;
    // Ganho 0.6: as oitavas médias pesam mais, e a costa ganha baías e penínsulas.
    // Longe do continente o detalhe pesa menos, para o oceano não virar um arquipélago.
    const detail = fbm(s.baseNoise, x * 3.5, y * 3.5, z * 3.5, 6, 0.6);
    out.raw[i] = (mask * 2 - 1) * 0.5 + detail * (0.3 + 0.3 * mask);
  }
}

/** Sorteios da última semente pedida ao ajudante (os pedaços do mesmo mundo reaproveitam). */
let jobSetup: { seed: number; landFraction: number; setup: TerrainSetup } | null = null;

/** Lado do ajudante: um pedaço do trabalho dividido (`cell-pool.ts`). */
export function runCellJob(job: CellJob, from: number, to: number): void {
  if (!jobSetup || jobSetup.seed !== job.seed || jobSetup.landFraction !== job.landFraction) {
    jobSetup = { seed: job.seed, landFraction: job.landFraction, setup: terrainSetup(job.seed, job.landFraction) };
  }
  baseCells(jobSetup.setup, job.positions, from, to, job);
}

/**
 * Gera a elevação da Pangeia: um supercontinente (máscara num ponto aleatório, deformada por
 * ruído para não ficar redonda) somado a ruído fractal, com cordilheiras por ruído de crista.
 * A fração de terra é garantida escolhendo o limiar exato que deixa `landFraction` acima da água.
 */
export function generateTerrain(world: WorldState, onProgress?: (fraction: number) => void, pool?: CellPool): void {
  const { seed, landFraction } = world.params;
  const setup = terrainSetup(seed, landFraction);
  const { rng, center, radius, ridgeNoise, ridgeMask } = setup;
  const { positions } = world.grid;
  const n = world.cellCount;
  // Em memória compartilhada quando há: o ajudante 2 calcula parte da primeira passada (pool).
  const raw = newArray(Float32Array, n);
  const continent = newArray(Float32Array, n);
  const out = { raw, continent, tempNoise: world.tempNoise, rainNoise: world.rainNoise };
  if (pool) {
    pool.run(
      { kind: 'terrainBase', seed, landFraction, positions, ...out },
      n,
      (from, to) => baseCells(setup, positions, from, to, out),
      onProgress && ((f) => onProgress(0.8 * f)),
    );
  } else {
    for (let from = 0; from < n; from += PROGRESS_MASK + 1) {
      onProgress?.((0.8 * from) / n);
      baseCells(setup, positions, from, Math.min(n, from + PROGRESS_MASK + 1), out);
    }
  }

  // --- Geração v2 (M2): costas recortadas e mares internos. Sorteios novos vêm depois dos antigos,
  // então o formato geral da Pangeia de cada semente continua parecido; só o contorno muda.
  // Bacias internas: depressões suaves dentro do continente que viram mares internos e golfos.
  const basins: { p: Vec3; cos: number; r: number; depth: number }[] = [];
  const basinCount = rng.int(BASINS_MIN, BASINS_MAX);
  for (let k = 0; k < basinCount; k++) {
    const r = rng.range(0.07, 0.15);
    basins.push({
      p: moveAlong(center, rng.range(0, Math.PI * 2), radius * rng.range(0.15, 0.75)),
      cos: Math.cos(r),
      r,
      depth: rng.range(0.3, 0.55),
    });
  }
  const coastNoise = createNoise3D(rng);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    for (const b of basins) {
      const dot = x * b.p[0] + y * b.p[1] + z * b.p[2];
      if (dot <= b.cos) continue;
      raw[i] = (raw[i] as number) - b.depth * smoothstep(b.r, 0, Math.acos(Math.min(1, dot))) * (continent[i] as number);
    }
  }
  // Ruído fino só perto da costa (baías, penínsulas e ilhotas de 1 a ~15 células); longe dela não
  // muda nada e nem é calculado.
  const t0 = thresholdForFraction(raw, landFraction);
  for (let i = 0; i < n; i++) {
    const off = ((raw[i] as number) - t0) / COAST_BAND;
    if (off * off > 6) continue;
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    raw[i] = (raw[i] as number) + COAST_AMPLITUDE * Math.exp(-off * off) * fbm(coastNoise, x * 8, y * 8, z * 8, 4, 0.6);
  }

  const t = thresholdForFraction(raw, landFraction);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = raw[i] as number;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }

  for (let i = 0; i < n; i++) {
    if (onProgress && (i & PROGRESS_MASK) === 0) onProgress(0.8 + (0.2 * i) / n);
    const h = raw[i] as number;
    let elev: number;
    if (h > t) {
      const s = (h - t) / (hMax - t);
      const x = positions[i * 3] as number;
      const y = positions[i * 3 + 1] as number;
      const z = positions[i * 3 + 2] as number;
      // Cordilheiras: cristas finas, só em parte do continente e afastadas da costa.
      const ridge = ridged(ridgeNoise, x * 2.2, y * 2.2, z * 2.2, 3);
      const where = smoothstep(-0.15, 0.25, fbm(ridgeMask, x * 1.4, y * 1.4, z * 1.4, 2));
      const inland = smoothstep(0.02, 0.2, s);
      const mountains = Math.pow(ridge, 4) * where * inland * (continent[i] as number);
      elev = 1 + 1400 * Math.pow(s, 1.3) + (MAX_HEIGHT - 1400) * mountains;
    } else {
      const s = (t - h) / (t - hMin);
      // Plataforma continental rasa perto da costa, depois talude e planície abissal. Plataforma larga
      // (teste da 50f0dca, pedido do usuário): no máximo glacial o mar baixa 120 m e ela vira terra,
      // abrindo pontes entre terras próximas.
      const depth = s < SHELF_WIDTH ? (s / SHELF_WIDTH) * SHELF_DEPTH : SHELF_DEPTH + (MAX_DEPTH - SHELF_DEPTH) * Math.pow((s - SHELF_WIDTH) / (1 - SHELF_WIDTH), 0.6);
      elev = -Math.max(5, depth);
    }
    world.elevation[i] = elev;
  }
}

/** Tamanho de cada massa de terra conectada, do maior para o menor. */
export function landComponents(world: WorldState): number[] {
  const { neighbors } = world.grid;
  const seen = new Uint8Array(world.cellCount);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < world.cellCount; s++) {
    if (seen[s] || world.isWater(s)) continue;
    seen[s] = 1;
    stack.push(s);
    let size = 0;
    while (stack.length) {
      const c = stack.pop() as number;
      size++;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        if (!seen[nb] && !world.isWater(nb)) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}
