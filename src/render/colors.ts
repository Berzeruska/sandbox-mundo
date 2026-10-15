import { BIOME_INFO } from '../world/biomes';
import type { WorldState } from '../world/state';

/**
 * Cor de cada célula: a cor do bioma, um pouco mais clara nas terras altas e mais escura no oceano
 * profundo. O canal alfa leva o código do bioma, que o shader usa para a textura de detalhe.
 * (Não há mais variação de brilho por célula: ela desenhava a grade na tela — ver T13.)
 */
export function writeCellColor(world: WorldState, i: number, out: Uint8Array): void {
  const info = BIOME_INFO[world.biome[i] as number];
  if (!info) throw new Error(`Bioma inválido na célula ${i}`);
  const h = world.heightAboveSea(i);
  let k: number;
  if (world.ice[i]) k = 1;
  else if (h <= 0) k = 1.12 - 0.42 * Math.min(1, -h / 5000);
  else k = 0.88 + 0.24 * Math.min(1, h / 2500);
  const o = i * 4;
  out[o] = Math.min(255, info.color[0] * k);
  out[o + 1] = Math.min(255, info.color[1] * k);
  out[o + 2] = Math.min(255, info.color[2] * k);
  out[o + 3] = world.biome[i] as number;
}

/** Preenche as cores do mundo todo (ou só das células listadas). */
export function buildColors(world: WorldState, out: Uint8Array, cells?: readonly number[]): void {
  if (cells) for (const c of cells) writeCellColor(world, c, out);
  else for (let i = 0; i < world.cellCount; i++) writeCellColor(world, i, out);
}
