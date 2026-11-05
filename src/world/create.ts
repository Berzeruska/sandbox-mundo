import { computeWaterDistance, updateClimate } from './climate';
import type { CellPool } from './cell-pool';
import type { CubeSphere } from './cubesphere';
import { generateTerrain } from './generation';
import { generatePlates } from './plates';
import { generateDeposits } from './resources';
import { WorldState, type WorldParams } from './state';

/** Etapas da criação do mundo, na ordem (para medir tempo e mostrar progresso). */
export const WORLD_STAGES = ['terreno', 'placas', 'água', 'clima', 'recursos'] as const;
export type WorldStage = (typeof WORLD_STAGES)[number];

/**
 * Cria um planeta completo: terreno, distância até a água, clima, biomas e jazidas minerais.
 * `onStage` é avisado durante as etapas (etapa e fração dela): só medição e progresso, não muda
 * o resultado.
 */
export function createWorld(
  params: WorldParams,
  grid?: CubeSphere,
  onStage?: (stage: WorldStage, fraction: number) => void,
  /** Outro worker para dividir o trabalho por célula (mesmo resultado, mais rápido). */
  pool?: CellPool,
): WorldState {
  const world = new WorldState(params, grid);
  onStage?.('terreno', 0);
  generateTerrain(world, onStage && ((f) => onStage('terreno', f)), pool);
  onStage?.('placas', 0);
  generatePlates(world);
  onStage?.('água', 0);
  computeWaterDistance(world);
  onStage?.('clima', 0);
  updateClimate(world);
  onStage?.('recursos', 0);
  generateDeposits(world);
  return world;
}
