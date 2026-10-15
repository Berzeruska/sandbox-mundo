import { SHADOW_REACH, updateClimate, updateWaterDistance } from '../world/climate';
import type { Vec3 } from '../world/cubesphere';
import { MAX_DEPTH } from '../world/generation';
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
/** Profundidade de um corpo d'água pintado (metros abaixo do nível do mar). */
export const PAINTED_WATER_DEPTH = 40;
export const MIN_ELEVATION = -MAX_DEPTH - 1000;
export const MAX_ELEVATION = 9000;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 30;

export interface BrushResult {
  /** Células cujo clima, bioma e cor foram recalculados. */
  region: number[];
}

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

  for (const c of cells) {
    const wasWater = world.isWater(c);
    if (tool === Tool.Raise || tool === Tool.Lower) {
      const dot =
        (positions[c * 3] as number) * center[0] +
        (positions[c * 3 + 1] as number) * center[1] +
        (positions[c * 3 + 2] as number) * center[2];
      const t = Math.acos(Math.min(1, dot)) / radius;
      const falloff = (1 - t * t) ** 2;
      const delta = RAISE_RATE * dt * falloff * (tool === Tool.Raise ? 1 : -1);
      world.elevation[c] = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, (world.elevation[c] as number) + delta));
      changedTerrain = true;
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
    return { region };
  }

  // Terreno muda temperatura (altitude), umidade (distância até a água) e sombra de chuva a favor do vento.
  const margin = SHADOW_REACH + 2 * grid.cellAngle;
  const region = grid.cellsInCap(center[0], center[1], center[2], radius + margin);
  if (crossedSea) updateWaterDistance(world, region);
  updateClimate(world, region);
  return { region };
}
