import type { Speed } from '../core/time';
import type { Tool } from '../input/tools';
import type { Layers } from '../render/colors';
import { packRect } from '../render/dirty';
import type { DirtyRect } from '../render/globe-renderer';
import type { Vec3 } from '../world/cubesphere';
import type { WorkCounters } from '../ui/benchmark';

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
  /** Eixo, velocidade relativa e centro inicial de cada placa (para o desenho suave do movimento). */
  plates: PlateMotionInfo[];
}

/**
 * Movimento de uma placa a partir de uma composição: gira em torno de `axis` com a velocidade
 * relativa `speed`; `center` é o centro dela naquela composição. Muda numa solda (D3).
 */
export interface PlateMotionInfo {
  axis: Vec3;
  speed: number;
  center: Vec3;
}

export type ToWorker =
  | { type: 'newWorld'; seedText: string; n: number }
  | { type: 'brush'; tool: Tool; point: Vec3; radius: number; dt: number }
  | { type: 'speed'; speed: Speed }
  | { type: 'layers'; layers: Layers }
  | { type: 'plateRate'; rate: number }
  /** "Medir desempenho": racha agora o maior bloco soldado (ciclo de Wilson, G2). */
  | { type: 'forceRupture' }
  | { type: 'query'; id: number; point: Vec3 }
  /** Teste de memória compartilhada (correção 2): o worker escreve SHARED_PROBE_VALUE no buffer. */
  | { type: 'sharedProbe'; buffer: SharedArrayBuffer };

/** Valor que o worker grava no teste de memória compartilhada. */
export const SHARED_PROBE_VALUE = 42;

/**
 * Resultado do teste de memória compartilhada, em texto para o painel Dados e o relatório.
 * `isolated`: a página está isolada entre origens (crossOriginIsolated); `available`: existe
 * SharedArrayBuffer; `probe`: o que o worker escreveu foi lido aqui (null = ainda testando).
 */
export function sharedMemoryLabel(isolated: boolean, available: boolean, probe: boolean | null): string {
  if (!isolated) return 'não (página sem isolamento)';
  if (!available) return 'não (navegador sem SharedArrayBuffer)';
  if (probe === null) return 'testando…';
  return probe ? 'sim' : 'não (o simulador não escreveu)';
}

export interface CellQuery {
  elevation: number;
  biome: number;
  water: boolean;
  ice: boolean;
}

export type FromWorker =
  /** Primeira mensagem do worker: a versão dele (a tela confere com a própria). */
  | { type: 'hello'; version: string }
  /** Erro dentro do worker (em vez de travar em silêncio). */
  | { type: 'error'; message: string; stack?: string }
  | { type: 'world'; info: WorldInfo; colors: Uint8Array; plateCells: Uint8Array }
  /** As placas andaram: mundo todo repintado, placa de cada célula e ângulos desta composição. */
  | { type: 'recomposed'; patches: Patch[]; plateCells: Uint8Array; angles: number[]; plates: PlateMotionInfo[] }
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'patch'; patches: Patch[]; brushMs: number }
  | { type: 'clock'; tick: number; speed: Speed; ticksPerSecond: number; geologyMs: number; memoryMb: number; angles: number[]; work: WorkCounters }
  | { type: 'query'; id: number; cell: CellQuery }
  | { type: 'sharedProbe'; ok: boolean };

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
  if (msg.type === 'world') return [msg.colors.buffer as ArrayBuffer, msg.plateCells.buffer as ArrayBuffer];
  if (msg.type === 'patch') return msg.patches.map((p) => p.data.buffer as ArrayBuffer);
  if (msg.type === 'recomposed') {
    return [...msg.patches.map((p) => p.data.buffer as ArrayBuffer), msg.plateCells.buffer as ArrayBuffer];
  }
  return [];
}
