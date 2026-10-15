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
  if (h <= 0 && !world.ice[i]) k = 1.12 - 0.42 * Math.min(1, -h / 5000);
  else k = (world.ice[i] ? 0.94 : 0.88) + 0.2 * Math.min(1, Math.max(0, h) / 6000);
  if (h > 0) k *= hillshade(world, i);
  const o = i * 4;
  out[o] = Math.min(255, info.color[0] * k);
  out[o + 1] = Math.min(255, info.color[1] * k);
  out[o + 2] = Math.min(255, info.color[2] * k);
  out[o + 3] = world.biome[i] as number;
}

/** Força máxima do sombreado de relevo (±35% de brilho). */
const SHADE_STRENGTH = 0.35;
/** Inclinação (metros de subida por célula) que dá ~76% da força máxima do sombreado. */
const SHADE_SLOPE = 400;

/**
 * Sombreado de relevo (só visual): encostas viradas para o noroeste (de onde vem a luz) ficam mais
 * claras, as viradas para o sudeste mais escuras. A inclinação é medida em metros por célula, com
 * os 4 vizinhos em 3D, então não tem emenda entre as faces do cubo. Terra plana = 1.
 */
export function hillshade(world: WorldState, i: number): number {
  const { positions, neighbors, cellAngle } = world.grid;
  const px = positions[i * 3] as number;
  const py = positions[i * 3 + 1] as number;
  const pz = positions[i * 3 + 2] as number;
  const hi = Math.max(0, world.heightAboveSea(i));
  // Gradiente (direção de subida) em metros por célula, no plano tangente.
  // Com 4 vizinhos em 2 eixos, cada eixo entra duas vezes: daí a média (× 0,5).
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[i * 4 + d] as number;
    const dx = (positions[j * 3] as number) - px;
    const dy = (positions[j * 3 + 1] as number) - py;
    const dz = (positions[j * 3 + 2] as number) - pz;
    const len = Math.hypot(dx, dy, dz);
    const dh = Math.max(0, world.heightAboveSea(j)) - hi;
    // dh / (distância em células), na direção unitária do vizinho.
    const s = (0.5 * dh * cellAngle) / (len * len);
    gx += dx * s;
    gy += dy * s;
    gz += dz * s;
  }
  // Direção noroeste no plano tangente.
  let ex = pz;
  let ez = -px;
  const elen = Math.hypot(ex, ez) || 1;
  ex /= elen;
  ez /= elen;
  const nx = py * ez;
  const ny = pz * ex - px * ez;
  const nz = -py * ex;
  const lx = (nx - ex) * Math.SQRT1_2;
  const ly = ny * Math.SQRT1_2;
  const lz = (nz - ez) * Math.SQRT1_2;
  // Terreno que sobe rumo à luz tem a encosta virada para longe dela: mais escuro.
  const upTowardLight = gx * lx + gy * ly + gz * lz;
  return 1 - SHADE_STRENGTH * Math.tanh(upTowardLight / SHADE_SLOPE);
}

/** Preenche as cores do mundo todo (ou só das células listadas). */
export function buildColors(world: WorldState, out: Uint8Array, cells?: readonly number[]): void {
  if (cells) for (const c of cells) writeCellColor(world, c, out);
  else for (let i = 0; i < world.cellCount; i++) writeCellColor(world, i, out);
}
