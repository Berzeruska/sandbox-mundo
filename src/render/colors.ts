import { newArray } from '../core/shared';
import { BIOME_INFO } from '../world/biomes';
import type { CubeSphere } from '../world/cubesphere';
import type { WorldState } from '../world/state';

/**
 * Cor de cada célula: a cor do bioma, um pouco mais clara nas terras altas e mais escura no oceano
 * profundo. O canal alfa leva o código do bioma, que o shader usa para a textura de detalhe.
 * (Não há mais variação de brilho por célula: ela desenhava a grade na tela — ver T13.)
 */
/** Camadas opcionais desenhadas por cima dos biomas (escolhidas no menu). */
export interface Layers {
  plates: boolean;
}

export const NO_LAYERS: Layers = { plates: false };

/** Cores das fronteiras de placa na camada "Ver placas", por tipo (`Boundary`). */
export const BOUNDARY_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // sem fronteira (não usado)
  [235, 64, 52], // convergente
  [64, 150, 255], // divergente
  [250, 205, 60], // transformante
];
/** Quanto a cor da placa tinge o bioma na camada "Ver placas". */
const PLATE_TINT = 0.38;

export function writeCellColor(world: WorldState, i: number, out: Uint8Array, layers: Layers = NO_LAYERS): void {
  const info = BIOME_INFO[world.biome[i] as number];
  if (!info) throw new Error(`Bioma inválido na célula ${i}`);
  const h = world.heightAboveSea(i);
  let k: number;
  if (h <= 0 && !world.ice[i]) k = 1.12 - 0.42 * Math.min(1, -h / 5000);
  else k = (world.ice[i] ? 0.94 : 0.88) + 0.2 * Math.min(1, Math.max(0, h) / 6000);
  if (h > 0) k *= hillshade(world, i);
  let r = Math.min(255, info.color[0] * k);
  let g = Math.min(255, info.color[1] * k);
  let b = Math.min(255, info.color[2] * k);
  if (layers.plates) {
    const kind = world.boundary[i] as number;
    const tint = kind ? BOUNDARY_COLORS[kind] : world.plates[world.plate[i] as number]?.color;
    const t = kind ? 1 : PLATE_TINT;
    if (tint) {
      r += (tint[0] - r) * t;
      g += (tint[1] - g) * t;
      b += (tint[2] - b) * t;
    }
  }
  const o = i * 4;
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = world.biome[i] as number;
}

/** Força máxima do sombreado de relevo (±35% de brilho). */
const SHADE_STRENGTH = 0.35;
/** Inclinação (metros de subida por célula) que dá ~76% da força máxima do sombreado. */
const SHADE_SLOPE = 400;

/** Pesos fixos do sombreado por grade: 4 por célula (um por vizinho). */
const shadeWeights = new WeakMap<CubeSphere, Float32Array>();

/** Bytes da tabela de sombreado guardada para esta grade, para o painel Dados. */
export function colorCacheBytes(grid: CubeSphere): number {
  return shadeWeights.get(grid)?.byteLength ?? 0;
}

/**
 * Para cada célula e vizinho: quanto 1 metro de subida rumo àquele vizinho conta como "subir em
 * direção à luz" (noroeste), em metros por célula. Só depende da geometria da grade, então é
 * calculado uma vez e o sombreado vira 4 multiplicações por célula.
 */
export function shadeWeightsFor(grid: CubeSphere): Float32Array {
  const cached = shadeWeights.get(grid);
  if (cached) return cached;
  const { positions, neighbors, cellAngle } = grid;
  const w = newArray(Float32Array, grid.cellCount * 4);
  for (let i = 0; i < grid.cellCount; i++) {
    const px = positions[i * 3] as number;
    const py = positions[i * 3 + 1] as number;
    const pz = positions[i * 3 + 2] as number;
    // Direção noroeste no plano tangente.
    let ex = pz;
    let ez = -px;
    const elen = Math.hypot(ex, ez) || 1;
    ex /= elen;
    ez /= elen;
    const lx = (py * ez - ex) * Math.SQRT1_2;
    const ly = (pz * ex - px * ez) * Math.SQRT1_2;
    const lz = (-py * ex - ez) * Math.SQRT1_2;
    for (let d = 0; d < 4; d++) {
      const j = neighbors[i * 4 + d] as number;
      const dx = (positions[j * 3] as number) - px;
      const dy = (positions[j * 3 + 1] as number) - py;
      const dz = (positions[j * 3 + 2] as number) - pz;
      const len2 = dx * dx + dy * dy + dz * dz;
      // Gradiente por diferenças: cada eixo entra duas vezes (4 vizinhos), daí o 0,5.
      w[i * 4 + d] = (0.5 * cellAngle * (dx * lx + dy * ly + dz * lz)) / len2;
    }
  }
  shadeWeights.set(grid, w);
  return w;
}

/** Usa a tabela de sombreado de outro ajudante (memória compartilhada) para esta grade. */
export function adoptShadeWeights(grid: CubeSphere, weights: Float32Array): void {
  if (weights.length !== grid.cellCount * 4) throw new Error('Tabela de sombreado com tamanho diferente');
  shadeWeights.set(grid, weights);
}

/**
 * Sombreado de relevo (só visual): encostas viradas para o noroeste (de onde vem a luz) ficam mais
 * claras, as viradas para o sudeste mais escuras. A inclinação é medida em metros por célula, com
 * os 4 vizinhos em 3D, então não tem emenda entre as faces do cubo. Terra plana = 1.
 */
export function hillshade(world: WorldState, i: number): number {
  const weights = shadeWeightsFor(world.grid);
  const { neighbors } = world.grid;
  const hi = Math.max(0, world.heightAboveSea(i));
  let upTowardLight = 0;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[i * 4 + d] as number;
    upTowardLight += (Math.max(0, world.heightAboveSea(j)) - hi) * (weights[i * 4 + d] as number);
  }
  // Terreno que sobe rumo à luz tem a encosta virada para longe dela: mais escuro.
  return 1 - SHADE_STRENGTH * Math.tanh(upTowardLight / SHADE_SLOPE);
}

/** Preenche as cores do mundo todo (ou só das células listadas). */
export function buildColors(world: WorldState, out: Uint8Array, cells?: readonly number[], layers: Layers = NO_LAYERS): void {
  if (cells) for (const c of cells) writeCellColor(world, c, out, layers);
  else for (let i = 0; i < world.cellCount; i++) writeCellColor(world, i, out, layers);
}
