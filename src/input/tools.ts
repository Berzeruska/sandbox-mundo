import { SHADOW_REACH, updateClimate, updateWaterDistance } from '../world/climate';
import type { Vec3 } from '../world/cubesphere';
import { MAX_DEPTH } from '../world/generation';
import { isHiddenOil, REVEALED_BIT } from '../world/resources';
import { IceMode, type WorldState } from '../world/state';

export const Tool = {
  Raise: 0,
  Lower: 1,
  Water: 2,
  Ice: 3,
  EraseIce: 4,
} as const;
export type Tool = (typeof Tool)[keyof typeof Tool];

export const TOOL_INFO: readonly { tool: Tool; label: string; icon: string }[] = [
  { tool: Tool.Raise, label: 'Elevar', icon: '⛰️' },
  { tool: Tool.Lower, label: 'Rebaixar', icon: '⛏️' },
  { tool: Tool.Water, label: 'Água', icon: '💧' },
  { tool: Tool.Ice, label: 'Gelo', icon: '❄️' },
  { tool: Tool.EraseIce, label: 'Derreter', icon: '🔥' },
];

/** Velocidade de elevar/rebaixar no centro do pincel (metros por segundo segurando). */
export const RAISE_RATE = 2200;
/** Nos últimos metros antes do teto (ou do fundo), o pincel desacelera em vez de chapar. */
export const SOFT_LIMIT_RANGE = 6000;
/** Profundidade de um corpo d'água pintado (metros abaixo do nível do mar). */
export const PAINTED_WATER_DEPTH = 40;
export const MIN_ELEVATION = -MAX_DEPTH - 1000;
export const MAX_ELEVATION = 9000;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 30;

/**
 * Força do pincel pela distância ao centro (t = 0 no centro, 1 na borda): 1 no centro, 0 na borda,
 * com chegada suave nas duas pontas. Forma de sino: o resultado é um morro, não uma mesa.
 */
export function brushFalloff(t: number): number {
  if (t >= 1) return 0;
  const k = 1 - t * t;
  return k * k * k;
}

/**
 * Multiplicador com sinal (+ sobe, − desce) que vai a zero perto do teto/fundo, para o pincel
 * desacelerar em vez de chapar o topo num platô.
 */
export function softLimit(elevation: number, direction: 1 | -1): number {
  const room = direction > 0 ? MAX_ELEVATION - elevation : elevation - MIN_ELEVATION;
  return direction * Math.min(1, Math.max(0, room / SOFT_LIMIT_RANGE));
}

export interface BrushResult {
  /** Células cujo clima, bioma e cor foram recalculados. */
  region: number[];
  /** Células em que o Rebaixar revelou petróleo escondido (T6). */
  revealed: number[];
}

/** Parte do pincel (fração do raio) em que o Rebaixar cava o bastante para achar petróleo. */
export const REVEAL_REACH = 0.7;

/**
 * Aplica um pincel centrado no ponto (unitário) da esfera, com raio em células.
 * `dt` é o tempo segurando desde a última aplicação (para elevar/rebaixar contínuo).
 * Recalcula clima e bioma só da área afetada mais uma borda.
 */
export function applyBrush(world: WorldState, tool: Tool, center: Vec3, radiusCells: number, dt: number): BrushResult {
  const grid = world.grid;
  const radius = Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, radiusCells)) * grid.cellAngle;
  const cells = grid.cellsInCap(center[0], center[1], center[2], radius);
  const { positions } = grid;
  let crossedSea = false;
  let changedTerrain = false;
  const revealed: number[] = [];

  for (const c of cells) {
    const wasWater = world.isWater(c);
    if (tool === Tool.Raise || tool === Tool.Lower) {
      const dot =
        (positions[c * 3] as number) * center[0] +
        (positions[c * 3 + 1] as number) * center[1] +
        (positions[c * 3 + 2] as number) * center[2];
      const t = Math.acos(Math.min(1, dot)) / radius;
      const e = world.elevation[c] as number;
      const delta = RAISE_RATE * dt * brushFalloff(t) * softLimit(e, tool === Tool.Raise ? 1 : -1);
      world.elevation[c] = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, e + delta));
      changedTerrain = true;
      // Cavar em cima de petróleo escondido o revela (fica revelado para sempre).
      if (tool === Tool.Lower && t < REVEAL_REACH && isHiddenOil(world.deposit[c] as number)) {
        world.deposit[c] = (world.deposit[c] as number) | REVEALED_BIT;
        revealed.push(c);
      }
    } else if (tool === Tool.Water) {
      world.elevation[c] = Math.min(world.elevation[c] as number, world.seaLevel - PAINTED_WATER_DEPTH);
      changedTerrain = true;
    } else {
      world.iceMode[c] = tool === Tool.Ice ? IceMode.Painted : IceMode.Erased;
    }
    if (world.isWater(c) !== wasWater) crossedSea = true;
  }

  if (!changedTerrain) {
    // Gelo não muda o clima: basta reclassificar o pincel e a vizinhança imediata (praias).
    const region = grid.cellsInCap(center[0], center[1], center[2], radius + 2 * grid.cellAngle);
    updateClimate(world, region);
    return { region, revealed };
  }

  // Terreno muda temperatura (altitude), umidade (distância até a água) e sombra de chuva a favor do vento.
  const margin = SHADOW_REACH + 2 * grid.cellAngle;
  const region = grid.cellsInCap(center[0], center[1], center[2], radius + margin);
  if (crossedSea) updateWaterDistance(world, region);
  updateClimate(world, region);
  return { region, revealed };
}

/** Vizinhança refeita em volta de cada célula numa mudança `local` (passos de célula). */
export const LOCAL_TERRAIN_STEPS = 2;

/**
 * Muda a altura de células soltas (desastres: deslizamento do terremoto, costa raspada pelo tsunami),
 * `deltas[k]` metros na célula `cells[k]`, e refaz o clima em volta, como o pincel.
 * `local`: mudança pequena espalhada (a costa raspada de um tsunami grande pega costas do mundo todo):
 * refaz o clima só a até LOCAL_TERRAIN_STEPS células de cada uma, e não a sombra de chuva a favor do
 * vento (alguns metros não mudam a sombra; a próxima recomposição refaz o clima inteiro). Sem isso, um
 * M 9,5 refazia o clima do planeta num passo (~430 ms, F3).
 */
export function applyTerrainDeltas(world: WorldState, cells: readonly number[], deltas: readonly number[], local = false): BrushResult {
  const grid = world.grid;
  const { positions } = grid;
  if (!cells.length) return { region: [], revealed: [] };
  let crossedSea = false;
  let x = 0;
  let y = 0;
  let z = 0;
  cells.forEach((c, k) => {
    const wasWater = world.isWater(c);
    const e = world.elevation[c] as number;
    world.elevation[c] = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, e + (deltas[k] as number)));
    if (world.isWater(c) !== wasWater) crossedSea = true;
    x += positions[c * 3] as number;
    y += positions[c * 3 + 1] as number;
    z += positions[c * 3 + 2] as number;
  });
  if (local) {
    const region = around(grid, cells, LOCAL_TERRAIN_STEPS);
    if (crossedSea) updateWaterDistance(world, region);
    updateClimate(world, region);
    return { region, revealed: [] };
  }
  const len = Math.hypot(x, y, z) || 1;
  const center: Vec3 = [x / len, y / len, z / len];
  let reach = 0;
  for (const c of cells) {
    const dot = (positions[c * 3] as number) * center[0] + (positions[c * 3 + 1] as number) * center[1] + (positions[c * 3 + 2] as number) * center[2];
    reach = Math.max(reach, Math.acos(Math.min(1, dot)));
  }
  const margin = SHADOW_REACH + 2 * grid.cellAngle;
  // Células espalhadas (longe umas das outras): a região é a soma das vizinhanças, não um círculo do
  // tamanho da distância entre elas (duas células de gelo em lados opostos do mundo refaziam o clima do
  // planeta inteiro, ~200 ms, F4).
  const region = reach <= 2 * margin ? grid.cellsInCap(center[0], center[1], center[2], reach + margin) : capsAround(grid, cells, margin);
  if (crossedSea) updateWaterDistance(world, region);
  updateClimate(world, region);
  return { region, revealed: [] };
}

/** As células e todas a até `steps` passos de alguma delas (sem repetir). */
function around(grid: WorldState['grid'], cells: readonly number[], steps: number): number[] {
  const seen = new Set(cells);
  let frontier = [...seen];
  for (let s = 0; s < steps; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = grid.neighbors[c * 4 + d] as number;
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
      }
    }
    frontier = next;
  }
  return [...seen];
}

/**
 * Todas as células a até `margin` (rad) de alguma das `cells`: círculos de raio 1,5 × `margin` em volta
 * de centros escolhidos de modo que cada célula fique a até meia margem de um deles.
 */
function capsAround(grid: WorldState['grid'], cells: readonly number[], margin: number): number[] {
  const { positions } = grid;
  const centers: number[] = [];
  const near = Math.cos(margin / 2);
  for (const c of cells) {
    const covered = centers.some((o) => (positions[c * 3] as number) * (positions[o * 3] as number) + (positions[c * 3 + 1] as number) * (positions[o * 3 + 1] as number) + (positions[c * 3 + 2] as number) * (positions[o * 3 + 2] as number) >= near);
    if (!covered) centers.push(c);
  }
  const out = new Set<number>();
  for (const o of centers) for (const c of grid.cellsInCap(positions[o * 3] as number, positions[o * 3 + 1] as number, positions[o * 3 + 2] as number, margin * 1.5)) out.add(c);
  return [...out];
}
