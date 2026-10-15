import { computeWaterDistance, updateClimate } from './climate';
import type { CubeSphere } from './cubesphere';
import { generateTerrain } from './generation';
import { WorldState, type WorldParams } from './state';

/** Cria um planeta completo: terreno, distância até a água, clima e biomas. */
export function createWorld(params: WorldParams, grid?: CubeSphere): WorldState {
  const world = new WorldState(params, grid);
  generateTerrain(world);
  computeWaterDistance(world);
  updateClimate(world);
  return world;
}
