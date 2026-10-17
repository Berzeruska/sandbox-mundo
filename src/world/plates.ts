import { createRng, type Rng } from '../core/rng';
import type { CubeSphere, Vec3 } from './cubesphere';
import { fbm, Noise3D } from './noise';
import { FAILED_ARM_CHANCE, MICROCONTINENT_CHANCE, MICRO_SHARE_MAX, MICRO_SHARE_MIN, MICRO_SHARE_FLOOR, retraceBorders, sliverAlong, traceArm } from './rifts';
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
/**
 * Guarda polar (G1): nenhum rumo de placa (na dispersão da Pangeia ou num polo novo da tectônica)
 * pode levar o centro dela, ao fim de um estágio, além desta latitude ficando mais perto do polo.
 * Sem isso, a dispersão em "balão" de uma Pangeia tropical mandava os continentes para os polos.
 */
export const POLAR_GUARD = (65 * Math.PI) / 180;
/**
 * Primeiro estágio (dispersão da Pangeia), em rad de giro a velocidade 1: ~2 min de jogo a 20× com
 * Placas 100% (decisão 1 do usuário: a Pangeia se parte em ~2 min). Depois dele, os polos se
 * reorganizam (tectonics.ts). A guarda polar prevê a placa até o fim do estágio mais longo.
 */
export const DISPERSAL_STAGE_MIN = (20 * Math.PI) / 180;
export const DISPERSAL_STAGE = (25 * Math.PI) / 180;
/**
 * Maior número de placas (o desenho guarda a placa em 4 bits: `MAX_SHADER_PLATES` em
 * render/plate-motion.ts). Microcontinentes e braços novos usam números livres até aqui.
 */
export const MAX_PLATE_IDS = 16;
/** Desvios tentados (rad) em volta do rumo "para fora" da Pangeia, do menor para o maior. */
const DISPERSAL_DEVIATIONS = [0, 20, -20, 40, -40, 60, -60, 80, -80].map((d) => (d * Math.PI) / 180);

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
export function plateColor(i: number): [number, number, number] {
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

  // Geração v3 (G3): a Pangeia nasce soldada e se parte já no nascimento por riftes traçados.
  const split = splitPangea(world, seeds);

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
  // Centro da terra de cada placa: é ela que a guarda polar protege (o centro da placa inteira inclui
  // oceano e pode estar longe da terra).
  const landSum = new Float64Array(plates * 3);
  for (const c of landCells) {
    const p = world.plate[c] as number;
    landShare[p] = (landShare[p] as number) + 1;
    for (let d = 0; d < 3; d++) landSum[p * 3 + d] = (landSum[p * 3 + d] as number) + (positions[c * 3 + d] as number);
  }
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
      const speed = Math.min(1, 0.25 + 1.2 * dist) * rng.range(0.9, 1.1);
      const landC = normalize([landSum[p * 3] as number, landSum[p * 3 + 1] as number, landSum[p * 3 + 2] as number]);
      const axis = guardedAxis(c, dir, speed, landC);
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
  // A lasca anda com a média das duas placas do rifte: as duas se afastam dela (a placa de onde ela
  // saiu de um lado, a do outro lado da fenda do outro), e ela fica para trás no oceano que se abre.
  if (split.micro) {
    const a = world.plates[split.micro.parent];
    const b = world.plates[split.micro.across];
    const micro = world.plates[split.micro.id];
    if (a && b && micro) micro.omega = [0, 1, 2].map((k) => ((a.omega[k] as number) + (b.omega[k] as number)) / 2) as Vec3;
  }

  // Classificação das fronteiras (para a camada e, depois, para montanhas e terremotos).
  updateBoundaries(world);
}

/**
 * Geração v3 (G3): as divisas entre as placas da Pangeia viram riftes traçados (serpenteiam, andam em
 * degraus de falha transformante e se encontram em junções tríplices). Em cada junção, com chance
 * FAILED_ARM_CHANCE, um braço falha: as duas placas viram uma só e o traçado fica guardado como
 * aulacógeno (a tectônica cava o vale quando as placas começam a andar). Com chance
 * MICROCONTINENT_CHANCE, uma lasca ao lado de um braço vira placa própria (microcontinente).
 * Sorteio próprio: o terreno e o resto da geração não mudam. Os números das placas ficam seguidos.
 */
function splitPangea(world: WorldState, seeds: Vec3[]): { micro: { id: number; parent: number; across: number } | null } {
  const rng = createRng((world.params.seed ^ 0x3c6ef372) >>> 0);
  const grid = world.grid;
  const n = world.cellCount;
  const region = new Uint8Array(n);
  for (let c = 0; c < n; c++) region[c] = world.crust[c] === Crust.Continental ? 1 : 0;
  // Terra de cada placa: braço que falha não pode juntar duas placas num continente grande demais.
  const land = new Float64Array(seeds.length);
  let totalLand = 0;
  for (let c = 0; c < n; c++) {
    if (world.isWater(c)) continue;
    land[world.plate[c] as number] = (land[world.plate[c] as number] as number) + 1;
    totalLand++;
  }
  const label = Int32Array.from(world.plate);
  const res = retraceBorders({
    grid,
    region,
    label,
    height: (c) => world.heightAboveSea(c),
    rng,
    failChance: FAILED_ARM_CHANCE,
    canKeep: (a, b) => (land[a] as number) + (land[b] as number) <= MAX_LAND_SHARE * totalLand,
  });
  // Placas juntadas por braço que falhou: a placa inteira (também o oceano) fica com o número menor.
  const parent = new Map<number, number>();
  const root = (p: number): number => {
    while (parent.has(p) && parent.get(p) !== p) p = parent.get(p) as number;
    return p;
  };
  for (const { a, b } of res.kept) {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const rootOf = Int32Array.from({ length: seeds.length }, (_, p) => root(p));
  for (let c = 0; c < n; c++) world.plate[c] = region[c] ? (label[c] as number) : (rootOf[world.plate[c] as number] as number);
  world.aulacogens = res.kept.map((k) => k.path);

  // Placa com terra demais (> MAX_LAND_SHARE): um braço traçado corta a terra dela de costa a costa e
  // o lado menor vira placa nova (o braço que corta dentro de uma placa, G3). Senão um continente
  // único ficava com mais de 40% da terra para sempre.
  const landOf = new Float64Array(MAX_PLATE_IDS);
  for (let c = 0; c < n; c++) if (!world.isWater(c)) landOf[world.plate[c] as number] = (landOf[world.plate[c] as number] as number) + 1;
  for (let round = 0; round < 3 && seeds.length < MAX_PLATE_IDS; round++) {
    let big = -1;
    for (let p = 0; p < seeds.length; p++) if ((landOf[p] as number) > MAX_LAND_SHARE * totalLand && (big < 0 || (landOf[p] as number) > (landOf[big] as number))) big = p;
    if (big < 0 || !splitPlate(world, big, seeds, rng, landOf)) break;
  }

  // Microcontinente: lasca ao lado do braço mais comprido.
  let micro: { id: number; parent: number; across: number } | null = null;
  const longest = [...res.cuts].sort((x, y) => y.path.length - x.path.length)[0];
  if (longest && longest.path.length >= 20 && seeds.length < MAX_PLATE_IDS && rng.next() < MICROCONTINENT_CHANCE) {
    const side: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
    let width = rng.int(3, 8);
    let cells = sliverAlong(grid, region, longest.path, side, width);
    if (cells.length < MICRO_SHARE_MIN * n) cells = sliverAlong(grid, region, longest.path, side, (width = 8));
    while (cells.length > MICRO_SHARE_MAX * n && width > 3) cells = sliverAlong(grid, region, longest.path, side, --width);
    if (cells.length >= MICRO_SHARE_FLOOR * n) {
      const count = new Map<number, number>();
      for (const c of cells) count.set(world.plate[c] as number, (count.get(world.plate[c] as number) ?? 0) + 1);
      let from = -1;
      let most = 0;
      for (const [p, k] of count) if (k > most) [from, most] = [p, k];
      const id = seeds.length;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const c of cells) {
        world.plate[c] = id;
        x += grid.positions[c * 3] as number;
        y += grid.positions[c * 3 + 1] as number;
        z += grid.positions[c * 3 + 2] as number;
      }
      seeds.push(normalize([x, y, z]));
      micro = { id, parent: from, across: from === longest.a ? longest.b : longest.a };
    }
  }

  makeContiguous(world, seeds.length);

  // Números seguidos (placas juntadas deixam número vago).
  const used = new Uint8Array(seeds.length);
  for (let c = 0; c < n; c++) used[world.plate[c] as number] = 1;
  const remap = new Int32Array(seeds.length).fill(-1);
  const kept: Vec3[] = [];
  for (let p = 0; p < seeds.length; p++) {
    if (!used[p]) continue;
    remap[p] = kept.length;
    kept.push(seeds[p] as Vec3);
  }
  if (kept.length !== seeds.length) {
    for (let c = 0; c < n; c++) world.plate[c] = remap[world.plate[c] as number] as number;
    seeds.length = 0;
    seeds.push(...kept);
    if (micro) micro = { id: remap[micro.id] as number, parent: remap[micro.parent] as number, across: remap[micro.across] as number };
  }
  return { micro };
}

/**
 * Cada placa uma peça só: o traçado dos riftes pode deixar uma ponta solta do outro lado de um braço.
 * Fica a maior peça de cada placa; as outras passam para a placa vizinha com mais divisa.
 */
function makeContiguous(world: WorldState, plates: number): void {
  const { neighbors } = world.grid;
  const n = world.cellCount;
  // A peça solta vai para a peça principal de uma vizinha; peça cercada só por outras peças soltas
  // espera a rodada seguinte.
  for (let round = 0; round < 4; round++) {
    const comp = new Int32Array(n).fill(-1);
    const size: number[] = [];
    const owner: number[] = [];
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if ((comp[c] as number) >= 0) continue;
      const id = size.length;
      const p = world.plate[c] as number;
      let count = 0;
      comp[c] = id;
      stack.push(c);
      while (stack.length) {
        const k = stack.pop() as number;
        count++;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if ((comp[nb] as number) < 0 && world.plate[nb] === p) {
            comp[nb] = id;
            stack.push(nb);
          }
        }
      }
      size.push(count);
      owner.push(p);
    }
    const biggest = new Int32Array(plates).fill(-1);
    for (let id = 0; id < size.length; id++) {
      const p = owner[id] as number;
      const b = biggest[p] as number;
      if (b < 0 || (size[id] as number) > (size[b] as number)) biggest[p] = id;
    }
    // Divisas de cada peça solta com as outras placas.
    const contact = new Map<number, Map<number, number>>();
    for (let c = 0; c < n; c++) {
      const id = comp[c] as number;
      if (biggest[owner[id] as number] === id) continue;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        const q = world.plate[k] as number;
        // Só a peça principal da vizinha recebe (senão a peça solta ia para outra peça solta).
        if (q === owner[id] || biggest[q] !== comp[k]) continue;
        let m = contact.get(id);
        if (!m) contact.set(id, (m = new Map()));
        m.set(q, (m.get(q) ?? 0) + 1);
      }
    }
    if (!contact.size) return;
    const target = new Map<number, number>();
    for (const [id, m] of contact) {
      let best = -1;
      let most = 0;
      for (const [q, k] of m) if (k > most || (k === most && q < best)) [best, most] = [q, k];
      target.set(id, best);
    }
    for (let c = 0; c < n; c++) {
      const to = target.get(comp[c] as number);
      if (to !== undefined) world.plate[c] = to;
    }
  }
}

/**
 * Corta a terra da placa `p` por um braço de rifte traçado de costa a costa, passando perto do centro
 * da terra dela; o lado menor (e o oceano mais perto dele) vira placa nova. Retorna se cortou.
 */
function splitPlate(world: WorldState, p: number, seeds: Vec3[], rng: Rng, landOf: Float64Array): boolean {
  const grid = world.grid;
  const n = world.cellCount;
  const { neighbors, positions } = grid;
  const region = new Uint8Array(n);
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (let c = 0; c < n; c++) {
    if (world.plate[c] !== p || world.crust[c] !== Crust.Continental) continue;
    region[c] = 1;
    x += positions[c * 3] as number;
    y += positions[c * 3 + 1] as number;
    z += positions[c * 3 + 2] as number;
    count++;
  }
  if (!count) return false;
  const center = normalize([x, y, z]);
  const P = (c: number): Vec3 => [positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number];
  const edge = (c: number): boolean => {
    for (let d = 0; d < 4; d++) if (!region[neighbors[c * 4 + d] as number]) return true;
    return false;
  };
  // Começa na borda, num ponto sorteado; segue para o centro e termina na borda do outro lado.
  const border: number[] = [];
  for (let c = 0; c < n; c++) if (region[c] && edge(c)) border.push(c);
  if (border.length < 8) return false;
  const start = border[rng.int(0, border.length - 1)] as number;
  const s = P(start);
  const toCenter: Vec3 = [center[0] - s[0], center[1] - s[1], center[2] - s[2]];
  const reach = Math.hypot(...toCenter);
  const goal = (c: number): boolean => {
    if (!edge(c)) return false;
    const q = P(c);
    return Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]) > 1.4 * reach;
  };
  const path = traceArm({ grid, allowed: region, start, direction: toCenter, goal, height: (c) => world.heightAboveSea(c), rng, noise: new Noise3D(rng) });
  if (!path) return false;
  // Os dois lados do braço.
  const onPath = new Uint8Array(n);
  for (const c of path) onPath[c] = 1;
  const seen = new Uint8Array(n);
  const comps: number[][] = [];
  for (let c = 0; c < n; c++) {
    if (!region[c] || onPath[c] || seen[c]) continue;
    const comp: number[] = [];
    const stack = [c];
    seen[c] = 1;
    while (stack.length) {
      const k = stack.pop() as number;
      comp.push(k);
      for (let d = 0; d < 4; d++) {
        const m = neighbors[k * 4 + d] as number;
        if (region[m] && !onPath[m] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const side = comps[1];
  if (!side || side.length < 0.25 * count) return false;
  // Lado menor e o oceano da placa mais perto dele que da outra terra: placa nova.
  const id = seeds.length;
  const owner = new Int8Array(n).fill(-1);
  let frontier: number[] = [];
  for (const c of side) {
    owner[c] = 1;
    frontier.push(c);
  }
  for (let c = 0; c < n; c++) {
    if (region[c] && owner[c] === -1) {
      owner[c] = 0;
      frontier.push(c);
    }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        if (owner[k] !== -1 || world.plate[k] !== p) continue;
        owner[k] = owner[c] as number;
        next.push(k);
      }
    }
    frontier = next;
  }
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let c = 0; c < n; c++) {
    if (owner[c] !== 1) continue;
    world.plate[c] = id;
    if (!world.isWater(c)) {
      landOf[p] = (landOf[p] as number) - 1;
      landOf[id] = (landOf[id] as number) + 1;
    }
    sx += positions[c * 3] as number;
    sy += positions[c * 3 + 1] as number;
    sz += positions[c * 3 + 2] as number;
  }
  seeds.push(normalize([sx, sy, sz]));
  return true;
}

/** Gira o ponto `p` pelo ângulo `a` em torno do eixo unitário `k` (Rodrigues). */
export function rotateAbout(p: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = dot(k, p);
  const x = cross(k, p);
  return [p[0] * c + x[0] * s + k[0] * d * (1 - c), p[1] * c + x[1] * s + k[1] * d * (1 - c), p[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

/**
 * Eixo da placa com centro `c` andando no rumo `dir` (tangente), girando o rumo o mínimo possível
 * (DISPERSAL_DEVIATIONS) para o ponto `guard` (centro da terra da placa) não passar de POLAR_GUARD,
 * rumo ao polo, num estágio.
 * Sem sorteio: não muda o resto da geração.
 */
function guardedAxis(c: Vec3, dir: Vec3, speed: number, guard: Vec3): Vec3 {
  const side = normalize(cross(c, dir));
  const latNow = Math.abs(Math.asin(Math.max(-1, Math.min(1, guard[1]))));
  let best: Vec3 | null = null;
  let bestLat = Infinity;
  for (const a of DISPERSAL_DEVIATIONS) {
    const d = normalize([
      dir[0] * Math.cos(a) + side[0] * Math.sin(a),
      dir[1] * Math.cos(a) + side[1] * Math.sin(a),
      dir[2] * Math.cos(a) + side[2] * Math.sin(a),
    ]);
    const axis = normalize(cross(c, d));
    // Maior latitude que o centro atinge ao longo do estágio (amostrado), não só a do fim.
    let lat = 0;
    for (let k = 1; k <= 4; k++) {
      const e = rotateAbout(guard, axis, (speed * DISPERSAL_STAGE * k) / 4);
      lat = Math.max(lat, Math.abs(Math.asin(Math.max(-1, Math.min(1, e[1])))));
    }
    if (lat <= POLAR_GUARD || lat <= latNow) return axis;
    if (lat < bestLat) {
      bestLat = lat;
      best = axis;
    }
  }
  return best ?? normalize(cross(c, dir));
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
  const sc = boundaryScratch(world.grid, n);
  const original = sc.original;
  original.set(world.boundary);
  const seen = sc.seen.fill(-1);
  let frontier = sc.frontier;
  let next = sc.next;
  const votes = sc.votes;
  for (let i = 0; i < n; i++) {
    if (!original[i]) continue;
    votes.fill(0);
    // Busca em largura limitada, só por células de fronteira.
    frontier[0] = i;
    let count = 1;
    seen[i] = i;
    for (let step = 0; step <= BOUNDARY_VOTE_STEPS && count; step++) {
      let nextCount = 0;
      for (let k = 0; k < count; k++) {
        const c = frontier[k] as number;
        votes[original[c] as number] = (votes[original[c] as number] as number) + 1;
        if (step === BOUNDARY_VOTE_STEPS) continue;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          if (original[nb] && seen[nb] !== i) {
            seen[nb] = i;
            next[nextCount++] = nb;
          }
        }
      }
      const t = frontier;
      frontier = next;
      next = t;
      count = nextCount;
    }
    let best = original[i] as number;
    for (let k = 1; k <= 3; k++) if ((votes[k] as number) > (votes[best] as number)) best = k;
    world.boundary[i] = best;
  }
}

/**
 * Arrays de trabalho do voto das fronteiras, um conjunto por grade: ele roda duas vezes a cada
 * recomposição, e recriar tudo virava lixo para a limpeza de memória.
 */
const boundaryScratches = new WeakMap<CubeSphere, { original: Uint8Array; seen: Int32Array; frontier: Int32Array; next: Int32Array; votes: Int32Array }>();

function boundaryScratch(grid: CubeSphere, n: number) {
  let s = boundaryScratches.get(grid);
  if (!s) {
    s = { original: new Uint8Array(n), seen: new Int32Array(n), frontier: new Int32Array(n), next: new Int32Array(n), votes: new Int32Array(4) };
    boundaryScratches.set(grid, s);
  }
  return s;
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
  // Mesma conta de antes (normalize, cross, dot), escrita sem criar vetores: roda em todas as
  // células a cada recomposição, e os vetores temporários eram lixo para a limpeza de memória.
  const { positions, neighbors } = world.grid;
  const plates = world.plates;
  const pi = world.plate[i] as number;
  const px = positions[i * 3] as number;
  const py = positions[i * 3 + 1] as number;
  const pz = positions[i * 3 + 2] as number;
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
    const qx = positions[j * 3] as number;
    const qy = positions[j * 3 + 1] as number;
    const qz = positions[j * 3 + 2] as number;
    const tx0 = qx - px;
    const ty0 = qy - py;
    const tz0 = qz - pz;
    const l = Math.hypot(tx0, ty0, tz0) || 1;
    const tx = tx0 / l;
    const ty = ty0 / l;
    const tz = tz0 / l;
    const wa = a.omega;
    const wb = b.omega;
    const vax = wa[1] * pz - wa[2] * py;
    const vay = wa[2] * px - wa[0] * pz;
    const vaz = wa[0] * py - wa[1] * px;
    const vbx = wb[1] * qz - wb[2] * qy;
    const vby = wb[2] * qx - wb[0] * qz;
    const vbz = wb[0] * qy - wb[1] * qx;
    const rx = vax - vbx;
    const ry = vay - vby;
    const rz = vaz - vbz;
    const normal = rx * tx + ry * ty + rz * tz; // > 0: esta placa avança sobre a vizinha
    const tangent = Math.hypot(rx - normal * tx, ry - normal * ty, rz - normal * tz);
    if (Math.abs(normal) + tangent > Math.abs(bestNormal) + bestTangent) {
      bestNormal = normal;
      bestTangent = tangent;
    }
  }
  if (!found) return Boundary.None;
  if (Math.abs(bestNormal) < 0.5 * bestTangent) return Boundary.Transform;
  return bestNormal > 0 ? Boundary.Convergent : Boundary.Divergent;
}
