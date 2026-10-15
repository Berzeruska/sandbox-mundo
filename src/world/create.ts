import { computeWaterDistance, updateClimate } from './climate';
import type { CubeSphere } from './cubesphere';
import { generateTerrain } from './generation';
import { WorldState, type WorldParams } from './state';

/** Etapas da criação do mundo, na ordem (para medir tempo e mostrar progresso). */
export const WORLD_STAGES = ['terreno', 'água', 'clima'] as const;
export type WorldStage = (typeof WORLD_STAGES)[number];

/**
 * Cria um planeta completo: terreno, distância até a água, clima e biomas.
 * `onStage` é avisado durante as etapas (etapa e fração dela): só medição e progresso, não muda
 * o resultado.
 */
export function createWorld(
  params: WorldParams,
  grid?: CubeSphere,
  onStage?: (stage: WorldStage, fraction: number) => void,
): WorldState {
  const world = new WorldState(params, grid);
  onStage?.('terreno', 0);
  generateTerrain(world, onStage && ((f) => onStage('terreno', f)));
  onStage?.('água', 0);
  computeWaterDistance(world);
  onStage?.('clima', 0);
  updateClimate(world);
  return world;
}
