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
