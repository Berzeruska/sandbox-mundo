import { describe, expect, it } from 'vitest';
import { chartChunk, chartPointToSphere, CHUNK_CELLS, coarseIndex, DETAIL, FACE_LINKS, fineToChart, finePoint, pointToFine, resolveFine } from '../../src/maquete/chart';
import { CubeSphere } from '../../src/world/cubesphere';

const n = 32, size = n * DETAIL;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('mapa plano em volta da face', () => {
  it('as faces são ligadas nos dois sentidos', () => {
    for (let f = 0; f < 6; f++) for (const l of FACE_LINKS[f]!) expect(FACE_LINKS[l.to]!.some((b) => b.to === f)).toBe(true);
  });
  it('a aresta é o mesmo ponto vista das duas faces', () => {
    for (let f = 0; f < 6; f++) for (let t = 2; t < size; t += 7) for (const [x, y] of [[size, t], [0, t], [t, size], [t, 0]] as const) {
      const on = finePoint(f, x, y, size);
      const over = resolveFine(f, x === size ? size + 1e-6 : x === 0 ? -1e-6 : x, y === size ? size + 1e-6 : y === 0 ? -1e-6 : y, size);
      expect(dist(on, finePoint(over.face, over.x, over.y, size))).toBeLessThan(1e-4);
    }
  });
  it('um passo além da aresta cai na célula vizinha de verdade', () => {
    const grid = new CubeSphere(n);
    for (let f = 0; f < 6; f++) for (let t = 0; t < n; t += 3) {
      expect(coarseIndex(n, f, n, t)).toBe(grid.neighbor(grid.index(f, n - 1, t), 0));
      expect(coarseIndex(n, f, -1, t)).toBe(grid.neighbor(grid.index(f, 0, t), 1));
      expect(coarseIndex(n, f, t, n)).toBe(grid.neighbor(grid.index(f, t, n - 1), 2));
      expect(coarseIndex(n, f, t, -1)).toBe(grid.neighbor(grid.index(f, t, 0), 3));
    }
  });
  it('o pedaço da vizinha cai encostado na aresta, no lugar certo', () => {
    for (let f = 0; f < 6; f++) for (const [pcx, pcz] of [[-1, 1], [size / CHUNK_CELLS, 1], [1, -1], [1, size / CHUNK_CELLS], [-2, 2]] as const) {
      const c = chartChunk(f, pcx, pcz, n);
      expect(c.face).not.toBe(f);
      // Centro do pedaço, em coordenadas da própria face (X, Z), levado ao plano pela regra do desenho.
      const X0 = (c.cx + 0.5) * CHUNK_CELLS, Z0 = (c.cz + 0.5) * CHUNK_CELLS;
      const [tx, tz, cos, sin] = c.place;
      const X = tx + cos * X0 + sin * Z0, Z = tz - sin * X0 + cos * Z0;
      expect(X).toBeCloseTo((pcx + 0.5) * CHUNK_CELLS, 6);
      expect(Z).toBeCloseTo((pcz + 0.5) * CHUNK_CELLS, 6);
      // E é o mesmo lugar do planeta.
      const a = chartPointToSphere(f, X, Z, size), b = finePoint(c.face, X0, size - Z0, size);
      expect(dist(a, b)).toBeLessThan(1e-3);
    }
  });
  it('ponto na esfera, face e plano voltam ao mesmo lugar', () => {
    for (const [f, x, y] of [[0, 10, 20], [2, 100, 3], [5, 64, 64], [3, 1, 127]] as const) {
      const p = finePoint(f, x, y, size), q = pointToFine(p, size);
      expect(q.face).toBe(f);
      expect(q.x).toBeCloseTo(x, 4);
      expect(q.y).toBeCloseTo(y, 4);
      const l = FACE_LINKS[f]![0]!, back = fineToChart(f, l.to, 7, 9, size)!;
      expect(dist(chartPointToSphere(f, back.X, back.Z, size), finePoint(l.to, 7, 9, size))).toBeLessThan(1e-3);
    }
  });
  it('quadrante do canto vira pedaço virtual, sem buraco', () => {
    expect(chartChunk(0, -1, -1, n).face).toBe(0);
    expect(resolveFine(0, -3, -5, size).fan).toBe(true);
  });
});
