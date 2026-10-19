import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
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
/** Raio da cratera (células) e profundidade do fundo (m), por tamanho. */
export const CRATER_RADIUS = [0, 1, 3, 6, 12] as const;
export const CRATER_DEPTH = [0, 200, 500, 900, 1500] as const;
/** Vegetação derrubada e incêndios até este múltiplo do raio da cratera. */
export const BLAST_FACTOR = 2.5;
/** No mar: magnitude do tsunami (0 = nenhum), por tamanho. */
export const SEA_TSUNAMI = [0, 0, 8, 8.5, 9.5] as const;
/** Tremor da tela como um terremoto desta magnitude (0 = nenhum), por tamanho. */
export const SHAKE_MAGNITUDE = [0, 0, 6.5, 7.5, 9] as const;
/** Gigante: inverno de impacto (°C a menos, anos). */
export const GIANT_WINTER = { amount: 3, years: 30 } as const;
/** Passos entre entrar no céu e bater (~1 s em 1×). */
export const ENTRY_TICKS = 12;
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

export interface Impact {
  /** Mudança do relevo (para sempre). */
  terrainCells: number[];
  terrainDeltas: number[];
  /** Onde acender fogo (vegetação perto da borda). */
  fires: number[];
}

/**
 * O impacto em `center`: cratera no relevo (perfil de tigela, borda erguida a ~1,2 raio), rocha escura
 * no fundo, entulho claro na borda (20–50 anos), vegetação derrubada até BLAST_FACTOR raios.
 */
export function impact(world: WorldState, ground: Ground, center: number, size: number, tick: number, rng: Rng): Impact {
  const p = world.grid.positions;
  const cx = p[center * 3] as number;
  const cy = p[center * 3 + 1] as number;
  const cz = p[center * 3 + 2] as number;
  const r = CRATER_RADIUS[size] as number;
  const depth = CRATER_DEPTH[size] as number;
  const ang = world.grid.cellAngle;
  const reach = Math.max(r * BLAST_FACTOR, r + 2);
  const terrainCells: number[] = [];
  const terrainDeltas: number[] = [];
  const near: number[] = [];
  for (const c of world.grid.cellsInCap(cx, cy, cz, (reach + 0.5) * ang)) {
    const dot = (p[c * 3] as number) * cx + (p[c * 3 + 1] as number) * cy + (p[c * 3 + 2] as number) * cz;
    // Distância em raios da cratera, com a borda um pouco recortada.
    const d = Math.acos(Math.max(-1, Math.min(1, dot))) / ang / (r * (0.9 + 0.2 * patchNoise(world, c, 3)));
    let delta = 0;
    if (d < 1) delta = -depth * (1 - d * d);
    else if (d < 1.4) delta = depth * 0.25 * (1 - (d - 1) / 0.4);
    if (Math.abs(delta) > 1) {
      terrainCells.push(c);
      terrainDeltas.push(delta);
    }
    if (world.isWater(c) && d >= 1) continue;
    if (d < 0.8) {
      ground.damage(c, 1);
      ground.setState(c, CellState.Impact, tick, rng.range(100, 300), TICKS_PER_YEAR);
    } else if (d < 1.4) {
      ground.damage(c, 1);
      ground.setState(c, CellState.Ejecta, tick, rng.range(20, 50), TICKS_PER_YEAR);
    } else if (d * r <= reach && hasVegetation(world.biome[c] as number)) {
      // Onda de choque: derruba mais perto da cratera.
      ground.damage(c, Math.max(0.2, 1 - (d * r) / reach) * (0.7 + 0.3 * cellHash(c, 0x3e7)));
      near.push(c);
    }
  }
  const fires: number[] = [];
  const count = IMPACT_FIRES[size] as number;
  for (let k = 0; k < count && near.length; k++) fires.push(near.splice(rng.int(0, near.length - 1), 1)[0] as number);
  return { terrainCells, terrainDeltas, fires };
}

/** O meteoro andando: entra no céu e, ENTRY_TICKS passos depois, bate. */
export class MeteorProcess {
  private readonly at: number;

  constructor(
    start: number,
    private onImpact: (tick: number) => void,
  ) {
    this.at = start + ENTRY_TICKS;
  }

  step(tick: number): boolean {
    if (tick < this.at) return true;
    this.onImpact(tick);
    return false;
  }
}
