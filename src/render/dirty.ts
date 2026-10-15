import type { CubeSphere } from '../world/cubesphere';
import type { DirtyRect } from './globe-renderer';

/** Menor retângulo por face que contém as células alteradas. */
export function dirtyRects(grid: CubeSphere, cells: readonly number[]): DirtyRect[] {
  const rects = new Map<number, DirtyRect>();
  for (const c of cells) {
    const face = grid.faceOf(c);
    const x = grid.xOf(c);
    const y = grid.yOf(c);
    const r = rects.get(face);
    if (!r) {
      rects.set(face, { face, x0: x, y0: y, x1: x, y1: y });
    } else {
      if (x < r.x0) r.x0 = x;
      if (x > r.x1) r.x1 = x;
      if (y < r.y0) r.y0 = y;
      if (y > r.y1) r.y1 = y;
    }
  }
  return [...rects.values()];
}

/**
 * Copia o retângulo de uma face para um bloco contínuo (linha após linha), pronto para enviar à GPU
 * sem parâmetros de "pular" (UNPACK_SKIP_*), que alguns drivers de celular tratam errado.
 */
export function packRect(colors: Uint8Array, n: number, r: DirtyRect, out?: Uint8Array): Uint8Array {
  const w = r.x1 - r.x0 + 1;
  const h = r.y1 - r.y0 + 1;
  const size = w * h * 4;
  const buf = out && out.length >= size ? out.subarray(0, size) : new Uint8Array(size);
  const faceStart = r.face * n * n;
  for (let row = 0; row < h; row++) {
    const src = (faceStart + (r.y0 + row) * n + r.x0) * 4;
    buf.set(colors.subarray(src, src + w * 4), row * w * 4);
  }
  return buf;
}
