import { createRng, type Rng } from '../core/rng';
import { Boundary, Crust } from './plates';
import { provinceNoiseFor, provinceRigidity } from './tectonics';
import type { WorldState } from './state';

/**
 * Recursos minerais e petróleo (T6). Jazidas geradas pela geologia, não espalhadas ao acaso: cada
 * tipo nasce no ambiente em que se forma no mundo real (`docs/03-mundo-geologia.md`), em províncias
 * (regiões ricas num tipo, poucas jazidas e importantes). Também se formam durante a deriva (arco de
 * subducção, colisão, rifte). Uma jazida é um grupinho de células com o mesmo código; o código fica na
 * crosta da tectônica, então anda com a placa e some quando a crosta afunda.
 *
 * Só geração e visualização; o uso é dos Marcos 4 e 7.
 */

export const Resource = {
  None: 0,
  Iron: 1,
  Copper: 2,
  Gold: 3,
  Silver: 4,
  Tin: 5,
  Bauxite: 6,
  Manganese: 7,
  Chromium: 8,
  Niobium: 9,
  RareEarths: 10,
  Lithium: 11,
  Oil: 12,
  Coal: 13,
  Uranium: 14,
  Potash: 15,
  Nitrates: 16,
  Salt: 17,
  Sulfur: 18,
  Limestone: 19,
} as const;
export type Resource = (typeof Resource)[keyof typeof Resource];

export type ResourceGroup = 'metais' | 'energia' | 'agricultura' | 'industria';

export const RESOURCE_GROUPS: readonly { id: ResourceGroup; label: string }[] = [
  { id: 'metais', label: 'Metais' },
  { id: 'energia', label: 'Energia' },
  { id: 'agricultura', label: 'Agricultura' },
  { id: 'industria', label: 'Indústria' },
];

export interface ResourceInfo {
  id: Resource;
  name: string;
  group: ResourceGroup;
  /** Cor do tipo (pedrinhas de perto, camada "Ver recursos" e legenda), 0–255. */
  color: readonly [number, number, number];
  /** Profundidade típica (metros), para o uso nos Marcos 4 e 7. */
  depth: number;
}

/** Índice = código do tipo (o 0 é "nenhum"). */
export const RESOURCE_INFO: readonly ResourceInfo[] = [
  { id: Resource.None, name: '—', group: 'metais', color: [0, 0, 0], depth: 0 },
  { id: Resource.Iron, name: 'Ferro', group: 'metais', color: [172, 74, 46], depth: 200 },
  { id: Resource.Copper, name: 'Cobre', group: 'metais', color: [62, 168, 132], depth: 600 },
  { id: Resource.Gold, name: 'Ouro', group: 'metais', color: [222, 170, 36], depth: 800 },
  { id: Resource.Silver, name: 'Prata', group: 'metais', color: [205, 210, 222], depth: 600 },
  { id: Resource.Tin, name: 'Estanho', group: 'metais', color: [128, 140, 168], depth: 400 },
  { id: Resource.Bauxite, name: 'Alumínio (bauxita)', group: 'metais', color: [222, 118, 52], depth: 10 },
  { id: Resource.Manganese, name: 'Manganês', group: 'metais', color: [104, 66, 110], depth: 150 },
  { id: Resource.Chromium, name: 'Cromo', group: 'metais', color: [46, 82, 108], depth: 500 },
  { id: Resource.Niobium, name: 'Nióbio', group: 'metais', color: [126, 92, 214], depth: 100 },
  { id: Resource.RareEarths, name: 'Terras raras', group: 'metais', color: [226, 92, 176], depth: 200 },
  { id: Resource.Lithium, name: 'Lítio', group: 'metais', color: [140, 222, 236], depth: 50 },
  { id: Resource.Oil, name: 'Petróleo', group: 'energia', color: [26, 22, 30], depth: 3000 },
  { id: Resource.Coal, name: 'Carvão', group: 'energia', color: [62, 62, 62], depth: 300 },
  { id: Resource.Uranium, name: 'Urânio', group: 'energia', color: [150, 228, 62], depth: 400 },
  { id: Resource.Potash, name: 'Potássio', group: 'agricultura', color: [232, 140, 140], depth: 900 },
  { id: Resource.Nitrates, name: 'Nitratos', group: 'agricultura', color: [244, 232, 158], depth: 5 },
  { id: Resource.Salt, name: 'Sal', group: 'industria', color: [246, 246, 248], depth: 500 },
  { id: Resource.Sulfur, name: 'Enxofre', group: 'industria', color: [236, 222, 32], depth: 300 },
  { id: Resource.Limestone, name: 'Calcário', group: 'industria', color: [200, 194, 172], depth: 20 },
];
export const RESOURCE_TYPES = RESOURCE_INFO.length - 1;

/** Tamanho da jazida: pequena 1–2 células, média 3–6, grande 8–15. */
export const DepositSize = { Small: 1, Medium: 2, Large: 3 } as const;
export type DepositSize = (typeof DepositSize)[keyof typeof DepositSize];
const SIZE_CELLS: Record<DepositSize, readonly [number, number]> = { 1: [1, 2], 2: [3, 6], 3: [8, 15] };
const SIZE_NAME: Record<DepositSize, string> = { 1: 'pequena', 2: 'média', 3: 'grande' };

/**
 * Código de 1 byte por célula: tipo nos bits 0–4, tamanho nos bits 5–6, bit 7 = revelada (petróleo
 * cavado com Rebaixar; "escondido" vale para os humanos, M4). 0 = nenhuma.
 */
export const REVEALED_BIT = 128;

export function packDeposit(type: Resource, size: DepositSize, revealed = false): number {
  return type | (size << 5) | (revealed ? REVEALED_BIT : 0);
}
export function depositType(code: number): Resource {
  return (code & 31) as Resource;
}
export function depositSize(code: number): DepositSize {
  return ((code >> 5) & 3) as DepositSize;
}
export function isRevealed(code: number): boolean {
  return (code & REVEALED_BIT) !== 0;
}
/** Petróleo ainda não cavado (escondido no subsolo). */
export function isHiddenOil(code: number): boolean {
  return depositType(code) === Resource.Oil && !isRevealed(code);
}

/** Nome mostrado ao tocar na jazida (só com a camada "Ver recursos"). */
export function depositLabel(code: number): string {
  const info = RESOURCE_INFO[depositType(code)];
  if (!info || !depositType(code)) return '';
  const hidden = isHiddenOil(code) ? ' (escondido)' : '';
  return `${info.name} · jazida ${SIZE_NAME[depositSize(code)] ?? ''}${hidden}`;
}

/** Máscara com todos os tipos (bit = código do tipo). */
export const ALL_RESOURCES = (2 ** (RESOURCE_TYPES + 1) - 2) >>> 0;
/** Máscara de um grupo. */
export function groupMask(group: ResourceGroup): number {
  let m = 0;
  for (const r of RESOURCE_INFO) if (r.id && r.group === group) m |= 1 << r.id;
  return m >>> 0;
}

// ---------------------------------------------------------------------------------------------------
// Ambientes geológicos

/** Bits do ambiente de uma célula. */
const Env = {
  Land: 1,
  /** Plataforma continental: crosta continental debaixo d'água rasa. */
  Shelf: 2,
  /** Interior estável e antigo de um continente. */
  Craton: 4,
  /** Cordilheira (cinturão de colisão ou arco antigo). */
  Orogen: 8,
  /** A até ARC_REACH células de um arco de subducção (oceano mergulhando sob o continente). */
  Arc: 16,
  /** Rifte continental ou braço que falhou (aulacógeno). */
  Rift: 32,
  /** Terra baixa (< 400 m): bacias sedimentares. */
  Lowland: 64,
  Humid: 128,
  /** Trópico muito chuvoso (bauxita). */
  WetTropic: 256,
  Dry: 512,
  /** Deserto extremo (nitratos). */
  HyperArid: 1024,
  High: 2048,
  Coastal: 4096,
  Interior: 8192,
} as const;

const ARC_REACH = 4;
const CRATON_MIN = 0.55;

/** Onde cada tipo se forma, em bits de ambiente (`docs/03-mundo-geologia.md`). */
function fits(type: Resource, e: number): boolean {
  const land = (e & Env.Land) !== 0;
  const craton = (e & Env.Craton) !== 0;
  const orogen = (e & Env.Orogen) !== 0;
  const arc = (e & Env.Arc) !== 0;
  const rift = (e & Env.Rift) !== 0;
  const lowland = (e & Env.Lowland) !== 0;
  const dry = (e & Env.Dry) !== 0;
  switch (type) {
    case Resource.Iron:
      return land && craton;
    case Resource.Copper:
    case Resource.Silver:
      // Arco de subducção atual, ou cordilheira fora do cráton (arco antigo).
      return land && (arc || (orogen && !craton));
    case Resource.Gold:
      return land && (craton || orogen || arc);
    case Resource.Tin:
      return land && orogen;
    case Resource.Bauxite:
      return land && (e & Env.WetTropic) !== 0 && lowland;
    case Resource.Manganese:
      return land && craton && lowland;
    case Resource.Chromium:
      // Ofiolito numa cordilheira de colisão, ou intrusão antiga dentro de cráton (como o Bushveld).
      return land && (orogen || craton);
    case Resource.Niobium:
    case Resource.RareEarths:
      return land && (craton || rift) && (e & Env.Interior) !== 0;
    case Resource.Lithium:
      return land && ((dry && (e & Env.High) !== 0) || (orogen && !craton));
    case Resource.Oil:
      return (e & Env.Shelf) !== 0 || (land && (rift || (lowland && !craton && !orogen)));
    case Resource.Coal:
      return land && lowland && (e & Env.Humid) !== 0 && !craton;
    case Resource.Uranium:
      return land && (craton || (lowland && dry));
    case Resource.Potash:
      return land && dry && (lowland || rift);
    case Resource.Nitrates:
      return land && (e & Env.HyperArid) !== 0 && (e & Env.Coastal) !== 0;
    case Resource.Salt:
      return land && ((dry && lowland) || rift);
    case Resource.Sulfur:
      return land && (arc || (dry && lowland));
    case Resource.Limestone:
      return (e & Env.Shelf) !== 0 || (land && lowland && !craton);
    default:
      return false;
  }
}

/** Para a jazida crescer além da célula inicial: o mesmo tipo de chão (terra ou plataforma). */
function growable(type: Resource, e: number): boolean {
  if (type === Resource.Oil || type === Resource.Limestone) return (e & (Env.Land | Env.Shelf)) !== 0;
  return (e & Env.Land) !== 0;
}

/**
 * Ambiente das células, calculado sob demanda (o cráton pede um ruído por célula: só onde precisa).
 * Arco e rifte vêm das fronteiras de placa e dos braços que falharam.
 */
class Environment {
  private cache: Uint16Array;
  private arcDist: Uint8Array;
  private rift: Uint8Array;
  private noise;

  constructor(private world: WorldState) {
    const n = world.cellCount;
    this.cache = new Uint16Array(n).fill(0xffff);
    this.noise = provinceNoiseFor(world.params.seed);
    this.rift = new Uint8Array(n);
    const fronts: number[] = [];
    // Uma varredura só: frentes de arco e riftes continentais estão nas fronteiras (poucas células).
    for (let c = 0; c < n; c++) {
      if (!world.boundary[c]) continue;
      if (isArcFront(world, c)) fronts.push(c);
      else if (isContinentalRift(world, c)) this.rift[c] = 1;
    }
    this.arcDist = arcDistance(world, fronts);
    const { neighbors } = world.grid;
    for (const path of world.aulacogens) {
      for (const c of path) {
        this.rift[c] = 1;
        for (let d = 0; d < 4; d++) this.rift[neighbors[c * 4 + d] as number] = 1;
      }
    }
  }

  at(c: number): number {
    const cached = this.cache[c] as number;
    if (cached !== 0xffff) return cached;
    const w = this.world;
    const h = w.heightAboveSea(c);
    const continental = w.crust[c] === Crust.Continental;
    let e = 0;
    if (h > 0) e |= Env.Land;
    else if (continental && h > -220) e |= Env.Shelf;
    if (h > 0 || (e & Env.Shelf) !== 0) {
      const t = w.temperature[c] as number;
      const p = w.precipitation[c] as number;
      const wd = w.waterDistance[c] as number;
      if (h > 1500) e |= Env.High | Env.Orogen;
      if (h > 0 && h < 400) e |= Env.Lowland;
      if (p > 1100) e |= Env.Humid;
      if (t > 20 && p > 1500) e |= Env.WetTropic;
      if (p < 350) e |= Env.Dry;
      if (p < 130) e |= Env.HyperArid;
      if (wd <= 4) e |= Env.Coastal;
      if (wd >= 4) e |= Env.Interior;
      if ((this.arcDist[c] as number) <= ARC_REACH) e |= Env.Arc;
      if (this.rift[c]) e |= Env.Rift;
      if (h > 0 && wd >= 3 && continental) {
        if (provinceRigidity(this.noise, w.grid.positions, w.plate[c] as number, c) > CRATON_MIN) e |= Env.Craton;
      }
    }
    this.cache[c] = e;
    return e;
  }
}

/** A célula é continental e encosta numa célula oceânica de outra placa que vem para cima dela? */
function isArcFront(world: WorldState, c: number): boolean {
  if (world.boundary[c] !== Boundary.Convergent || world.crust[c] !== Crust.Continental) return false;
  const { neighbors } = world.grid;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[c * 4 + d] as number;
    if (world.plate[j] !== world.plate[c] && world.crust[j] === Crust.Oceanic) return true;
  }
  return false;
}

function isContinentalRift(world: WorldState, c: number): boolean {
  if (world.boundary[c] !== Boundary.Divergent || world.crust[c] !== Crust.Continental) return false;
  const { neighbors } = world.grid;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[c * 4 + d] as number;
    if (world.plate[j] !== world.plate[c] && world.crust[j] === Crust.Continental) return true;
  }
  return false;
}

function isCollision(world: WorldState, c: number): boolean {
  if (world.boundary[c] !== Boundary.Convergent || world.crust[c] !== Crust.Continental) return false;
  const { neighbors } = world.grid;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[c * 4 + d] as number;
    if (world.plate[j] !== world.plate[c] && world.crust[j] === Crust.Continental) return true;
  }
  return false;
}

/** Distância (em células, até ARC_REACH + 1) de cada célula continental até a frente de um arco. */
function arcDistance(world: WorldState, fronts: readonly number[]): Uint8Array {
  const dist = new Uint8Array(world.cellCount).fill(255);
  const { neighbors } = world.grid;
  let frontier: number[] = [...fronts];
  for (const c of fronts) dist[c] = 0;
  for (let k = 1; k <= ARC_REACH + 1 && frontier.length; k++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (dist[j] !== 255 || world.plate[j] !== world.plate[c] || world.crust[j] !== Crust.Continental) continue;
        dist[j] = k;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}

// ---------------------------------------------------------------------------------------------------
// Geração

interface TypePlan {
  type: Resource;
  /** Províncias (mínimo, máximo) e jazidas por província (máximo). */
  provinces: readonly [number, number];
  perProvince: number;
  /** Chance de a primeira jazida da província ser grande. */
  large: number;
}

/**
 * Quantas províncias e jazidas de cada tipo nascem com o mundo (poucas e importantes: elas também se
 * formam com o tempo). Raridade como no mundo real: calcário, petróleo e carvão comuns; nióbio, terras
 * raras e nitratos raros. ~60 jazidas por mundo.
 */
const PLANS: readonly TypePlan[] = [
  { type: Resource.Iron, provinces: [2, 3], perProvince: 3, large: 0.5 },
  { type: Resource.Copper, provinces: [2, 3], perProvince: 3, large: 0.4 },
  { type: Resource.Gold, provinces: [2, 3], perProvince: 2, large: 0.25 },
  { type: Resource.Silver, provinces: [1, 2], perProvince: 2, large: 0.2 },
  { type: Resource.Tin, provinces: [1, 2], perProvince: 2, large: 0.2 },
  { type: Resource.Bauxite, provinces: [1, 2], perProvince: 3, large: 0.4 },
  { type: Resource.Manganese, provinces: [1, 2], perProvince: 2, large: 0.3 },
  { type: Resource.Chromium, provinces: [1, 2], perProvince: 2, large: 0.3 },
  { type: Resource.Niobium, provinces: [1, 1], perProvince: 1, large: 0.3 },
  { type: Resource.RareEarths, provinces: [1, 1], perProvince: 2, large: 0.2 },
  { type: Resource.Lithium, provinces: [1, 2], perProvince: 2, large: 0.3 },
  { type: Resource.Oil, provinces: [3, 4], perProvince: 3, large: 0.5 },
  { type: Resource.Coal, provinces: [2, 3], perProvince: 3, large: 0.4 },
  { type: Resource.Uranium, provinces: [1, 2], perProvince: 2, large: 0.2 },
  { type: Resource.Potash, provinces: [1, 1], perProvince: 2, large: 0.3 },
  { type: Resource.Nitrates, provinces: [1, 1], perProvince: 1, large: 0.2 },
  { type: Resource.Salt, provinces: [2, 2], perProvince: 2, large: 0.3 },
  { type: Resource.Sulfur, provinces: [1, 2], perProvince: 2, large: 0.2 },
  { type: Resource.Limestone, provinces: [3, 4], perProvince: 3, large: 0.5 },
];

/** Raio de uma província (rad, ~6°) e distância mínima entre províncias do mesmo tipo (~25°). */
const PROVINCE_RADIUS = 0.105;
const PROVINCE_SPACING = 0.44;
/** Só 1 célula em SAMPLE_STRIDE entra na busca de lugares (o ambiente é calculado só nelas). */
const SAMPLE_STRIDE = 5;

/** Cria as jazidas do mundo recém-gerado (depois do clima). Determinístico pela semente. */
export function generateDeposits(world: WorldState): void {
  world.deposit.fill(0);
  const rng = createRng((world.params.seed ^ 0x7a3c19e5) >>> 0);
  const env = new Environment(world);
  const n = world.cellCount;
  // Lugares possíveis: células amostradas que são terra ou plataforma, com o ambiente de cada uma.
  const sample: number[] = [];
  const offset = rng.int(0, SAMPLE_STRIDE - 1);
  for (let c = offset; c < n; c += SAMPLE_STRIDE) {
    if (world.heightAboveSea(c) > -220 && world.crust[c] === Crust.Continental) sample.push(c);
  }
  const sampleEnv = sample.map((c) => env.at(c));
  const { positions } = world.grid;
  const dot = (a: number, b: number): number =>
    (positions[a * 3] as number) * (positions[b * 3] as number) +
    (positions[a * 3 + 1] as number) * (positions[b * 3 + 1] as number) +
    (positions[a * 3 + 2] as number) * (positions[b * 3 + 2] as number);
  const cosRadius = Math.cos(PROVINCE_RADIUS);
  const cosSpacing = Math.cos(PROVINCE_SPACING);
  for (const plan of PLANS) {
    const candidates: number[] = [];
    for (let k = 0; k < sample.length; k++) if (fits(plan.type, sampleEnv[k] as number)) candidates.push(sample[k] as number);
    if (!candidates.length) continue;
    const provinces = rng.int(plan.provinces[0], plan.provinces[1]);
    const centers: number[] = [];
    for (let p = 0, tries = 0; p < provinces && tries < 40; tries++) {
      const c = candidates[rng.int(0, candidates.length - 1)] as number;
      if (centers.some((o) => dot(o, c) > cosSpacing)) continue;
      centers.push(c);
      p++;
    }
    for (const center of centers) {
      const count = rng.int(1, plan.perProvince);
      for (let k = 0; k < count; k++) {
        // As outras jazidas da província: candidatos sorteados até cair um perto do centro.
        let seed = center;
        for (let tries = 0; k > 0 && tries < 60; tries++) {
          const c = candidates[rng.int(0, candidates.length - 1)] as number;
          if (dot(center, c) > cosRadius) {
            seed = c;
            break;
          }
        }
        if (k > 0 && seed === center) continue;
        const size: DepositSize = k === 0 && rng.next() < plan.large ? DepositSize.Large : rng.next() < 0.4 ? DepositSize.Medium : DepositSize.Small;
        placeDeposit(world, env, rng, plan.type, size, seed, (c, code) => (world.deposit[c] = code));
      }
    }
  }
}

/**
 * Cresce uma jazida a partir de `seed` pelas vizinhas do mesmo chão, sem tocar em outra jazida.
 * Devolve quantas células recebeu (0 se o lugar já estava ocupado).
 */
function placeDeposit(
  world: WorldState,
  env: { at(c: number): number },
  rng: Rng,
  type: Resource,
  size: DepositSize,
  seed: number,
  write: (c: number, code: number) => void,
): number {
  const { neighbors } = world.grid;
  // Uma célula de folga entre jazidas: duas iguais encostadas virariam uma só.
  const mine = new Set<number>();
  const free = (c: number): boolean => {
    if (world.deposit[c]) return false;
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c * 4 + d] as number;
      if (world.deposit[j] && !mine.has(j)) return false;
    }
    return true;
  };
  if (!free(seed) || !growable(type, env.at(seed))) return 0;
  const [lo, hi] = SIZE_CELLS[size];
  const target = rng.int(lo, hi);
  const code = packDeposit(type, size);
  const placed: number[] = [seed];
  mine.add(seed);
  write(seed, code);
  for (let k = 0; k < placed.length && placed.length < target; k++) {
    const c = placed[k] as number;
    // Ordem das vizinhas sorteada: a jazida não cresce sempre para o mesmo lado.
    const start = rng.int(0, 3);
    for (let d = 0; d < 4 && placed.length < target; d++) {
      const j = neighbors[c * 4 + ((start + d) & 3)] as number;
      if (!free(j) || world.plate[j] !== world.plate[seed] || !growable(type, env.at(j))) continue;
      write(j, code);
      mine.add(j);
      placed.push(j);
    }
  }
  return placed.length;
}

// ---------------------------------------------------------------------------------------------------
// Formação durante a deriva

const FrontKind = { Arc: 0, Collision: 1, Rift: 2 } as const;
type FrontKind = (typeof FrontKind)[keyof typeof FrontKind];

/**
 * A cada quanto tempo de deriva (rad no relógio da deriva, `Tectonics.driftNow`) com a frente ativa
 * ela pode formar uma jazida, e a chance. Medido na deriva, não em recomposições (essas dependem da
 * resolução). Com placas a 100% em 20× a deriva anda ~0,0034 rad/s: arco ~80 s, colisão ~100 s,
 * rifte ~60 s reais (constantes ajustáveis; `docs/decisoes.md`).
 */
export const FORMATION_PERIOD: Record<FrontKind, number> = { 0: 0.27, 1: 0.34, 2: 0.2 };
export const FORMATION_CHANCE = 0.6;
/** Frente com menos células que isto não conta (arredondamento, não fronteira de verdade). */
const FRONT_MIN_CELLS = 3;
/** Células guardadas por frente para sortear onde a jazida nasce. */
const FRONT_KEEP = 48;

interface Front {
  kind: FrontKind;
  /** Deriva em que a frente apareceu e quantos períodos dela já foram sorteados. */
  since: number;
  rolled: number;
  cells: number[];
}

/** O que a formação durante a deriva gravou (para testes e medição). */
export interface FormedDeposit {
  type: Resource;
  kind: 'arco' | 'colisão' | 'rifte';
  cells: number;
}

/**
 * Formação de jazidas durante a deriva (no motor da geologia, depois de cada recomposição). Guarda há
 * quantas recomposições cada frente (par de placas e tipo) está ativa; quando passa do período, pode
 * nascer uma jazida perto da frente, na crosta continental. Sorteios próprios, na ordem das
 * recomposições: determinístico.
 */
export class DepositFormation {
  private fronts = new Map<number, Front>();
  private rng: Rng;
  formed: FormedDeposit[] = [];

  constructor(seed: number) {
    this.rng = createRng((seed ^ 0x4b1d5e0f) >>> 0);
  }

  /**
   * Depois de uma recomposição (o mundo já tem fronteiras, crosta e clima novos). `write` grava a
   * jazida na crosta (tectônica) e no mundo.
   */
  step(world: WorldState, drift: number, write: (c: number, code: number) => void): void {
    const n = world.cellCount;
    const { neighbors } = world.grid;
    const seen = new Map<number, Front>();
    for (let c = 0; c < n; c++) {
      if (!world.boundary[c] || world.crust[c] !== Crust.Continental) continue;
      const kind = isArcFront(world, c) ? FrontKind.Arc : isCollision(world, c) ? FrontKind.Collision : isContinentalRift(world, c) ? FrontKind.Rift : -1;
      if (kind < 0) continue;
      let other = -1;
      for (let d = 0; d < 4 && other < 0; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (world.plate[j] !== world.plate[c]) other = world.plate[j] as number;
      }
      // A placa da célula vem primeiro: no arco é a de cima (onde a jazida nasce).
      const key = ((world.plate[c] as number) * 64 + other) * 4 + kind;
      let f = seen.get(key);
      if (!f) {
        f = { kind: kind as FrontKind, since: drift, rolled: 0, cells: [] };
        seen.set(key, f);
      }
      if (f.cells.length < FRONT_KEEP) f.cells.push(c);
    }
    const next = new Map<number, Front>();
    let env: Environment | null = null;
    // Ordem fixa (pela chave) para os sorteios não dependerem da ordem do mapa.
    for (const key of [...seen.keys()].sort((a, b) => a - b)) {
      const f = seen.get(key) as Front;
      if (f.cells.length < FRONT_MIN_CELLS) continue;
      const old = this.fronts.get(key);
      if (old) {
        f.since = old.since;
        f.rolled = old.rolled;
      }
      next.set(key, f);
      const periods = Math.floor((drift - f.since) / FORMATION_PERIOD[f.kind]);
      if (periods <= f.rolled) continue;
      f.rolled = periods;
      if (this.rng.next() >= FORMATION_CHANCE) continue;
      env ??= new Environment(world);
      this.form(world, env, f, write);
    }
    this.fronts = next;
  }

  private form(world: WorldState, env: Environment, f: Front, write: (c: number, code: number) => void): void {
    const rng = this.rng;
    const from = f.cells[rng.int(0, f.cells.length - 1)] as number;
    // Arco e colisão: a 2–4 células da frente, para dentro do continente; rifte: no próprio vale.
    const [minD, maxD] = f.kind === FrontKind.Rift ? [0, 1] : [2, 4];
    const spots = cellsAround(world, from, minD, maxD);
    if (!spots.length) return;
    const spot = spots[rng.int(0, spots.length - 1)] as number;
    const e = env.at(spot);
    const roll = rng.next();
    let type: Resource;
    if (f.kind === FrontKind.Arc) {
      const dryHigh = (e & Env.Dry) !== 0 && (e & Env.High) !== 0;
      type = roll < 0.5 ? Resource.Copper : roll < 0.65 ? Resource.Gold : roll < 0.8 ? Resource.Silver : roll < 0.9 || !dryHigh ? Resource.Sulfur : Resource.Lithium;
    } else if (f.kind === FrontKind.Collision) {
      type = roll < 0.45 ? Resource.Gold : roll < 0.85 ? Resource.Tin : Resource.Chromium;
    } else {
      type = roll < 0.7 ? Resource.Oil : Resource.Salt;
    }
    const s = rng.next();
    const size: DepositSize = s < 0.1 ? DepositSize.Large : s < 0.45 ? DepositSize.Medium : DepositSize.Small;
    const cells = placeDeposit(world, env, rng, type, size, spot, write);
    if (cells) this.formed.push({ type, kind: f.kind === FrontKind.Arc ? 'arco' : f.kind === FrontKind.Collision ? 'colisão' : 'rifte', cells });
  }
}

/** Células continentais da mesma placa a `min`–`max` passos de `from`. */
function cellsAround(world: WorldState, from: number, min: number, max: number): number[] {
  const { neighbors } = world.grid;
  const plate = world.plate[from];
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  const out: number[] = min === 0 ? [from] : [];
  for (let k = 1; k <= max && frontier.length; k++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (dist.has(j) || world.plate[j] !== plate || world.crust[j] !== Crust.Continental) continue;
        dist.set(j, k);
        next.push(j);
        if (k >= min) out.push(j);
      }
    }
    frontier = next;
  }
  return out;
}

/** Quantas jazidas (grupos de células com o mesmo código, ligadas) há no mundo, por tipo. */
export function countDeposits(world: WorldState): number[] {
  const counts = new Array<number>(RESOURCE_TYPES + 1).fill(0);
  const seen = new Uint8Array(world.cellCount);
  const { neighbors } = world.grid;
  for (let s = 0; s < world.cellCount; s++) {
    const code = world.deposit[s] as number;
    if (!code || seen[s]) continue;
    counts[depositType(code)] = (counts[depositType(code)] as number) + 1;
    seen[s] = 1;
    const stack = [s];
    while (stack.length) {
      const c = stack.pop() as number;
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (!seen[j] && (world.deposit[j] as number) === code) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return counts;
}

/** Ambiente geológico das células (bits de `ResourceEnv`), calculado sob demanda (testes e medição). */
export function environmentOf(world: WorldState): (c: number) => number {
  const env = new Environment(world);
  return (c) => env.at(c);
}

export { Env as ResourceEnv, fits as fitsEnvironment };
