import { createRng, type Rng } from '../core/rng';
import type { Vec3 } from './cubesphere';
import { fbm, Noise3D } from './noise';
import type { WorldState } from './state';

/**
 * Placas tectônicas (Marco 2, T3): divisão do planeta em placas, tipo de crosta e movimento.
 * Aqui só nascem as placas e seus eixos; o movimento de verdade entra na T4.
 */

export const MIN_PLATES = 8;
export const MAX_PLATES = 14;
/** Abaixo desta profundidade (m, relativa ao nível do mar) a crosta é oceânica. */
export const CONTINENTAL_DEPTH = -500;
/** Fração mínima de crosta continental para a placa ser tratada como continental. */
export const CONTINENTAL_PLATE_FRACTION = 0.3;
/** Quantas sementes caem na terra (repartem a Pangeia). */
export const LAND_SEEDS_MIN = 5;
export const LAND_SEEDS_MAX = 8;
/** Placa com pelo menos esta fração da terra do mundo entra na expansão da Pangeia. */
export const PANGEA_PLATE_SHARE = 0.03;
/** Nenhuma placa com mais que esta fração da terra (senão ela ganha mais uma semente). */
export const MAX_LAND_SHARE = 0.35;

export const Crust = { Oceanic: 0, Continental: 1 } as const;
export type Crust = (typeof Crust)[keyof typeof Crust];

export const Boundary = { None: 0, Convergent: 1, Divergent: 2, Transform: 3 } as const;
export type Boundary = (typeof Boundary)[keyof typeof Boundary];

export interface Plate {
  id: number;
  /** Semente do Voronoi que originou a placa. */
  seed: Vec3;
  /** Centro (direção média das células da placa). */
  center: Vec3;
  /**
   * Velocidade angular: eixo de rotação (polo de Euler) vezes a velocidade relativa (0,3–1).
   * A velocidade de um ponto p da placa é ω × p. A escala de tempo real entra na T4.
   */
  omega: Vec3;
  /** Fração de crosta continental. */
  continental: number;
  /** Cor da placa na camada "Ver placas". */
  color: readonly [number, number, number];
}

/** Semente própria das placas: o terreno da mesma semente continua idêntico ao de antes. */
function plateRng(seed: number): Rng {
  return createRng((seed ^ 0x5bd1e995) >>> 0);
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function randomUnit(rng: Rng): Vec3 {
  const z = rng.range(-1, 1);
  const t = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

/** Cor distinta por placa (matizes espaçados pela razão áurea). */
function plateColor(i: number): [number, number, number] {
  const h = (i * 0.618034) % 1;
  const s = 0.55;
  const l = 0.55;
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Direção média da terra firme (centro do supercontinente). */
export function landCentroid(world: WorldState): Vec3 {
  const { positions } = world.grid;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < world.cellCount; i++) {
    if (world.isWater(i)) continue;
    x += positions[i * 3] as number;
    y += positions[i * 3 + 1] as number;
    z += positions[i * 3 + 2] as number;
  }
  const len = Math.hypot(x, y, z);
  return len > 1e-9 ? [x / len, y / len, z / len] : [0, 0, 1];
}

/** Escolhe sementes afastadas entre si (tenta algumas vezes antes de aceitar uma mais perto). */
function pickSeeds(count: number, candidates: () => Vec3, existing: Vec3[], minAngle: number): Vec3[] {
  const out: Vec3[] = [];
  const cosMin = Math.cos(minAngle);
  for (let k = 0; k < count; k++) {
    let best: Vec3 = candidates();
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = attempt === 0 ? best : candidates();
      if ([...existing, ...out].every((s) => dot(s, c) < cosMin)) {
        best = c;
        break;
      }
    }
    out.push(best);
  }
  return out;
}

/**
 * Gera as placas: Voronoi na esfera com pesos (placas de tamanhos variados) e deformação por ruído
 * (fronteiras orgânicas); depois garante que cada placa é uma peça só. Algumas sementes caem dentro
 * da Pangeia, para ela ficar repartida e poder se partir. Placas continentais recebem movimento
 * para fora do centro do supercontinente.
 */
export function generatePlates(world: WorldState): void {
  const rng = plateRng(world.params.seed);
  const { positions } = world.grid;
  const n = world.cellCount;

  // Crosta: continental onde é terra ou plataforma rasa.
  for (let i = 0; i < n; i++) {
    world.crust[i] = world.heightAboveSea(i) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic;
  }

  // Sementes: várias na terra (a Pangeia fica repartida em pedaços de tamanhos variados), o resto
  // em qualquer lugar. Pesos diferentes deixam umas placas grandes e outras pequenas.
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) if (!world.isWater(i)) landCells.push(i);
  const cellPoint = (c: number): Vec3 => [positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number];
  const count = rng.int(MIN_PLATES, MAX_PLATES);
  const onLand = Math.min(count - 3, rng.int(LAND_SEEDS_MIN, LAND_SEEDS_MAX));
  const landSeeds = landCells.length
    ? pickSeeds(onLand, () => cellPoint(landCells[rng.int(0, landCells.length - 1)] as number), [], 0.3)
    : [];
  const seeds = [...landSeeds, ...pickSeeds(count - landSeeds.length, () => randomUnit(rng), landSeeds, 0.5)];
  const weights = seeds.map(() => rng.range(0.6, 1.6));

  // Custo de atravessar cada célula (ruído): as placas crescem mais devagar onde ele é alto, então
  // as fronteiras ficam recortadas em vez de arcos lisos.
  const costNoise = new Noise3D(rng);
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    cost[i] = 1 + 0.85 * fbm(costNoise, x * 5, y * 5, z * 5, 5, 0.6);
  }
  growRegions(world, seeds, weights, cost);

  // Nenhuma placa com mais que MAX_LAND_SHARE da terra: a que passar ganha mais uma semente na
  // terra dela (longe da semente atual) e as regiões crescem de novo.
  for (let round = 0; round < 4 && seeds.length < MAX_PLATES; round++) {
    const share = new Float64Array(seeds.length);
    for (const c of landCells) share[world.plate[c] as number] = (share[world.plate[c] as number] as number) + 1;
    let worst = 0;
    for (let p = 1; p < seeds.length; p++) if ((share[p] as number) > (share[worst] as number)) worst = p;
    if ((share[worst] as number) <= MAX_LAND_SHARE * landCells.length) break;
    const s0 = seeds[worst] as Vec3;
    let far = -1;
    let farDot = Infinity;
    for (const c of landCells) {
      if (world.plate[c] !== worst) continue;
      const d = (positions[c * 3] as number) * s0[0] + (positions[c * 3 + 1] as number) * s0[1] + (positions[c * 3 + 2] as number) * s0[2];
      if (d < farDot) {
        farDot = d;
        far = c;
      }
    }
    if (far < 0) break;
    seeds.push(cellPoint(far));
    weights.push(rng.range(0.8, 1.3));
    growRegions(world, seeds, weights, cost);
  }

  // Centros e fração continental.
  const plates = seeds.length;
  const center = new Float64Array(plates * 3);
  const cells = new Uint32Array(plates);
  const continental = new Uint32Array(plates);
  for (let i = 0; i < n; i++) {
    const p = world.plate[i] as number;
    center[p * 3] = (center[p * 3] as number) + (positions[i * 3] as number);
    center[p * 3 + 1] = (center[p * 3 + 1] as number) + (positions[i * 3 + 1] as number);
    center[p * 3 + 2] = (center[p * 3 + 2] as number) + (positions[i * 3 + 2] as number);
    cells[p] = (cells[p] as number) + 1;
    if (world.crust[i] === Crust.Continental) continental[p] = (continental[p] as number) + 1;
  }

  // Movimento: expansão a partir do centro do supercontinente. A velocidade cresce com a distância
  // ao centro, então todo par de placas vizinhas da Pangeia se afasta (como um balão inflando) e ela
  // se parte em vários continentes, não em dois. Entram na expansão as placas com pelo menos
  // PANGEA_PLATE_SHARE da terra (mesmo que tenham mais oceano que terra); a placa bem no centro fica
  // quase parada. Um desvio aleatório pequeno evita que pareça simétrico.
  const land = landCentroid(world);
  const landShare = new Float64Array(plates);
  for (const c of landCells) landShare[world.plate[c] as number] = (landShare[world.plate[c] as number] as number) + 1;
  world.plates = [];
  for (let p = 0; p < plates; p++) {
    const c = normalize([center[p * 3] as number, center[p * 3 + 1] as number, center[p * 3 + 2] as number]);
    const contFraction = (continental[p] as number) / Math.max(1, cells[p] as number);
    const inPangea = (landShare[p] as number) >= PANGEA_PLATE_SHARE * Math.max(1, landCells.length);
    let omega: Vec3;
    const away: Vec3 = [c[0] - land[0], c[1] - land[1], c[2] - land[2]];
    const along = dot(away, c);
    const tangent: Vec3 = [away[0] - along * c[0], away[1] - along * c[1], away[2] - along * c[2]];
    const dist = Math.hypot(...tangent);
    if (inPangea && dist > 0.02) {
      const d = normalize(tangent);
      const side = normalize(cross(c, d));
      const a = rng.range(-0.2, 0.2);
      const dir = normalize([
        d[0] * Math.cos(a) + side[0] * Math.sin(a),
        d[1] * Math.cos(a) + side[1] * Math.sin(a),
        d[2] * Math.cos(a) + side[2] * Math.sin(a),
      ]);
      const axis = normalize(cross(c, dir));
      const speed = Math.min(1, 0.25 + 1.2 * dist) * rng.range(0.9, 1.1);
      omega = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    } else if (inPangea) {
      // Bem no centro: quase parada (as vizinhas é que se afastam dela).
      const axis = randomUnit(rng);
      omega = [axis[0] * 0.1, axis[1] * 0.1, axis[2] * 0.1];
    } else {
      const axis = randomUnit(rng);
      const speed = rng.range(0.3, 0.8);
      omega = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    }
    world.plates.push({ id: p, seed: seeds[p] as Vec3, center: c, omega, continental: contFraction, color: plateColor(p) });
  }

  // Classificação das fronteiras (para a camada e, depois, para montanhas e terremotos).
  updateBoundaries(world);
}

/** Reclassifica todas as fronteiras (depois de gerar ou de mover as placas). */
export function updateBoundaries(world: WorldState): void {
  for (let i = 0; i < world.cellCount; i++) world.boundary[i] = classifyBoundary(world, i);
  // Duas rodadas de voto: células isoladas com tipo diferente caem de ~5–10% para ~0,3%.
  smoothBoundaries(world);
  smoothBoundaries(world);
}

/** Raio (em passos de vizinhança) do voto que uniformiza os trechos de fronteira. */
const BOUNDARY_VOTE_STEPS = 3;

/**
 * Cada célula de fronteira adota o tipo da maioria das fronteiras em volta. Perto do limite entre
 * "afastando" e "deslizando", células vizinhas caíam em tipos diferentes e a linha ficava salpicada;
 * na geologia real, um trecho de fronteira tem um tipo só.
 */
export function smoothBoundaries(world: WorldState): void {
  const { neighbors } = world.grid;
  const n = world.cellCount;
  const original = Uint8Array.from(world.boundary);
  const seen = new Int32Array(n).fill(-1);
  const votes = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!original[i]) continue;
    votes.fill(0);
    // Busca em largura limitada, só por células de fronteira.
    let frontier = [i];
    seen[i] = i;
    for (let step = 0; step <= BOUNDARY_VOTE_STEPS && frontier.length; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        votes[original[c] as number] = (votes[original[c] as number] as number) + 1;
        if (step === BOUNDARY_VOTE_STEPS) continue;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          if (original[nb] && seen[nb] !== i) {
            seen[nb] = i;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    let best = original[i] as number;
    for (let k = 1; k <= 3; k++) if ((votes[k] as number) > (votes[best] as number)) best = k;
    world.boundary[i] = best;
  }
}

/**
 * Crescimento de regiões (Dijkstra a partir das sementes): cada célula fica com a placa que chega
 * nela pelo caminho de menor custo, dividido pelo peso da placa. As placas saem contíguas por
 * construção e as fronteiras seguem os "vales" do ruído de custo.
 */
function growRegions(world: WorldState, seeds: readonly Vec3[], weights: readonly number[], cost: Float32Array): void {
  const { neighbors } = world.grid;
  const n = world.cellCount;
  const dist = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap(n * 2);
  seeds.forEach((s, k) => {
    const c = world.grid.pointToCell(s[0], s[1], s[2]);
    dist[c] = 0;
    world.plate[c] = k;
    heap.push(0, c);
  });
  while (heap.size) {
    const d = heap.topKey();
    const c = heap.pop();
    if (d > (dist[c] as number)) continue;
    const label = world.plate[c] as number;
    const w = weights[label] as number;
    for (let k = 0; k < 4; k++) {
      const nb = neighbors[c * 4 + k] as number;
      const nd = d + ((cost[c] as number) + (cost[nb] as number)) / (2 * w);
      if (nd < (dist[nb] as number)) {
        dist[nb] = nd;
        world.plate[nb] = label;
        heap.push(nd, nb);
      }
    }
  }
}

/** Fila de prioridade mínima (chaves float, valores inteiros), em arrays tipados que crescem. */
class MinHeap {
  private keys: Float32Array;
  private values: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float32Array(capacity);
    this.values = new Int32Array(capacity);
  }

  push(key: number, value: number): void {
    if (this.size === this.keys.length) {
      const k = new Float32Array(this.keys.length * 2);
      k.set(this.keys);
      const v = new Int32Array(this.values.length * 2);
      v.set(this.values);
      this.keys = k;
      this.values = v;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] as number) <= key) break;
      this.keys[i] = this.keys[parent] as number;
      this.values[i] = this.values[parent] as number;
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }

  topKey(): number {
    return this.keys[0] as number;
  }

  pop(): number {
    const top = this.values[0] as number;
    const lastKey = this.keys[--this.size] as number;
    const lastValue = this.values[this.size] as number;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const child = r < this.size && (this.keys[r] as number) < (this.keys[l] as number) ? r : l;
      if ((this.keys[child] as number) >= lastKey) break;
      this.keys[i] = this.keys[child] as number;
      this.values[i] = this.values[child] as number;
      i = child;
    }
    this.keys[i] = lastKey;
    this.values[i] = lastValue;
    return top;
  }
}

/** Velocidade (vetor tangente) de um ponto da placa: ω × p. */
export function plateVelocity(plate: Plate, p: Vec3): Vec3 {
  return cross(plate.omega, p);
}

/**
 * Tipo de fronteira de uma célula: compara o movimento da placa dela com o de cada placa vizinha.
 * Aproximando = convergente; afastando = divergente; deslizando de lado = transformante.
 */
export function classifyBoundary(world: WorldState, i: number): Boundary {
  const { positions, neighbors } = world.grid;
  const plates = world.plates;
  const pi = world.plate[i] as number;
  const p: Vec3 = [positions[i * 3] as number, positions[i * 3 + 1] as number, positions[i * 3 + 2] as number];
  let bestNormal = 0;
  let bestTangent = 0;
  let found = false;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[i * 4 + d] as number;
    const pj = world.plate[j] as number;
    if (pj === pi) continue;
    const a = plates[pi];
    const b = plates[pj];
    if (!a || !b) continue;
    found = true;
    const q: Vec3 = [positions[j * 3] as number, positions[j * 3 + 1] as number, positions[j * 3 + 2] as number];
    const toward = normalize([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    const va = plateVelocity(a, p);
    const vb = plateVelocity(b, q);
    const rel: Vec3 = [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]];
    const normal = dot(rel, toward); // > 0: esta placa avança sobre a vizinha
    const tangent = Math.hypot(rel[0] - normal * toward[0], rel[1] - normal * toward[1], rel[2] - normal * toward[2]);
    if (Math.abs(normal) + tangent > Math.abs(bestNormal) + bestTangent) {
      bestNormal = normal;
      bestTangent = tangent;
    }
  }
  if (!found) return Boundary.None;
  if (Math.abs(bestNormal) < 0.5 * bestTangent) return Boundary.Transform;
  return bestNormal > 0 ? Boundary.Convergent : Boundary.Divergent;
}
