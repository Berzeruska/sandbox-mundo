import { createRng, type Rng } from '../core/rng';
import { Biome } from './biomes';
import { CellState, type Ground } from './disasters/ground';
import { isSeaSpecies, PLANT_CAPACITY, SPECIES, SPECIES_COUNT, type SpeciesInfo } from './species';
import type { WorldState } from './state';

/**
 * Ecologia em números (`docs/M3-especificacao.md`): de longe o mundo guarda quantos indivíduos de cada espécie há em cada bloco de 8×8 células (o tamanho de um pedaço da maquete), e a biomassa de planta do bloco.
 * De perto a maquete transforma esses números em indivíduos; quem manda são os números.
 *
 * Mecanismos de `docs/04-ecologia.md`: capacidade de suporte pelo bioma e pela vegetação, crescimento logístico, predador e presa com saturação (o predador não come sem limite),
 * refúgio (uma parte da presa fica fora de alcance), nichos por bioma e migração para o bloco vizinho quando falta comida ou espaço.
 * Tudo anda no relógio, em turnos (um doze avos dos blocos por passo, cada bloco uma vez por ano), com sorteio pela semente: mesma semente e mesmos comandos, mesmas populações.
 */
export const BLOCK = 8;
/** A densidade da tabela de espécies vale para 16 células; o bloco tem 64, e nem tudo é pasto. */
const AREA = 3;
/** Abaixo disto a espécie some do bloco. */
const VANISH = 0.02;
const SUBSTEPS = 2;
const TURNS = 12;
/** As espécies que entram nos números vêm primeiro na lista; as míticas, depois. */
const NUMBERED = SPECIES.findIndex((q) => q.mythic === true);
/** Na lista, os bichos de terra vêm antes dos do mar. */
const FIRST_SEA = SPECIES.findIndex((_, i) => isSeaSpecies(i));
/** Carne que um caçador come por ano para se manter, em vezes o próprio peso; e o máximo que consegue comer. */
/**
 * Caça (ajustado medindo 5 sementes por 1.000 anos; `docs/decisoes.md`, 2026-11-09): quanto o caçador precisa comer, o máximo que consegue, a meia-saturação
 * (em fração da carne do bloco com as presas cheias), o aperto do território, a queda quando falta comida, o refúgio da presa e o quanto os caçadores se atrapalham.
 */
export const TUNE = { need: 1.5, feast: 1.3, half: 0.15, crowd: 0.1, starve: 6, refuge: 0.1, crowding: 1.5 };
/** Meia-saturação da caça, em fração da carne que o bloco teria com as presas cheias. */

export const TRAITS = ['tamanho', 'fome', 'agressividade', 'velocidade', 'fertilidade'] as const;
export type Trait = (typeof TRAITS)[number];
export const TRAIT_RANGE: readonly [number, number] = [0.5, 2];

export type EcologyEventKind = 'risco' | 'ultimo' | 'extinta' | 'recuperada';
export interface EcologyEvent { kind: EcologyEventKind; species: number; cell: number; year: number }
export interface Mythic { id: number; species: number; cell: number; fed: number; born: number }
export interface EcologyYear { events: EcologyEvent[]; fires: number[] }

/** Quanto cada estado do chão tira dos bichos da célula quando chega (fração que morre) e quanto foge para os vizinhos. */
const HIT: Partial<Record<number, readonly [number, number]>> = {
  [CellState.Burning]: [0.35, 0.5], [CellState.Lava]: [1, 0], [CellState.Impact]: [1, 0], [CellState.Ejecta]: [0.9, 0], [CellState.Flooded]: [0.5, 0.3],
  [CellState.Surge]: [0.7, 0.1], [CellState.Wave]: [0.7, 0.1], [CellState.Crack]: [0.6, 0.2], [CellState.Slide]: [0.6, 0.1], [CellState.Ash]: [0.1, 0.2], [CellState.Sand]: [0.05, 0.3], [CellState.Meltwater]: [0.4, 0.3],
};
/** Estados em que a célula sustenta menos: a seca tira até 30% (`docs/04-ecologia.md`). */
const STATE_FACTOR = new Float32Array(32).fill(1);
STATE_FACTOR[CellState.Heat] = 0.7; STATE_FACTOR[CellState.Burning] = 0; STATE_FACTOR[CellState.Burned] = 0.25; STATE_FACTOR[CellState.Lava] = 0; STATE_FACTOR[CellState.Basalt] = 0.05; STATE_FACTOR[CellState.Mud] = 0.3;
STATE_FACTOR[CellState.Impact] = 0; STATE_FACTOR[CellState.Ejecta] = 0.1; STATE_FACTOR[CellState.Flooded] = 0.2; STATE_FACTOR[CellState.Surge] = 0.1; STATE_FACTOR[CellState.Ash] = 0.7; STATE_FACTOR[CellState.Fertile] = 1.2; STATE_FACTOR[CellState.Sand] = 0.6;

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function slowNoise(k: number, t: number, salt: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash2(k + i, salt) * (1 - u) + hash2(k + i + 1, salt) * u;
}

export class Ecology {
  readonly nb: number;
  readonly blocks: number;
  /** Indivíduos por espécie e bloco: `pop[s * blocks + b]`. */
  readonly pop: Float32Array;
  /** Quantos o bloco sustenta, por espécie (refeito quando chega a vez do bloco). */
  readonly cap: Float32Array;
  /** Biomassa de planta do bloco e a capacidade dela, de 0 a 1. */
  readonly plant: Float32Array;
  readonly plantCap: Float32Array;
  /** Total do mundo por espécie, atualizado uma vez por ano. */
  readonly totals = new Float64Array(SPECIES_COUNT);
  /** O maior total que a espécie já teve: a régua do "em risco". */
  readonly peak = new Float64Array(SPECIES_COUNT);
  /** Características que deus mudou, por espécie (1 = normal). */
  readonly traits = new Float32Array(SPECIES_COUNT * TRAITS.length).fill(1);
  /** Classe mítica: indivíduos de verdade, só postos por deus. */
  mythics: Mythic[] = [];
  readonly extinct = new Uint8Array(SPECIES_COUNT);
  private readonly atRisk = new Uint8Array(SPECIES_COUNT);
  private readonly lastOne = new Uint8Array(SPECIES_COUNT);
  private readonly neighbors: Int32Array;
  private readonly bestCap = new Float32Array(SPECIES_COUNT);
  private readonly preyOf: number[][] = [];
  private readonly sea = new Uint8Array(SPECIES_COUNT);
  private readonly biomesOf: number[][] = [];
  private readonly growth = new Float32Array(SPECIES_COUNT);
  private readonly meat = new Float32Array(SPECIES_COUNT);
  /** 0 plantas, 1 onívoro, 2 carne, 3 plâncton. */
  private readonly diet = new Uint8Array(SPECIES_COUNT);
  private readonly stale: Uint8Array;
  /** O que o bloco tem: 1 terra, 2 mar, 3 os dois. Bloco só de mar não gasta tempo com bicho de terra, e vice-versa. */
  private readonly kind: Uint8Array;
  /** Primeiros anos: os números assentam; sem aviso nem régua. */
  static readonly SETTLE_YEARS = 40;
  private readonly rng: Rng;
  private nextMythic = 1;
  private readonly seed: number;
  /** Trabalho por bioma num bloco. */
  private readonly count = new Float32Array(16);
  private readonly cover = new Float32Array(16);
  /** Ano em que a ecologia começou a valer (os primeiros anos assentam os números). */
  year = 0;

  constructor(private world: WorldState, private ground: Ground | null) {
    const n = world.params.n;
    this.nb = Math.floor(n / BLOCK);
    this.blocks = 6 * this.nb * this.nb;
    this.pop = new Float32Array(SPECIES_COUNT * this.blocks);
    this.cap = new Float32Array(SPECIES_COUNT * this.blocks);
    this.plant = new Float32Array(this.blocks);
    this.plantCap = new Float32Array(this.blocks);
    this.stale = new Uint8Array(this.blocks).fill(1);
    this.kind = new Uint8Array(this.blocks).fill(3);
    this.seed = world.params.seed;
    this.rng = createRng((world.params.seed ^ 0x51ec0109) >>> 0);
    SPECIES.forEach((sp, i) => {
      let best = 0;
      for (const b of sp.biomes) best = Math.max(best, PLANT_CAPACITY[b] as number);
      this.bestCap[i] = best || 1;
      this.preyOf.push(sp.prey.map((id) => SPECIES.findIndex((q) => q.id === id)));
      this.sea[i] = isSeaSpecies(i) ? 1 : 0;
      this.biomesOf.push([...sp.biomes]);
      this.growth[i] = sp.growth; this.meat[i] = sp.meat;
      this.diet[i] = sp.diet === 'plantas' ? 0 : sp.diet === 'onivoro' ? 1 : sp.diet === 'carne' ? 2 : 3;
    });
    // Vizinhos de cada bloco: passos de célula a partir do meio dele (vale também na aresta do cubo).
    this.neighbors = new Int32Array(this.blocks * 4);
    const grid = world.grid;
    for (let b = 0; b < this.blocks; b++) {
      const start = this.centerCell(b);
      for (let d = 0; d < 4; d++) {
        let c = start;
        for (let k = 0; k < BLOCK; k++) c = grid.neighbors[c * 4 + d] as number;
        this.neighbors[b * 4 + d] = this.blockOf(c);
      }
    }
    for (let b = 0; b < this.blocks; b++) {
      this.refreshCaps(b);
      this.plant[b] = this.plantCap[b] as number;
    }
    // Começo: presas a 60% do que cabe; caçadores onde há presa.
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const sp = SPECIES[s] as SpeciesInfo;
      if (sp.mythic) continue;
      const o = s * this.blocks;
      for (let b = 0; b < this.blocks; b++) {
        const k = this.cap[o + b] as number;
        if (k <= 0) continue;
        if (sp.diet !== 'carne') { this.pop[o + b] = k * 0.6; continue; }
        let prey = 0;
        for (const p of this.preyOf[s] as number[]) prey += this.cap[p * this.blocks + b] as number;
        if (prey > 0) this.pop[o + b] = k * 0.4;
      }
    }
    this.sumTotals();
    this.peak.set(this.totals);
  }

  get bytes(): number { return this.pop.byteLength + this.cap.byteLength + this.plant.byteLength * 2 + this.neighbors.byteLength; }

  blockOf(cell: number): number {
    const n = this.world.params.n, face = Math.floor(cell / (n * n)), rest = cell - face * n * n, x = rest % n, y = Math.floor(rest / n);
    return face * this.nb * this.nb + Math.min(this.nb - 1, Math.floor(y / BLOCK)) * this.nb + Math.min(this.nb - 1, Math.floor(x / BLOCK));
  }

  centerCell(block: number): number {
    const n = this.world.params.n, per = this.nb * this.nb, face = Math.floor(block / per), rest = block - face * per, bx = rest % this.nb, by = Math.floor(rest / this.nb);
    return face * n * n + (by * BLOCK + (BLOCK >> 1)) * n + bx * BLOCK + (BLOCK >> 1);
  }

  private trait(s: number, t: number): number { return this.traits[s * TRAITS.length + t] as number; }

  /** Quanto o bloco sustenta de cada espécie, pelo bioma, pela vegetação e pelo estado de cada célula. */
  refreshCaps(b: number): void {
    const w = this.world, n = w.params.n, per = this.nb * this.nb, face = Math.floor(b / per), rest = b - face * per, bx = rest % this.nb, by = Math.floor(rest / this.nb);
    const count = this.count, cover = this.cover, ground = this.ground;
    count.fill(0); cover.fill(0);
    let veg = 0;
    for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) {
      const c = face * n * n + (by * BLOCK + j) * n + bx * BLOCK + i;
      const water = (w.elevation[c] as number) <= w.seaLevel, ice = (w.ice[c] as number) !== 0;
      // No mar a célula conta pelo fundo (raso ou fundo); mar congelado não sustenta ninguém. Gelo em terra é o bioma do lobo-ártico.
      const biome = water ? (ice ? -1 : (w.biome[c] as number) === Biome.DeepOcean ? Biome.DeepOcean : Biome.ShallowOcean) : ice ? Biome.Ice : (w.biome[c] as number);
      if (biome < 0) continue;
      const q = water ? 1 : (ground ? (ground.cover[c] as number) * (STATE_FACTOR[ground.state[c] as number] as number) : 1);
      count[biome] = (count[biome] as number) + 1;
      cover[biome] = (cover[biome] as number) + q;
      if (!water) veg += q * (PLANT_CAPACITY[biome] as number);
    }
    const cells = BLOCK * BLOCK;
    this.plantCap[b] = veg / cells;
    const seaCells = (count[Biome.ShallowOcean] as number) + (count[Biome.DeepOcean] as number);
    let landCells = 0;
    for (let q = 2; q < 16; q++) landCells += count[q] as number;
    this.kind[b] = (landCells > 0 ? 1 : 0) | (seaCells > 0 ? 2 : 0);
    for (let s = 0; s < NUMBERED; s++) {
      const sp = SPECIES[s] as SpeciesInfo;
      let room = 0;
      const list = this.biomesOf[s] as number[], grazes = (this.diet[s] as number) < 2;
      for (let q = 0; q < list.length; q++) {
        const bio = list[q] as number;
        if (!count[bio]) continue;
        // Quem come planta depende da vegetação da célula; quem caça ou filtra plâncton, só do lugar.
        room += grazes ? (cover[bio] as number) * ((PLANT_CAPACITY[bio] as number) / (this.bestCap[s] as number)) : (count[bio] as number);
      }
      this.cap[s * this.blocks + b] = (sp.density * AREA * room) / cells / this.trait(s, 0);
    }
  }

  /** Ano bom ou ruim de chuva: vale para uma região de 4×4 blocos e muda a cada ano (as populações não ficam paradas). */
  weather(b: number, year: number): number {
    const per = this.nb * this.nb, face = Math.floor(b / per), rest = b - face * per, bx = rest % this.nb, by = Math.floor(rest / this.nb);
    const region = face * 4096 + (by >> 2) * 64 + (bx >> 2);
    // Três ritmos somados: o ano da região, um ciclo da região de alguns anos e um ciclo do planeta de uma década (anos bons e ruins no mundo todo).
    return 0.62 + 0.26 * hash2(region * 977 + year, this.seed) + 0.3 * slowNoise(region * 131, year / 6, this.seed ^ 0x55aa) + 0.2 * slowNoise(7, year / 11, this.seed ^ 0x1234);
  }

  /** Um passo do relógio: a vez de um doze avos dos blocos. No passo que fecha o ano, devolve avisos e pedidos dos míticos. */
  step(tick: number): EcologyYear | null {
    const turn = ((tick % TURNS) + TURNS) % TURNS, year = Math.floor(tick / TURNS);
    for (let b = turn; b < this.blocks; b += TURNS) this.updateBlock(b, year);
    if (turn !== TURNS - 1) return null;
    this.year = year;
    return this.closeYear(year);
  }

  private updateBlock(b: number, year: number): void {
    // A capacidade só é refeita quando algo mudou no bloco (desastre) ou de 4 em 4 anos (clima e vegetação mudam devagar).
    if (this.stale[b] || ((year + b) & 3) === 0) { this.refreshCaps(b); this.stale[b] = 0; }
    const B = this.blocks, pop = this.pop, cap = this.cap, wet = this.weather(b, year);
    // Plantas: crescimento logístico até a capacidade, com um resto de sementes para voltar do zero.
    const kv = this.plantCap[b] as number;
    let p = this.plant[b] as number;
    if (kv <= 0) p = 0;
    else { p = Math.max(kv * 0.03, p); p += 0.9 * wet * this.moisture(b) * p * (1 - p / kv); p = Math.min(kv, Math.max(kv * 0.03, p)); }
    this.plant[b] = p;
    const food = kv > 0 ? p / kv : 0;
    const dt = 1 / SUBSTEPS;
    const T = TRAITS.length, tr = this.traits, growth = this.growth, meat = this.meat, diet = this.diet;
    // Só as espécies que o bloco pode ter (terra, mar ou os dois); quem ficou onde não cabe (o mar subiu) ainda é tratado até sumir.
    const kind = this.kind[b] as number, lingering = this.lingers(b, kind);
    const s0 = kind & 1 || lingering ? 0 : FIRST_SEA, s1 = kind & 2 || lingering ? NUMBERED : FIRST_SEA;
    for (let step = 0; step < SUBSTEPS; step++) {
      for (let s = s0; s < s1; s++) {
        const i = s * B + b;
        let N = pop[i] as number;
        if (N <= 0) continue;
        const room = cap[i] as number;
        if (room <= 0) { pop[i] = N * (1 - 0.5 * dt); continue; }
        const d = diet[s] as number, g = growth[s] as number;
        if (d !== 2) {
          // Presa: logística até o que o bloco sustenta. Planta em falta e ano seco baixam o teto.
          const k = d === 3 ? room * (0.3 + 0.7 * wet) : room * (0.35 + 0.65 * food) * wet / (tr[s * T + 1] as number);
          N += dt * g * (tr[s * T + 4] as number) * N * (1 - N / Math.max(1e-6, k));
          pop[i] = N > 0 ? N : 0;
          continue;
        }
        // Caçador: come o que alcança (a presa acima do refúgio), com saturação.
        const prey = this.preyOf[s] as number[];
        let reach = 0, full = 0;
        for (let q0 = 0; q0 < prey.length; q0++) {
          const q = prey[q0] as number, kq = cap[q * B + b] as number;
          if (kq <= 0) continue;
          // Presa veloz ou brava escapa mais; caçador agressivo alcança mais.
          const ease = (tr[s * T + 2] as number) / ((tr[q * T + 3] as number) * Math.sqrt(tr[q * T + 2] as number));
          const over = (pop[q * B + b] as number) - TUNE.refuge * kq;
          if (over > 0) reach += (meat[q] as number) * over * (ease < 1.5 ? ease : 1.5);
          full += (meat[q] as number) * kq;
        }
        const need = TUNE.need * Math.sqrt(meat[s] as number) * (tr[s * T + 1] as number) * (tr[s * T] as number), half = TUNE.half * full + 1e-6;
        // Caçadores da mesma espécie se atrapalham: quanto mais deles, menos cada um come. É o que deixa dois caçadores viverem da mesma presa.
        const eaten = TUNE.feast * need * (reach / (reach + half + TUNE.crowding * N * need));
        const total = N * eaten * dt;
        if (reach > 0 && total > 0) {
          const share = total < reach ? total / reach : 1;
          for (let q0 = 0; q0 < prey.length; q0++) {
            const q = prey[q0] as number, j = q * B + b, over = (pop[j] as number) - TUNE.refuge * (cap[j] as number);
            if (over > 0) pop[j] = (pop[j] as number) - over * share;
          }
        }
        // Bem alimentado, cresce até encher o território; com fome, encolhe na medida do que faltou.
        const fed = eaten < need ? eaten / need : 1;
        N += dt * N * g * (fed * (tr[s * T + 4] as number) - TUNE.crowd * (N / room) - (1 - fed) * TUNE.starve);
        pop[i] = N > 0 ? N : 0;
      }
    }
    // Migração: um pouco sempre; mais quando o bloco está cheio ou não sustenta mais a espécie.
    for (let s = s0; s < s1; s++) {
      const i = s * B + b, N = pop[i] as number;
      if (N <= 0) continue;
      if (N < VANISH) { pop[i] = 0; continue; }
      const room = cap[i] as number;
      const press = room > 0 ? Math.max(0, N / room - 0.8) : 2;
      const leave = N * Math.min(0.5, (0.03 + 0.25 * press) * (tr[s * T + 3] as number));
      let open = 0;
      for (let d = 0; d < 4; d++) if ((cap[s * B + (this.neighbors[b * 4 + d] as number)] as number) > 0) open++;
      if (!open) continue;
      pop[i] = N - leave;
      for (let d = 0; d < 4; d++) {
        const q = s * B + (this.neighbors[b * 4 + d] as number);
        if ((cap[q] as number) > 0) pop[q] = (pop[q] as number) + leave / open;
      }
    }
  }

  /** Há bicho de terra em bloco sem terra, ou de mar em bloco sem mar? (Olha só quando o bloco é de um tipo só.) */
  private lingers(b: number, kind: number): boolean {
    if (kind === 3) return false;
    const B = this.blocks, from = kind === 2 ? 0 : FIRST_SEA, to = kind === 2 ? FIRST_SEA : NUMBERED;
    for (let s = from; s < to; s++) if ((this.pop[s * B + b] as number) > 0) return true;
    return false;
  }

  /** Umidade da região pela floresta em volta (E9): floresta grande segura a chuva; onde ela some, tudo em volta cresce mais devagar. */
  moisture(b: number): number {
    let forest = this.plantCap[b] as number;
    for (let d = 0; d < 4; d++) forest += this.plantCap[this.neighbors[b * 4 + d] as number] as number;
    return 0.85 + 0.3 * Math.min(1, forest / 5 / 0.7);
  }

  private sumTotals(): void {
    const B = this.blocks;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      let t = 0;
      const o = s * B;
      for (let b = 0; b < B; b++) t += this.pop[o + b] as number;
      this.totals[s] = t;
    }
    for (const m of this.mythics) this.totals[m.species] = (this.totals[m.species] as number) + 1;
  }

  /** Bloco com mais indivíduos da espécie. */
  densest(s: number): number {
    let best = 0, at = 0;
    const o = s * this.blocks;
    for (let b = 0; b < this.blocks; b++) if ((this.pop[o + b] as number) > best) { best = this.pop[o + b] as number; at = b; }
    return at;
  }

  private closeYear(year: number): EcologyYear {
    const out: EcologyYear = { events: [], fires: [] };
    this.stepMythics(out);
    this.sumTotals();
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const sp = SPECIES[s] as SpeciesInfo;
      if (sp.mythic || this.extinct[s]) continue;
      const t = this.totals[s] as number;
      if (year < Ecology.SETTLE_YEARS) { this.peak[s] = t; continue; }
      if (t > (this.peak[s] as number)) this.peak[s] = t;
      const ref = this.peak[s] as number;
      if (ref <= 0) continue;
      const cell = this.centerCell(this.densest(s));
      if (t < 0.5) {
        this.pop.fill(0, s * this.blocks, (s + 1) * this.blocks);
        this.totals[s] = 0;
        this.extinct[s] = 1;
        out.events.push({ kind: 'extinta', species: s, cell, year });
      } else if (t < 1.5) {
        if (!this.lastOne[s]) { this.lastOne[s] = 1; out.events.push({ kind: 'ultimo', species: s, cell, year }); }
      } else if (t < RISK_SHARE * ref) {
        if (!this.atRisk[s]) { this.atRisk[s] = 1; out.events.push({ kind: 'risco', species: s, cell, year }); }
      } else if (t > RISK_CLEAR * ref && this.atRisk[s]) {
        this.atRisk[s] = 0; this.lastOne[s] = 0;
        out.events.push({ kind: 'recuperada', species: s, cell, year });
      }
    }
    return out;
  }

  // ---- Desastres (E4) ----

  /** Um estado do chão chegou à célula: parte dos bichos morre, parte foge para os blocos vizinhos. */
  hit(cell: number, state: number): void {
    const rule = HIT[state];
    if (!rule) return;
    const b = this.blockOf(cell), B = this.blocks, share = 1 / (BLOCK * BLOCK);
    this.stale[b] = 1;
    const water = (this.world.elevation[cell] as number) <= this.world.seaLevel;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      if ((this.sea[s] === 1) !== water) continue;
      const i = s * B + b, N = this.pop[i] as number;
      if (N <= 0) continue;
      const dead = N * share * rule[0], flee = N * share * rule[1];
      this.pop[i] = N - dead - flee;
      for (let d = 0; d < 4; d++) { const q = s * B + (this.neighbors[b * 4 + d] as number); this.pop[q] = (this.pop[q] as number) + flee / 4; }
    }
    if (rule[0] >= 0.9) this.mythics = this.mythics.filter((m) => m.cell !== cell);
  }

  // ---- Poderes de deus (E6) e classe mítica (E7) ----

  /** Põe indivíduos na célula. Mítico vira indivíduo de verdade; os outros entram nos números. Devolve quantos entraram. */
  place(species: number, cell: number, count: number, year = this.year): number {
    const sp = SPECIES[species];
    if (!sp || count <= 0) return 0;
    if (sp.mythic) {
      this.mythics.push({ id: this.nextMythic++, species, cell, fed: 1, born: year });
      this.totals[species] = (this.totals[species] as number) + 1;
      return 1;
    }
    const water = (this.world.elevation[cell] as number) <= this.world.seaLevel;
    if ((this.sea[species] === 1) !== water) return 0;
    const i = species * this.blocks + this.blockOf(cell);
    this.pop[i] = (this.pop[i] as number) + count;
    this.totals[species] = (this.totals[species] as number) + count;
    this.extinct[species] = 0; this.lastOne[species] = 0;
    return count;
  }

  /** Mata o que está nas células: uma espécie só, ou todas (`species` < 0). Devolve quantos morreram. */
  kill(cells: readonly number[], species: number): number {
    let dead = 0;
    const B = this.blocks, share = 1 / (BLOCK * BLOCK), set = new Set(cells);
    for (const c of cells) {
      const b = this.blockOf(c);
      for (let s = 0; s < SPECIES_COUNT; s++) {
        if (species >= 0 && s !== species) continue;
        const i = s * B + b, gone = (this.pop[i] as number) * share;
        this.pop[i] = (this.pop[i] as number) - gone;
        dead += gone;
      }
    }
    const before = this.mythics.length;
    this.mythics = this.mythics.filter((m) => !(set.has(m.cell) && (species < 0 || m.species === species)));
    return dead + before - this.mythics.length;
  }

  /** Muda uma característica da espécie inteira; os filhotes nascem com ela. */
  setTrait(species: number, trait: number, value: number): void {
    if (species < 0 || species >= SPECIES_COUNT || trait < 0 || trait >= TRAITS.length) return;
    this.traits[species * TRAITS.length + trait] = Math.max(TRAIT_RANGE[0], Math.min(TRAIT_RANGE[1], value));
    this.stale.fill(1);
  }

  /**
   * Míticos, uma vez por ano: andam para o bloco vizinho com mais presa, comem muito e não se reproduzem. Não envelhecem: só morrem pelo poder de deus ou num desastre que arrasa a célula.
   * O dragão às vezes põe fogo onde caça; a baleia branca ataca também os grandes do mar.
   */
  private stepMythics(out: EcologyYear): void {
    const B = this.blocks;
    for (const m of this.mythics) {
      const sp = SPECIES[m.species] as SpeciesInfo, prey = this.preyOf[m.species] as number[];
      const meatAt = (b: number): number => { let t = 0; for (const q of prey) t += (SPECIES[q] as SpeciesInfo).meat * (this.pop[q * B + b] as number); return t; };
      const here = this.blockOf(m.cell), sea = sp.biomes.length > 0;
      const fits = (b: number): boolean => { const c = this.centerCell(b), water = (this.world.elevation[c] as number) <= this.world.seaLevel; return sea ? water && !(this.world.ice[c] as number) : true; };
      // Território: anda pelo mundo, sempre para onde há mais caça; com fome, anda mesmo sem ver caça.
      let best = here, bestMeat = meatAt(here) * 1.15;
      for (let d = 0; d < 4; d++) {
        const q = this.neighbors[here * 4 + d] as number;
        if (!fits(q)) continue;
        const v = meatAt(q) + (m.fed < 0.5 ? this.rng.next() * 2 : 0);
        if (v > bestMeat) { best = q; bestMeat = v; }
      }
      if (best !== here) m.cell = this.centerCell(best);
      const appetite = m.species === 26 ? 12 : 20;
      let got = 0;
      const avail = meatAt(best);
      if (avail > 0) {
        const share = Math.min(0.6, appetite / avail);
        for (const q of prey) { const i = q * B + best, gone = (this.pop[i] as number) * share; this.pop[i] = (this.pop[i] as number) - gone; got += gone * (SPECIES[q] as SpeciesInfo).meat; }
      }
      m.fed = Math.min(1, got / appetite);
      if (m.species === 26 && got > 0 && this.rng.next() < 0.25) out.fires.push(m.cell);
    }
  }

  /** Números para a maquete: indivíduos por espécie e bloco, em dezesseis avos (cabe em 16 bits). */
  snapshot(): Uint16Array {
    const out = new Uint16Array(this.pop.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.min(65535, Math.round((this.pop[i] as number) * 16));
    return out;
  }

  /** As placas andaram ou o clima mudou muito: as capacidades de todos os blocos são refeitas na vez de cada um; aqui só o que não pode esperar. */
  blockPopulation(species: number, block: number): number { return this.pop[species * this.blocks + block] as number; }
}

/** "Em risco": total do mundo abaixo desta parte do maior total que a espécie já teve; sai do risco acima da segunda. */
export const RISK_SHARE = 0.15, RISK_CLEAR = 0.3;
