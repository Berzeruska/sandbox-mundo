import type { Rng } from '../../core/rng';
import { type Speed, TICKS_PER_YEAR } from '../../core/time';
import type { DisasterOutcome } from './index';
import type { WorldState } from '../state';
import { patchNoise } from './drought';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Meteoro (C12, aprovado em 2026-10-18; imagem `docs/img/m2-dv-meteoro.png`). Entra em ~1 s e abre uma
 * cratera de verdade no relevo (fundo afundado, borda erguida; para sempre, anda com a placa), com
 * entulho claro na borda, rocha escura no fundo, vegetação derrubada e incêndios em volta. No mar, do
 * médio para cima faz tsunami; o gigante esfria o planeta por um tempo (poeira e fuligem no ar).
 */

/** Tamanhos: 1 pequeno, 2 médio, 3 grande, 4 gigante. */
export const METEOR_NAMES = ['', 'pequeno', 'médio', 'grande', 'gigante'] as const;
/**
 * Maior cratera conhecida na Terra: Vredefort, 250–280 km de diâmetro (decisão do usuário, 2026-11-04).
 * Uma célula tem ~39 km (N = 256): ~4 células de raio. Nenhuma cratera passa disso, somando ou não.
 */
export const VREDEFORT_DIAMETER_KM = 280;
export const MAX_CRATER_RADIUS = 4;
/** Raio da cratera (células) e profundidade do fundo (m), por tamanho. O gigante chega ao limite real. */
export const CRATER_RADIUS = [0, 1, 2, 3, MAX_CRATER_RADIUS] as const;
export const CRATER_DEPTH = [0, 200, 500, 900, 1500] as const;
/** Fundo mais fundo que uma cratera chega (m): somar meteoros não cava além do gigante. */
export const MAX_CRATER_DEPTH = 1500;
/**
 * Até onde a onda de choque derruba vegetação e acende incêndios (células), por tamanho. Não depende da
 * cratera: o limite real é da cratera, o estrago em volta continua o aprovado na C12.
 */
export const BLAST_RADIUS = [0, 3, 7.5, 15, 30] as const;
/** No mar: magnitude do tsunami (0 = nenhum), por tamanho. */
export const SEA_TSUNAMI = [0, 0, 8, 8.5, 9.5] as const;
/** Tremor da tela como um terremoto desta magnitude (0 = nenhum), por tamanho. */
export const SHAKE_MAGNITUDE = [0, 0, 6.5, 7.5, 9] as const;
/** Gigante: inverno de impacto (°C a menos, anos). */
export const GIANT_WINTER = { amount: 3, years: 30 } as const;
/** Passos entre entrar no céu e bater em 1× (1 s). */
export const ENTRY_TICKS = 12;
/**
 * Com quantos passos de antecedência o meteoro natural é sorteado: o maior número de passos que 1 s pode ter
 * no Máx. O passo do impacto fica fixo no sorteio e o mundo é o mesmo em qualquer velocidade (regra 4); só o
 * momento em que a rocha aparece na tela muda.
 */
export const NATURAL_METEOR_LEAD = 2200;

/** Passos que 1 s real tem nesta velocidade: 12 em 1×, 240 em 20×; no Máx, o ritmo medido (`maxRate`). */
export function meteorFallTicks(speed: Speed, maxRate: number): number {
  if (speed === 'max') return Math.round(Math.min(NATURAL_METEOR_LEAD, Math.max(ENTRY_TICKS, maxRate)));
  return ENTRY_TICKS * Math.max(1, speed);
}
/**
 * Naturais por ano antes da frequência (decisão do usuário: pequenos os mais comuns; médios e grandes
 * cada vez mais raros; gigante raríssimo). Em "Raro" (0,4): um pequeno a cada ~1.250 anos de jogo.
 */
export const NATURAL_PER_YEAR = [0, 1 / 500, 1 / 3000, 1 / 20000, 1 / 200000] as const;
/** Incêndios acesos pelo impacto em vegetação (por tamanho). */
export const IMPACT_FIRES = [0, 1, 3, 5, 8] as const;

/** Tamanho de um meteoro natural sorteado neste ano, ou 0 (nenhum). */
export function sampleNaturalMeteor(rng: Rng, factor: number): number {
  for (let size = 4; size >= 1; size--) if (rng.next() < (NATURAL_PER_YEAR[size] as number) * factor) return size;
  return 0;
}

/**
 * Cratera guardada (P8 opção b, decisão do usuário de 2026-11-03): um meteoro que cai dentro dela soma o
 * estrago, até o limite real. Anda com a placa (o centro é acompanhado na recomposição).
 */
export interface Crater {
  cell: number;
  /** Raio (células) e profundidade do fundo (m) da cratera somada. */
  radius: number;
  depth: number;
}

/** Crateras guardadas, no máximo (as mais velhas saem). */
export const MAX_CRATERS = 256;

/**
 * O meteoro de tamanho `size` caindo a `distance` células do centro de `old`: soma com ela? Soma quando
 * cai dentro da cratera. A área soma (raio² + raio²) até MAX_CRATER_RADIUS e o fundo fica o mais fundo
 * dos dois: depois do limite, novos impactos não alargam nem aprofundam mais.
 */
export function mergeCrater(old: Crater | null, distance: number, size: number): { radius: number; depth: number } {
  const r = CRATER_RADIUS[size] as number;
  const depth = CRATER_DEPTH[size] as number;
  if (!old || distance > old.radius) return { radius: r, depth };
  return { radius: Math.min(MAX_CRATER_RADIUS, Math.sqrt(old.radius * old.radius + r * r)), depth: Math.min(MAX_CRATER_DEPTH, Math.max(old.depth, depth)) };
}

export interface Impact {
  /** Mudança do relevo (para sempre). */
  terrainCells: number[];
  terrainDeltas: number[];
  /** Onde acender fogo (vegetação perto da borda). */
  fires: number[];
}

/**
 * Perfil-alvo da cratera na célula, em relação ao terreno de antes: negativo no fundo (tigela), positivo
 * na borda erguida (até ~1,4 raio), 0 fora. A borda recortada nunca passa do raio: o raio é o limite.
 */
function craterProfile(world: WorldState, c: number, x: number, y: number, z: number, radius: number, depth: number): number {
  const p = world.grid.positions;
  const dot = (p[c * 3] as number) * x + (p[c * 3 + 1] as number) * y + (p[c * 3 + 2] as number) * z;
  const d = Math.acos(Math.max(-1, Math.min(1, dot))) / world.grid.cellAngle / (radius * (0.8 + 0.2 * patchNoise(world, c, 3)));
  if (d < 1) return -depth * (1 - d * d);
  return d < 1.4 ? depth * 0.25 * (1 - (d - 1) / 0.4) : 0;
}

/** Duas crateras na mesma célula: vale o fundo mais fundo; sem fundo, a borda mais alta. Não somam. */
function combineProfiles(a: number, b: number): number {
  return a < 0 || b < 0 ? Math.min(a, b) : Math.max(a, b);
}

/**
 * O impacto em `center`: a cratera (`shape`) no relevo, rocha escura no fundo, entulho claro na borda
 * (20–50 anos), vegetação derrubada até BLAST_RADIUS. `existing`: as crateras que já estão no mundo (com a
 * que esta substitui); o relevo só anda do perfil que elas já fizeram até o novo, então repetir um meteoro
 * no mesmo lugar não cava de novo.
 */
export function impact(world: WorldState, ground: Ground, center: number, size: number, tick: number, rng: Rng, shape?: { radius: number; depth: number }, existing: readonly Crater[] = []): Impact {
  const p = world.grid.positions;
  const cx = p[center * 3] as number;
  const cy = p[center * 3 + 1] as number;
  const cz = p[center * 3 + 2] as number;
  // `shape`: cratera somada com uma antiga (P8 b); sem ela, a do tamanho do meteoro.
  const r = shape?.radius ?? (CRATER_RADIUS[size] as number);
  const depth = shape?.depth ?? (CRATER_DEPTH[size] as number);
  const ang = world.grid.cellAngle;
  const reach = Math.max(BLAST_RADIUS[size] as number, r * 1.4 + 1);
  // Só as crateras que encostam nesta (as guardadas podem estar em qualquer lugar do mundo).
  const nearby = existing
    .map((k) => ({ x: p[k.cell * 3] as number, y: p[k.cell * 3 + 1] as number, z: p[k.cell * 3 + 2] as number, radius: k.radius, depth: k.depth }))
    .filter((k) => Math.acos(Math.max(-1, Math.min(1, k.x * cx + k.y * cy + k.z * cz))) <= (r + k.radius) * 1.4 * ang);
  const terrainCells: number[] = [];
  const terrainDeltas: number[] = [];
  const near: number[] = [];
  for (const c of world.grid.cellsInCap(cx, cy, cz, (reach + 0.5) * ang)) {
    const target = craterProfile(world, c, cx, cy, cz, r, depth);
    let already = 0;
    for (const k of nearby) already = combineProfiles(already, craterProfile(world, c, k.x, k.y, k.z, k.radius, k.depth));
    let delta = combineProfiles(already, target) - already;
    // Em terra o fundo fica acima do mar (a cratera não vira mar; no mar ela fica no fundo).
    if (delta < 0 && !world.isWater(c)) delta = Math.max(delta, -Math.max(0, world.heightAboveSea(c) - 20));
    if (Math.abs(delta) > 1) {
      terrainCells.push(c);
      terrainDeltas.push(delta);
    }
    const dot = (p[c * 3] as number) * cx + (p[c * 3 + 1] as number) * cy + (p[c * 3 + 2] as number) * cz;
    const cells = Math.acos(Math.max(-1, Math.min(1, dot))) / ang;
    const d = cells / (r * (0.8 + 0.2 * patchNoise(world, c, 3)));
    if (world.isWater(c) && d >= 1) continue;
    if (d < 0.8) {
      ground.damage(c, 1);
      ground.setState(c, CellState.Impact, tick, rng.range(100, 300), TICKS_PER_YEAR);
    } else if (d < 1.4) {
      ground.damage(c, 1);
      ground.setState(c, CellState.Ejecta, tick, rng.range(20, 50), TICKS_PER_YEAR);
    } else if (cells <= reach && hasVegetation(world.biome[c] as number)) {
      // Onda de choque: derruba mais perto da cratera.
      ground.damage(c, Math.max(0.2, 1 - cells / reach) * (0.7 + 0.3 * cellHash(c, 0x3e7)));
      near.push(c);
    }
  }
  const fires: number[] = [];
  const count = IMPACT_FIRES[size] as number;
  for (let k = 0; k < count && near.length; k++) fires.push(near.splice(rng.int(0, near.length - 1), 1)[0] as number);
  return { terrainCells, terrainDeltas, fires };
}

/**
 * O meteoro andando: bate no passo `at`, fixado quando ele nasce. `onEntry` é chamado uma vez, quando faltam
 * `fallTicks()` passos ou menos: é quando a rocha entra na tela.
 */
export class MeteorProcess {
  private entered = false;

  constructor(
    private readonly at: number,
    private fallTicks: () => number,
    private onEntry: (tick: number, at: number, out: DisasterOutcome) => void,
    private onImpact: (tick: number, out: DisasterOutcome) => void,
  ) {}

  /** Passo do impacto, se a rocha já está caindo à vista; senão -1 (T8: a velocidade espera por ela). */
  fallingImpact(): number {
    return this.entered ? this.at : -1;
  }

  /** A rocha entra já, se chegou a hora (o meteoro do jogador entra no passo em que foi pedido). */
  enter(tick: number, out: DisasterOutcome): void {
    if (this.entered || this.at - tick > this.fallTicks()) return;
    this.entered = true;
    this.onEntry(tick, this.at, out);
  }

  step(tick: number, out: DisasterOutcome): boolean {
    this.enter(tick, out);
    if (tick < this.at) return true;
    this.onImpact(tick, out);
    return false;
  }
}
