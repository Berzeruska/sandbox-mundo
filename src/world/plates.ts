import { createRng, type Rng } from '../core/rng';
import type { Vec3 } from './cubesphere';
import { Noise3D } from './noise';
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

export const Crust = { Oceanic: 0, Continental: 1 } as const;
export type Crust = (typeof Crust)[keyof typeof Crust];

export const Boundary = { None: 0, Convergent: 1, Divergent: 2, Transform: 3 } as const;
export type Boundary = (typeof Boundary)[keyof typeof Boundary];

export interface Plate {
  id: number;
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
  const count = rng.int(MIN_PLATES, MAX_PLATES);

  // Crosta: continental onde é terra ou plataforma rasa.
  for (let i = 0; i < n; i++) {
    world.crust[i] = world.heightAboveSea(i) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic;
  }

  // Sementes: algumas na terra (repartem a Pangeia), o resto em qualquer lugar.
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) if (!world.isWater(i)) landCells.push(i);
  const cellPoint = (c: number): Vec3 => [positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number];
  const onLand = Math.min(count - 2, rng.int(3, 5));
  const landSeeds = landCells.length
    ? pickSeeds(onLand, () => cellPoint(landCells[rng.int(0, landCells.length - 1)] as number), [], 0.45)
    : [];
  const seeds = [...landSeeds, ...pickSeeds(count - landSeeds.length, () => randomUnit(rng), landSeeds, 0.5)];
  const weights = seeds.map(() => rng.range(0.7, 1.35));

  // Deformação do domínio (fronteiras curvas).
  const wx = new Noise3D(rng);
  const wy = new Noise3D(rng);
  const wz = new Noise3D(rng);
  // Uma oitava basta para fronteiras curvas e custa metade de duas (é a parte cara das placas).
  const WARP = 0.22;
  const F = 2.1;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    const px = x + WARP * wx.sample(x * F, y * F, z * F);
    const py = y + WARP * wy.sample(x * F, y * F, z * F);
    const pz = z + WARP * wz.sample(x * F, y * F, z * F);
    const len = Math.hypot(px, py, pz);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < seeds.length; k++) {
      const s = seeds[k] as Vec3;
      const w = weights[k] as number;
      // Distância de corda ao quadrado, dividida pelo peso: barata (sem acos) e monotônica.
      const d = (2 - (2 * (px * s[0] + py * s[1] + pz * s[2])) / len) / (w * w);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    world.plate[i] = best;
  }

  makeContiguous(world, count);

  // Centros, fração continental e movimento.
  const center = new Float64Array(count * 3);
  const cells = new Uint32Array(count);
  const continental = new Uint32Array(count);
  for (let i = 0; i < n; i++) {
    const p = world.plate[i] as number;
    center[p * 3] = (center[p * 3] as number) + (positions[i * 3] as number);
    center[p * 3 + 1] = (center[p * 3 + 1] as number) + (positions[i * 3 + 1] as number);
    center[p * 3 + 2] = (center[p * 3 + 2] as number) + (positions[i * 3 + 2] as number);
    cells[p] = (cells[p] as number) + 1;
    if (world.crust[i] === Crust.Continental) continental[p] = (continental[p] as number) + 1;
  }
  const land = landCentroid(world);
  world.plates = [];
  for (let p = 0; p < count; p++) {
    const c = normalize([center[p * 3] as number, center[p * 3 + 1] as number, center[p * 3 + 2] as number]);
    const contFraction = (continental[p] as number) / Math.max(1, cells[p] as number);
    let omega: Vec3;
    // Para fora do centro do supercontinente, no plano tangente da placa.
    const away: Vec3 = [c[0] - land[0], c[1] - land[1], c[2] - land[2]];
    const along = dot(away, c);
    const tangent: Vec3 = [away[0] - along * c[0], away[1] - along * c[1], away[2] - along * c[2]];
    if (contFraction >= CONTINENTAL_PLATE_FRACTION && Math.hypot(...tangent) > 0.05) {
      // Direção de afastamento com um desvio aleatório; eixo = c × direção (então ω × c aponta para ela).
      const d = normalize(tangent);
      const side = normalize(cross(c, d));
      const a = rng.range(-0.5, 0.5);
      const dir = normalize([
        d[0] * Math.cos(a) + side[0] * Math.sin(a),
        d[1] * Math.cos(a) + side[1] * Math.sin(a),
        d[2] * Math.cos(a) + side[2] * Math.sin(a),
      ]);
      const axis = normalize(cross(c, dir));
      const speed = rng.range(0.5, 1);
      omega = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    } else {
      const axis = randomUnit(rng);
      const speed = rng.range(0.3, 0.9);
      omega = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    }
    world.plates.push({ id: p, center: c, omega, continental: contFraction, color: plateColor(p) });
  }

  // Classificação das fronteiras (para a camada e, depois, para montanhas e terremotos).
  for (let i = 0; i < n; i++) world.boundary[i] = classifyBoundary(world, i);
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
 * Cada placa fica com o seu maior pedaço contínuo; pedaços soltos passam para a placa vizinha
 * que mais os cerca. Repete até não sobrar pedaço solto.
 */
function makeContiguous(world: WorldState, count: number): void {
  const { neighbors } = world.grid;
  const n = world.cellCount;
  const comp = new Int32Array(n);
  for (let round = 0; round < 10; round++) {
    comp.fill(-1);
    const compPlate: number[] = [];
    const compSize: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      const id = compPlate.length;
      const plate = world.plate[s] as number;
      compPlate.push(plate);
      compSize.push(0);
      comp[s] = id;
      stack.push(s);
      while (stack.length) {
        const c = stack.pop() as number;
        compSize[id] = (compSize[id] as number) + 1;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          if (comp[nb] === -1 && world.plate[nb] === plate) {
            comp[nb] = id;
            stack.push(nb);
          }
        }
      }
    }
    // Maior pedaço de cada placa.
    const keep = new Array<number>(count).fill(-1);
    for (let id = 0; id < compPlate.length; id++) {
      const p = compPlate[id] as number;
      const k = keep[p] as number;
      if (k === -1 || (compSize[id] as number) > (compSize[k] as number)) keep[p] = id;
    }
    let moved = false;
    for (let id = 0; id < compPlate.length; id++) {
      if (keep[compPlate[id] as number] === id) continue;
      // Pedaço solto: vai para a placa vizinha mais frequente na borda dele.
      const votes = new Map<number, number>();
      for (let c = 0; c < n; c++) {
        if (comp[c] !== id) continue;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          if (comp[nb] !== id) votes.set(world.plate[nb] as number, (votes.get(world.plate[nb] as number) ?? 0) + 1);
        }
      }
      let target = compPlate[id] as number;
      let bestVotes = -1;
      for (const [p, v] of votes) {
        if (v > bestVotes) {
          bestVotes = v;
          target = p;
        }
      }
      for (let c = 0; c < n; c++) if (comp[c] === id) world.plate[c] = target;
      moved = true;
    }
    if (!moved) return;
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
