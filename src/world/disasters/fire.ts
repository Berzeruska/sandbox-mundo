import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Biome } from '../biomes';
import type { WorldState } from '../state';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Incêndio e raio (Bloco Desastres v2, R3). O fogo anda célula por célula no relógio: a cada
 * SPREAD_EVERY passos, cada célula em chamas tenta acender as 4 vizinhas. Lógica pura e determinística
 * (sorteios só pelo gerador dos desastres, na ordem dos passos).
 */

/** De quantos em quantos passos (meses) o fogo tenta passar para as vizinhas. */
export const SPREAD_EVERY = 2;

/**
 * Chance de uma vizinha pegar fogo a cada tentativa, pelo bioma dela (antes da vegetação, do
 * combustível da célula, da seca e do vento). Campo, estepe e savana pegam mais; floresta tropical e
 * pântano, úmidos, pegam pouco. Calibradas para a frente andar ~2–4 células por segundo em 1× e para o
 * fogo, sem seca, quase sempre parar sozinho (a favor do vento ~55% por célula ao longo de toda a
 * queima, abaixo do ponto em que ele correria sem fim); na seca (×3) ele vira os incêndios grandes.
 */
export const IGNITE: Readonly<Partial<Record<number, number>>> = {
  [Biome.Grassland]: 0.27,
  [Biome.Steppe]: 0.25,
  [Biome.Savanna]: 0.27,
  [Biome.Tundra]: 0.08,
  [Biome.TemperateForest]: 0.115,
  [Biome.Taiga]: 0.115,
  [Biome.TropicalForest]: 0.03,
  [Biome.Swamp]: 0.02,
};

/** Quantas tentativas de passar o fogo cada célula faz antes de virar cinza (capim queima rápido). */
export const BURN_TRIES: Readonly<Partial<Record<number, number>>> = {
  [Biome.Grassland]: 1,
  [Biome.Steppe]: 1,
  [Biome.Savanna]: 1,
  [Biome.Tundra]: 1,
  [Biome.TemperateForest]: 3,
  [Biome.Taiga]: 3,
  [Biome.TropicalForest]: 3,
  [Biome.Swamp]: 2,
};

/** Na seca (estado "calor"), o fogo pega 3× mais (especificação). */
export const DROUGHT_FIRE = 3;
/** A favor do vento o fogo corre (×2); contra, quase não anda (×0,5). */
export const DOWNWIND = 2;
export const UPWIND = 0.5;
/**
 * O incêndio do jogador (ferramenta Incêndio ou Raio) é mais forte, como os outros desastres provocados:
 * começa num foco de PLAYER_FIRE_RADIUS células e pega PLAYER_FIRE_BOOST vezes mais. Assim ele quase
 * sempre anda (em geral ~25–110 células em N = 256, medido), sem virar incêndio de continente.
 */
export const PLAYER_FIRE_BOOST = 1.2;
export const PLAYER_FIRE_RADIUS = 2;
/** Incêndio a partir deste tamanho (células queimadas) vira aviso. */
export const NOTABLE_FIRE_CELLS = 60;

/** O fogo entra nesta célula? Só em terra com vegetação, sem gelo, que ainda não queimou. */
export function canBurn(world: WorldState, ground: Ground, c: number): boolean {
  if (world.isWater(c) || world.ice[c] || !hasVegetation(world.biome[c] as number)) return false;
  const s = ground.state[c] as number;
  return s !== CellState.Burning && s !== CellState.Burned && s !== CellState.Lava && s !== CellState.Basalt && s !== CellState.Mud && (ground.cover[c] as number) > 0.05;
}

/**
 * Direção do vento na célula (vetor unitário na superfície, para onde ele sopra): para oeste perto do
 * equador (alísios) e acima de 60°, para leste no meio (ventos de oeste), como as nuvens do globo.
 */
export function windAt(world: WorldState, c: number): [number, number, number] {
  const p = world.grid.positions;
  const x = p[c * 3] as number;
  const y = p[c * 3 + 1] as number;
  const z = p[c * 3 + 2] as number;
  // Leste local: eixo do planeta (y) × p, normalizado.
  let ex = z;
  let ez = -x;
  const len = Math.hypot(ex, ez) || 1;
  ex /= len;
  ez /= len;
  const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, y))));
  const east = lat >= Math.PI / 6 && lat < Math.PI / 3 ? 1 : -1;
  return [ex * east, 0, ez * east];
}

/** Fator do vento para o fogo passar de `from` para `to`: ×2 a favor, ×0,5 contra, 1 de lado. */
export function windFactor(world: WorldState, from: number, to: number): number {
  const p = world.grid.positions;
  const w = windAt(world, from);
  const dx = (p[to * 3] as number) - (p[from * 3] as number);
  const dy = (p[to * 3 + 1] as number) - (p[from * 3 + 1] as number);
  const dz = (p[to * 3 + 2] as number) - (p[from * 3 + 2] as number);
  const d = (dx * w[0] + dy * w[1] + dz * w[2]) / (Math.hypot(dx, dy, dz) || 1);
  return d > 0.5 ? DOWNWIND : d < -0.5 ? UPWIND : 1;
}

/**
 * Combustível da célula (0,6–1,4, fixo por célula): umas queimam mais que outras, e o fogo faz bordas
 * irregulares e deixa ilhas sem queimar, em vez de avançar em bloco.
 */
export function fuelOf(c: number): number {
  return 0.6 + 0.8 * cellHash(c, 0x7f4a);
}

/** Chance de `to` pegar fogo numa tentativa vinda de `from` (`boost`: força extra deste incêndio). */
export function igniteChance(world: WorldState, ground: Ground, from: number, to: number, boost = 1): number {
  if (!canBurn(world, ground, to)) return 0;
  const base = IGNITE[world.biome[to] as number] ?? 0;
  const dry = ground.state[to] === CellState.Heat ? DROUGHT_FIRE : 1;
  return Math.min(0.95, base * boost * fuelOf(to) * (ground.cover[to] as number) * dry * windFactor(world, from, to));
}

/** Um incêndio em andamento: as células em chamas e quantas tentativas cada uma ainda tem. */
export class FireProcess {
  private burning: number[] = [];
  private tries = new Map<number, number>();
  /** Células queimadas por este incêndio até agora. */
  burned = 0;
  readonly startTick: number;

  constructor(
    private world: WorldState,
    private ground: Ground,
    private rng: Rng,
    readonly start: number,
    tick: number,
    /** Chamado quando o fogo apaga, com quantas células queimou. */
    private onEnd: (burned: number) => void = () => undefined,
    /** Força extra (o incêndio do jogador é mais forte, como os outros desastres provocados). */
    private boost = 1,
  ) {
    this.startTick = tick;
    this.ignite(start, tick);
    this.burning.push(start);
  }

  /** Acende mais células junto com a primeira (o incêndio do jogador começa num foco maior). */
  igniteAlso(cells: readonly number[], tick: number): void {
    for (const c of cells) {
      if (c === this.start || !canBurn(this.world, this.ground, c)) continue;
      this.ignite(c, tick);
      this.burning.push(c);
    }
  }

  /** Quantas células estão em chamas agora. */
  get size(): number {
    return this.burning.length;
  }

  private ignite(c: number, tick: number): void {
    const tries = BURN_TRIES[this.world.biome[c] as number] ?? 1;
    // Fica "em chamas" até a última tentativa; depois o relógio do chão vira queimada (vegetação 0).
    this.ground.setState(c, CellState.Burning, tick, (tries * SPREAD_EVERY + 1) / TICKS_PER_YEAR, TICKS_PER_YEAR);
    this.tries.set(c, tries);
    this.burned++;
  }

  /** Um passo do relógio. Devolve false quando apagou. */
  step(tick: number): boolean {
    if ((tick - this.startTick) % SPREAD_EVERY !== 0) return this.burning.length > 0;
    const { neighbors } = this.world.grid;
    const lit: number[] = [];
    const still: number[] = [];
    for (const c of this.burning) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        const chance = igniteChance(this.world, this.ground, c, j, this.boost);
        if (chance > 0 && this.rng.next() < chance) {
          this.ignite(j, tick);
          lit.push(j);
        }
      }
      const left = (this.tries.get(c) ?? 1) - 1;
      if (left > 0) {
        this.tries.set(c, left);
        still.push(c);
      } else {
        this.tries.delete(c);
      }
    }
    this.burning = still.concat(lit);
    if (!this.burning.length) this.onEnd(this.burned);
    return this.burning.length > 0;
  }
}

/**
 * Raios naturais (R3): por ano, quantos caem em terra com vegetação onde podem acender fogo (os outros
 * só fazem o clarão e não entram na simulação). Antes da frequência ("Raro" = 1).
 */
export const LIGHTNING_PER_YEAR = 0.6;
/** Chance de um raio que caiu em vegetação cheia acender (a do jogador sempre acende). */
export const LIGHTNING_IGNITE = 0.35;

/**
 * Onde cai um raio natural: debaixo das nuvens mais carregadas (onde mais chove) ou na seca (raio
 * "seco", o que mais acende fogo). Devolve a célula ou −1.
 */
export function pickLightningCell(world: WorldState, ground: Ground, rng: Rng): number {
  for (let k = 0; k < 200; k++) {
    const c = rng.int(0, world.cellCount - 1);
    if (world.isWater(c) || world.ice[c]) continue;
    const dry = ground.state[c] === CellState.Heat;
    const stormy = Math.min(1, (world.precipitation[c] as number) / 2000);
    if (rng.next() < (dry ? 0.9 : stormy)) return c;
  }
  return -1;
}

/** Chance de o raio natural acender o fogo na célula (vegetação, seca; chuva forte apaga). */
export function lightningIgnites(world: WorldState, ground: Ground, c: number): number {
  if (!canBurn(world, ground, c)) return 0;
  const dry = ground.state[c] === CellState.Heat;
  const wet = dry ? 0 : Math.min(0.8, (world.precipitation[c] as number) / 3000);
  return Math.min(1, LIGHTNING_IGNITE * (ground.cover[c] as number) * (dry ? DROUGHT_FIRE : 1) * (1 - wet));
}
