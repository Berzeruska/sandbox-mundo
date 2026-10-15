import { BIOME_INFO } from '../world/biomes';
import type { WorldState } from '../world/state';

/**
 * Cor RGBA de cada célula: a cor do bioma, um pouco mais clara nas terras altas e mais escura
 * no oceano profundo, para o relevo aparecer sem perder o visual de pixel.
 */
export function writeCellColor(world: WorldState, i: number, out: Uint8Array): void {
  const info = BIOME_INFO[world.biome[i] as number];
  if (!info) throw new Error(`Bioma inválido na célula ${i}`);
  const h = world.heightAboveSea(i);
  let k: number;
  if (world.ice[i]) k = 1;
  else if (h <= 0) k = 1.12 - 0.42 * Math.min(1, -h / 5000);
  else k = 0.88 + 0.24 * Math.min(1, h / 2500);
  // Leve variação fixa por célula: textura de pixel art e células visíveis de perto.
  k *= 0.95 + 0.1 * cellHash(i);
  const o = i * 4;
  out[o] = Math.min(255, info.color[0] * k);
  out[o + 1] = Math.min(255, info.color[1] * k);
  out[o + 2] = Math.min(255, info.color[2] * k);
  out[o + 3] = 255;
}

/** Valor fixo em [0, 1) por célula (hash inteiro; não é aleatoriedade da simulação). */
export function cellHash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Preenche as cores do mundo todo (ou só das células listadas). */
export function buildColors(world: WorldState, out: Uint8Array, cells?: readonly number[]): void {
  if (cells) for (const c of cells) writeCellColor(world, c, out);
  else for (let i = 0; i < world.cellCount; i++) writeCellColor(world, i, out);
}
