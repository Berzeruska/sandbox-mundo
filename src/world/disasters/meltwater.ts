import { TICKS_PER_YEAR } from '../../core/time';
import type { WorldState } from '../state';
import { patchNoise } from './drought';
import { CellState, cellHash, type Ground } from './ground';

/**
 * Vulcão debaixo do gelo (C10, aprovado em 2026-10-18; imagem `docs/img/m2-dv-gelo-vulcao.png`). O
 * calor do vulcão acordado e a lava derretem o gelo; a água do degelo se junta e desce de uma vez numa
 * enchente súbita (jökulhlaup), seguindo o terreno mais baixo, mais rápida e mais larga que a lava. Onde
 * ela passa fica água barrenta por 1–2 anos e depois areia e cascalho (30–80 anos). O gelo derretido só
 * volta onde o clima é de gelo, e devagar (o relógio devolve a célula ao clima depois de décadas).
 */

/** Células da enchente por célula de gelo derretida, e o máximo. */
export const MELT_CELLS_PER_ICE = 4;
export const MELT_MAX_CELLS = 150;
/** Gelo derretido mínimo para soltar a enchente. */
export const MELT_MIN_ICE = 3;
/** Células por passo (mais rápida que a lava). */
export const MELT_SPEED = 2;
/** Anos com a água em cima. */
export const MELT_YEARS: readonly [number, number] = [1, 2];
/** Enchente do degelo a partir deste tamanho vira aviso. */
export const NOTABLE_MELT_CELLS = 60;
/** Quanto tempo (anos) até o gelo derretido voltar ao clima (onde o clima é de gelo, ele volta). */
export const ICE_RETURN_YEARS: readonly [number, number] = [40, 150];

/** A enchente do degelo, andando: enche pelo mais baixo a partir de `start`, MELT_SPEED células por passo. */
export class MeltwaterProcess {
  private front: number[];
  private seen = new Set<number>();
  private placed = 0;

  constructor(
    private world: WorldState,
    private ground: Ground,
    start: number,
    exclude: Iterable<number>,
    private budget: number,
  ) {
    for (const c of exclude) this.seen.add(c);
    this.seen.add(start);
    this.front = [start];
  }

  step(tick: number): boolean {
    const world = this.world;
    const { neighbors } = world.grid;
    const height = (x: number): number => (world.elevation[x] as number) + 40 * patchNoise(world, x, 2);
    for (let k = 0; k < MELT_SPEED && this.front.length && this.placed < this.budget; k++) {
      let best = 0;
      for (let i = 1; i < this.front.length; i++) if (height(this.front[i] as number) < height(this.front[best] as number)) best = i;
      const c = this.front.splice(best, 1)[0] as number;
      this.placed++;
      // Chegou no mar (ou num lago): acaba ali.
      if (world.isWater(c)) continue;
      this.ground.damage(c, 1);
      this.ground.setState(c, CellState.Meltwater, tick, MELT_YEARS[0] + (MELT_YEARS[1] - MELT_YEARS[0]) * cellHash(c, 0x6e), TICKS_PER_YEAR);
      // Sempre a mais baixa da frente: enche as baixadas e transborda pelo ponto mais baixo, como a água.
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (this.seen.has(j)) continue;
        this.seen.add(j);
        this.front.push(j);
      }
    }
    return this.front.length > 0 && this.placed < this.budget;
  }

  remap(moved: ReadonlyMap<number, number>): void {
    this.front = this.front.map((c) => moved.get(c) ?? -1).filter((c) => c >= 0);
    this.seen = new Set([...this.seen].map((c) => moved.get(c) ?? -1).filter((c) => c >= 0));
  }
}

/** Gelo derretido voltando ao clima, devagar: em cada passo agendado, as células voltam ao modo automático. */
export class IceReturnProcess {
  private due = new Map<number, number[]>();
  private last = 0;

  /** Agenda as células para voltar entre 40 e 150 anos depois de `tick`. */
  add(cells: readonly number[], tick: number): void {
    for (const c of cells) {
      const at = tick + Math.round((ICE_RETURN_YEARS[0] + (ICE_RETURN_YEARS[1] - ICE_RETURN_YEARS[0]) * cellHash(c, 0x1ce)) * TICKS_PER_YEAR);
      const list = this.due.get(at);
      if (list) list.push(c);
      else this.due.set(at, [c]);
      this.last = Math.max(this.last, at);
    }
  }

  /** Células que voltam ao clima neste passo (e se ainda há alguma agendada). */
  take(tick: number): number[] {
    const out = this.due.get(tick) ?? [];
    this.due.delete(tick);
    return out;
  }

  get pending(): boolean {
    return this.due.size > 0;
  }
}
