import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';
import { hurricaneTrack, type HurricaneTrack } from './weather';

/**
 * Furacão e ciclone (Bloco Desastres v2, R8; imagem `docs/img/m2-dv-furacao.png`). Anda pelo mapa no
 * relógio, ~1 célula por passo, pela trilha de sempre (oeste, curva para o polo, depois leste); cresce
 * em mar quente e enfraquece em terra e em mar frio. Por onde passa, derruba vegetação; na costa, a
 * ressaca alaga terra baixa; em terra, a chuva dispara enchentes. O desenho é das nuvens do próprio globo
 * torcidas em volta do centro (shader); a simulação manda a posição e a força a cada laço.
 */

/** Categoria 1–2 é ciclone; 3–5, furacão. */
export function stormName(category: number): string {
  return category <= 2 ? 'Ciclone' : 'Furacão';
}

/** Raio do estrago (células): ciclone 2; furacão 3, 4, 5 pela categoria. */
export function damageRadius(category: number): number {
  return category < 2.5 ? 2 : Math.min(5, Math.round(category));
}

/** Vida máxima (passos): 12 s em 1×. */
export const MAX_TRACK_TICKS = 144;
/** Até 2 por quadrante do globo e 8 ao todo. */
export const MAX_PER_QUADRANT = 2;
export const MAX_STORMS_WORLD = 8;
/** A vegetação no caminho perde 30–70%. */
export const WIND_DAMAGE: readonly [number, number] = [0.3, 0.7];
/** Ressaca: terra baixa (m) a até 1–3 células da costa, alagada por 1–2 anos. */
export const SURGE_HEIGHT = 30;
export const SURGE_CELLS = 3;
/** Chuva em terra: chance por passo de disparar uma enchente (no máximo RAIN_FLOODS por furacão). */
export const RAIN_FLOOD_CHANCE = 0.08;
export const RAIN_FLOODS = 2;
/** Furacão de fogo: acende a vegetação a até FIRE_CORE células do centro. */
export const FIRE_CORE = 1.6;

/** Quadrante do globo (0–3): hemisfério e metade leste/oeste. */
export function quadrantOf(p: Vec3): number {
  return (p[1] >= 0 ? 0 : 2) + (Math.atan2(p[0], p[2]) >= 0 ? 0 : 1);
}

export interface StormView {
  /** Identidade (para a tela acompanhar cada um). */
  id: number;
  point: Vec3;
  /** Raio do desenho (rad) e força 0–1 com o sinal do giro (hemisfério). */
  radius: number;
  power: number;
  fire: boolean;
}

/** Um furacão andando. */
export class HurricaneProcess {
  readonly track: HurricaneTrack;
  private k = 0;
  /** Furacão de fogo (o jogador jogou um raio nele). */
  fire = false;
  private damaged = new Set<number>();
  private floods = 0;

  constructor(
    private world: WorldState,
    private ground: Ground,
    private rng: Rng,
    start: number,
    category: number,
    readonly startTick: number,
    /** Número do furacão entre os que nasceram no mesmo passo. */
    private slot: number,
    private hooks: {
      /** A chuva em terra dispara uma enchente perto de `cell`. */
      flood(cell: number, tick: number): void;
      /** Furacão de fogo: acende estas células. */
      ignite(cells: number[], tick: number): void;
    },
  ) {
    this.track = hurricaneTrack(world, start, category, rng, world.grid.cellAngle, MAX_TRACK_TICKS);
  }

  /** Onde ele está agora e com que força (para o desenho e para o raio do jogador). */
  view(): StormView | null {
    const n = this.track.points.length;
    if (this.k >= n) return null;
    const p = this.track.points[this.k] as Vec3;
    const cat = this.track.strength[this.k] as number;
    // Nasce e some aos poucos.
    const fade = Math.min(1, (this.k + 1) / 8, (n - this.k) / 6);
    return { id: this.startTick * 16 + this.slot, point: p, radius: 0.05 + 0.015 * cat, power: (p[1] >= 0 ? 1 : -1) * Math.max(0.05, Math.min(1, cat / 5) * fade), fire: this.fire };
  }

  get category(): number {
    return (this.track.strength[Math.min(this.k, this.track.strength.length - 1)] as number) ?? 0;
  }

  step(tick: number): boolean {
    const n = this.track.points.length;
    if (this.k >= n) return false;
    const world = this.world;
    const p = this.track.points[this.k] as Vec3;
    const cat = this.track.strength[this.k] as number;
    const radius = damageRadius(cat);
    const center = world.grid.pointToCell(p[0], p[1], p[2]);
    const overLand = !world.isWater(center);
    const ang = world.grid.cellAngle;
    const burn: number[] = [];
    for (const c of world.grid.cellsInCap(p[0], p[1], p[2], radius * ang)) {
      if (world.isWater(c) || world.ice[c]) continue;
      // Vento: derruba a vegetação uma vez por furacão.
      if (!this.damaged.has(c) && hasVegetation(world.biome[c] as number)) {
        this.damaged.add(c);
        this.ground.damage(c, WIND_DAMAGE[0] + (WIND_DAMAGE[1] - WIND_DAMAGE[0]) * cellHash(c, 0x8c));
      }
      // Ressaca: terra baixa perto da costa.
      if (!overLand && world.heightAboveSea(c) < SURGE_HEIGHT && world.waterDistance[c] !== undefined && (world.waterDistance[c] as number) <= SURGE_CELLS) {
        if (this.ground.state[c] !== CellState.Flooded) this.ground.setState(c, CellState.Flooded, tick, 1 + cellHash(c, 0x5e), TICKS_PER_YEAR, 0.5);
      }
    }
    if (this.fire && overLand) {
      for (const c of world.grid.cellsInCap(p[0], p[1], p[2], FIRE_CORE * ang)) if (!world.isWater(c) && hasVegetation(world.biome[c] as number)) burn.push(c);
      if (burn.length) this.hooks.ignite(burn, tick);
    }
    // Chuva forte em terra: enchente nas partes baixas.
    if (overLand && this.floods < RAIN_FLOODS && this.rng.next() < RAIN_FLOOD_CHANCE) {
      this.floods++;
      this.hooks.flood(center, tick);
    }
    this.k++;
    return this.k < n;
  }
}
