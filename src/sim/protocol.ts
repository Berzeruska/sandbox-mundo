import type { Speed } from '../core/time';
import type { Tool } from '../input/tools';
import type { Layers } from '../render/colors';
import { packRect } from '../render/dirty';
import type { DirtyRect } from '../render/globe-renderer';
import type { Vec3 } from '../world/cubesphere';

/**
 * Mensagens entre a thread principal (câmera, entrada, interface, desenho) e o Web Worker da
 * simulação (mundo, relógio, geração, clima, pincéis). Os buffers de cor vão "transferidos"
 * (sem cópia).
 */

/** Retângulo de cores alterado de uma face, já empacotado linha após linha. */
export interface Patch extends DirtyRect {
  data: Uint8Array;
}

export interface WorldInfo {
  n: number;
  cellCount: number;
  seedText: string;
  seed: number;
  /** Tempo do worker para gerar (ms), por etapa e total. */
  generationMs: number;
  stagesMs: Record<string, number>;
  /** Direção média da terra firme (para onde a câmera olha ao nascer o mundo). */
  landCenter: Vec3;
}

export type ToWorker =
  | { type: 'newWorld'; seedText: string; n: number }
  | { type: 'brush'; tool: Tool; point: Vec3; radius: number; dt: number }
  | { type: 'speed'; speed: Speed }
  | { type: 'layers'; layers: Layers }
  | { type: 'plateRate'; rate: number }
  | { type: 'query'; id: number; point: Vec3 };

export interface CellQuery {
  elevation: number;
  biome: number;
  water: boolean;
  ice: boolean;
}

export type FromWorker =
  | { type: 'world'; info: WorldInfo; colors: Uint8Array }
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'patch'; patches: Patch[]; brushMs: number }
  | { type: 'clock'; tick: number; speed: Speed; ticksPerSecond: number; geologyMs: number; recompositions: number; memoryMb: number }
  | { type: 'query'; id: number; cell: CellQuery };

/** Empacota os retângulos alterados (cada um no seu próprio buffer, para transferir). */
export function makePatches(colors: Uint8Array, n: number, rects: readonly DirtyRect[]): Patch[] {
  return rects.map((r) => ({ ...r, data: packRect(colors, n, r) }));
}

/** Aplica um remendo na cópia das cores da thread principal. */
export function applyPatch(colors: Uint8Array, n: number, p: Patch): void {
  const w = p.x1 - p.x0 + 1;
  const h = p.y1 - p.y0 + 1;
  const faceStart = p.face * n * n;
  for (let row = 0; row < h; row++) {
    const dst = (faceStart + (p.y0 + row) * n + p.x0) * 4;
    colors.set(p.data.subarray(row * w * 4, (row + 1) * w * 4), dst);
  }
}

/** Buffers de uma mensagem que podem ser transferidos em vez de copiados. */
export function transferables(msg: FromWorker): ArrayBuffer[] {
  if (msg.type === 'world') return [msg.colors.buffer as ArrayBuffer];
  if (msg.type === 'patch') return msg.patches.map((p) => p.data.buffer as ArrayBuffer);
  return [];
}
