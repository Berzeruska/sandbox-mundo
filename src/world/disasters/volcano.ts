import type { Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import { Crust } from '../plates';
import type { WorldState } from '../state';
import { patchNoise } from './drought';
import { windAt } from './fire';
import { CellState, cellHash, type Ground, hasVegetation } from './ground';

/**
 * Vulcões no mapa (Bloco Desastres v2, R7; imagem `docs/img/m2-dv-vulcao-v2.png`). Cada vulcão tem um
 * cone de verdade no relevo (mais alto no anel, cratera no meio), marcado como rocha no chão; dorme por
 * séculos e acorda por alguns anos, com lava na cratera e erupções a cada 1–3 anos. A lava sai pela
 * borda mais baixa da cratera, desce o cone por um canal e segue o terreno, uma célula por passo,
 * alargando no plano; esfria em basalto; no mar vira terra nova. Lógica pura e determinística.
 */

export type VolcanoKind = 'arc' | 'hotspot' | 'player';

export interface Volcano {
  id: number;
  /** Célula da cratera (anda com a placa nas recomposições). */
  cell: number;
  kind: VolcanoKind;
  /** Ponto quente de onde nasceu (−1 nos outros). */
  hotspot: number;
  /** Raio do cone (células, 1–5) e altura do cone no anel (m, somada ao terreno de antes). */
  cone: number;
  top: number;
  /** Acordado (lava na cratera, erupções) ou dormindo. */
  awake: boolean;
  /** Passo em que acorda (dormindo) ou dorme (acordado). */
  until: number;
  nextEruption: number;
  /** Extinto: não acorda mais (o ponto quente ficou para trás). */
  extinct: boolean;
}

/** Raio da cratera (células): 0 = uma célula; 1 = 3×3 (os grandes, cone de 4–5). */
export function craterRadius(cone: number): number {
  return cone >= 4 ? 1.3 : 0.6;
}

/** Altura do cone no anel pelo raio (m): pequeno ~800, grande ~2.100. */
export function coneTop(cone: number): number {
  return 400 + 380 * cone;
}

/** Quanto o cone de raio `cone` e altura `top` ergue uma célula a `d` células do centro (m). */
export function coneProfile(cone: number, top: number, d: number): number {
  const reach = cone + 0.6;
  const crater = craterRadius(cone);
  // A cratera é um buraco abaixo do anel (a borda dela é o ponto mais alto do cone).
  if (d < crater) return Math.max(0, top * (1 - crater / reach) - (220 + 40 * cone));
  return Math.max(0, top * Math.max(0, 1 - d / reach));
}

/** Dormindo por quantos anos (antes da frequência), por tipo. */
export const DORMANT_YEARS: Readonly<Record<VolcanoKind, readonly [number, number]>> = {
  arc: [200, 3000],
  hotspot: [80, 800],
  player: [200, 3000],
};
/** Acordado por 3–20 anos, com erupção a cada 1–3 anos. */
export const AWAKE_YEARS: readonly [number, number] = [3, 20];
export const ERUPTION_EVERY: readonly [number, number] = [1, 3];
/** Lava por erupção (células), pelo IEV: 0–2 → 10–40; 3+ → 20–80. */
export function lavaBudget(vei: number, rng: Rng): number {
  return vei <= 2 ? rng.int(10, 40) : rng.int(20, 80);
}
/** A lava fica vermelha 1–3 anos (depois o relógio do chão a esfria em basalto, 100–300 anos). */
export const LAVA_YEARS: readonly [number, number] = [1, 3];
/** Cinzas só nas erupções fortes (IEV ≥ ASH_VEI), a favor do vento, tirando 20–40% da vegetação. */
export const ASH_VEI = 4;
export const ASH_YEARS = 10;
/** Raios na nuvem de cinzas por erupção forte e a chance de cada um acender fogo. */
export const ASH_LIGHTNING: readonly [number, number] = [2, 4];
export const ASH_LIGHTNING_FIRE = 0.6;
/** Raio natural num vulcão adormecido o acorda com esta chance (o do jogador sempre). */
export const LIGHTNING_WAKE = 0.05;
/** Arcos: um vulcão a cada ~ARC_SPACING células de fronteira convergente, no máximo. */
export const ARC_SPACING = 14;

/** Distância em células entre duas células (ângulo / ângulo da célula). */
function cellDist(world: WorldState, a: number, b: number): number {
  const p = world.grid.positions;
  const dot = (p[a * 3] as number) * (p[b * 3] as number) + (p[a * 3 + 1] as number) * (p[b * 3 + 1] as number) + (p[a * 3 + 2] as number) * (p[b * 3 + 2] as number);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / world.grid.cellAngle;
}

/** Células do cone com a distância ao centro (células), em ordem fixa. */
export function coneCells(world: WorldState, v: Volcano, radius = v.cone + 0.6): { cells: number[]; dist: number[] } {
  const p = world.grid.positions;
  const cells: number[] = [];
  const dist: number[] = [];
  const cx = p[v.cell * 3] as number;
  const cy = p[v.cell * 3 + 1] as number;
  const cz = p[v.cell * 3 + 2] as number;
  for (const c of world.grid.cellsInCap(cx, cy, cz, radius * world.grid.cellAngle)) {
    cells.push(c);
    dist.push(cellDist(world, v.cell, c));
  }
  return { cells, dist };
}

/**
 * Ergue (ou faz crescer) o cone: devolve as mudanças de relevo de `from` (cone, altura) para o cone
 * atual do vulcão, e marca a rocha no chão (cratera 255; cone 254 na borda até 1 no pé).
 */
export function growCone(world: WorldState, ground: Ground, v: Volcano, from: { cone: number; top: number } | null): { cells: number[]; deltas: number[] } {
  const { cells, dist } = coneCells(world, v);
  const outCells: number[] = [];
  const deltas: number[] = [];
  const crater = craterRadius(v.cone);
  cells.forEach((c, k) => {
    const d = dist[k] as number;
    const delta = coneProfile(v.cone, v.top, d) - (from ? coneProfile(from.cone, from.top, d) : 0);
    if (Math.abs(delta) > 0.5) {
      outCells.push(c);
      deltas.push(delta);
    }
    const rock = d < crater ? 255 : Math.max(1, Math.round(254 * (1 - (d - crater) / Math.max(0.5, v.cone + 0.6 - crater))));
    ground.setRock(c, Math.max(ground.rock[c] as number, rock));
  });
  return { cells: outCells, deltas };
}

/** Tamanho de um vulcão novo: grande debaixo de continente, pequeno no oceano (ilhas crescem). */
export function sampleCone(world: WorldState, cell: number, kind: VolcanoKind, rng: Rng): number {
  if (kind === 'player') return 3;
  const continental = world.crust[cell] === Crust.Continental;
  const u = rng.next();
  if (continental) return u < 0.6 ? rng.int(4, 5) : u < 0.9 ? 3 : rng.int(1, 2);
  return u < 0.7 ? rng.int(1, 2) : 3;
}

/** Quando o vulcão acorda de novo (passo), pela frequência (0 = nunca). */
export function nextWake(v: Volcano, tick: number, factor: number, rng: Rng): number {
  if (factor <= 0 || v.extinct) return Number.MAX_SAFE_INTEGER;
  const [lo, hi] = DORMANT_YEARS[v.kind];
  return tick + Math.round((rng.range(lo, hi) / factor) * TICKS_PER_YEAR);
}

/**
 * Lava de uma erupção, andando passo a passo: sai pela borda mais baixa da cratera, desce o cone por um
 * canal (sempre a vizinha mais baixa) e, fora do cone, vai enchendo o terreno pelo mais baixo (com um
 * pouco de ruído fixo), alargando onde é plano e sem subir mais que um pouco. Uma a duas células por
 * passo. No mar, a célula vira terra nova (basalto) e a lava não passa dali.
 */
export class LavaProcess {
  private channel: number[] = [];
  private front: number[] = [];
  private seen = new Set<number>();
  private placed = 0;
  /** Células de mar que viraram terra (relevo a mudar no fim). */
  private newLand: number[] = [];

  constructor(
    private world: WorldState,
    private ground: Ground,
    private rng: Rng,
    volcano: Volcano,
    private budget: number,
    /** A lava encostou numa célula com vegetação: pode acender fogo ali. */
    private onBurn: (cell: number) => void,
    /** Terminou: mudanças de relevo (terra nova no mar). */
    private onEnd: (cells: number[], deltas: number[]) => void,
  ) {
    const { neighbors } = world.grid;
    const { cells } = coneCells(world, volcano);
    const cone = new Set(cells);
    const crater = cells.filter((c) => ground.rock[c] === 255);
    for (const c of crater) this.seen.add(c);
    // Borda mais baixa da cratera.
    let lo = -1;
    for (const c of crater) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (this.seen.has(j)) continue;
        if (lo < 0 || (world.elevation[j] as number) < (world.elevation[lo] as number)) lo = j;
      }
    }
    // Canal: desce o cone pela vizinha mais baixa.
    let ch = lo;
    while (ch >= 0 && cone.has(ch) && !this.seen.has(ch)) {
      this.seen.add(ch);
      this.channel.push(ch);
      let next = -1;
      for (let d = 0; d < 4; d++) {
        const j = neighbors[ch * 4 + d] as number;
        if (this.seen.has(j)) continue;
        if (next < 0 || (world.elevation[j] as number) < (world.elevation[next] as number)) next = j;
      }
      ch = next;
    }
    for (const c of cells) this.seen.add(c);
    if (ch >= 0) {
      this.seen.add(ch);
      this.front.push(ch);
    }
  }

  private lay(c: number, tick: number): void {
    const world = this.world;
    this.placed++;
    if (world.isWater(c)) {
      // Lava no mar endurece: terra nova de basalto.
      this.newLand.push(c);
      this.ground.setState(c, CellState.Basalt, tick, 100 + 200 * cellHash(c, 0x1a), TICKS_PER_YEAR);
      return;
    }
    this.ground.damage(c, 1);
    this.ground.setState(c, CellState.Lava, tick, this.rng.range(LAVA_YEARS[0], LAVA_YEARS[1]), TICKS_PER_YEAR);
    const { neighbors } = world.grid;
    for (let d = 0; d < 4; d++) {
      const j = neighbors[c * 4 + d] as number;
      if (!this.seen.has(j) && hasVegetation(world.biome[j] as number) && !world.isWater(j)) this.onBurn(j);
    }
  }

  step(tick: number): boolean {
    const world = this.world;
    const { neighbors } = world.grid;
    // Primeiro o canal no cone, uma célula por passo.
    if (this.channel.length) {
      this.lay(this.channel.shift() as number, tick);
      return true;
    }
    // Depois o terreno: as mais baixas primeiro (ruído fixo para não andar em linha reta).
    const height = (x: number): number => (world.elevation[x] as number) + 70 * patchNoise(world, x, 2) + 40 * cellHash(x, 0x3c);
    for (let k = 0; k < 2 && this.front.length && this.placed < this.budget; k++) {
      let best = 0;
      for (let i = 1; i < this.front.length; i++) if (height(this.front[i] as number) < height(this.front[best] as number)) best = i;
      const c = this.front.splice(best, 1)[0] as number;
      this.lay(c, tick);
      if (world.isWater(c)) continue;
      const h = world.elevation[c] as number;
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (this.seen.has(j) || this.ground.rock[j]) continue;
        const hj = world.elevation[j] as number;
        // Não sobe mais que um pouco acima de onde veio.
        if (hj > h + 150) continue;
        this.seen.add(j);
        this.front.push(j);
      }
    }
    if (this.front.length && this.placed < this.budget) return true;
    // Terra nova no mar: sobe até 5 m acima do mar.
    const deltas = this.newLand.map((c) => world.seaLevel + 5 - (world.elevation[c] as number));
    this.onEnd(this.newLand, deltas);
    return false;
  }
}

/** Cinzas da erupção forte: uma pluma a favor do vento, célula a célula. Devolve as células. */
export function ashPlume(world: WorldState, ground: Ground, v: Volcano, vei: number, tick: number, rng: Rng): number[] {
  if (vei < ASH_VEI) return [];
  const p = world.grid.positions;
  const w = windAt(world, v.cell);
  const length = 4 + 4 * (vei - 3);
  const width = 1.5 + 0.5 * (vei - 3);
  const cx = p[v.cell * 3] as number;
  const cy = p[v.cell * 3 + 1] as number;
  const cz = p[v.cell * 3 + 2] as number;
  const ang = world.grid.cellAngle;
  const out: number[] = [];
  for (const c of world.grid.cellsInCap(cx, cy, cz, (length + width) * ang)) {
    const dx = (p[c * 3] as number) - cx;
    const dy = (p[c * 3 + 1] as number) - cy;
    const dz = (p[c * 3 + 2] as number) - cz;
    const along = (dx * w[0] + dy * w[1] + dz * w[2]) / ang;
    const total = Math.hypot(dx, dy, dz) / ang;
    const side = Math.sqrt(Math.max(0, total * total - along * along));
    if (along < -1 || along > length) continue;
    // Pluma que abre com a distância, de borda recortada.
    const lim = width * (0.6 + 0.6 * Math.max(0, along) / length) * (0.75 + 0.5 * patchNoise(world, c, 3));
    if (side > lim) continue;
    if (world.isWater(c) || world.ice[c] || ground.rock[c]) continue;
    if (hasVegetation(world.biome[c] as number)) ground.damage(c, rng.range(0.2, 0.4));
    ground.setState(c, CellState.Ash, tick, ASH_YEARS, TICKS_PER_YEAR);
    out.push(c);
  }
  return out;
}
