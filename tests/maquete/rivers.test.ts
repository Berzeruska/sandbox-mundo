import { describe, expect, it } from 'vitest';
import { computeHydro, neighborTable, RIVER_FLOW } from '../../src/maquete/rivers';

function fixture(n: number): { height: Int16Array; rgba: Uint8Array; ice: Uint8Array; neighbors: Int32Array } {
  const count = 6 * n * n, height = new Int16Array(count), rgba = new Uint8Array(count * 4), ice = new Uint8Array(count);
  // Face 4 é um continente: um vale que desce até o mar numa das pontas, com uma bacia fechada; o resto é mar.
  for (let c = 0; c < count; c++) height[c] = -300;
  const f = 4;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const dx = x - n / 2, d = Math.abs(dx) + y;
    let h = 20 + Math.abs(dx) * 30 + y * 8;
    const basin = Math.hypot(x - n * 0.7, y - n * 0.6);
    if (basin < 3) h = Math.min(h, 40);
    height[f * n * n + y * n + x] = Math.round(h + (d % 2));
  }
  for (let c = 0; c < count; c++) rgba[c * 4 + 3] = 6;
  return { height, rgba, ice, neighbors: neighborTable(n) };
}

describe('rios e lagos', () => {
  const n = 32, w = fixture(n), hydro = computeHydro(n, w.height, w.rgba, w.ice, w.neighbors);
  it('toda célula de terra tem caminho até o mar, sem volta', () => {
    for (let c = 0; c < 6 * n * n; c++) {
      if (w.height[c]! <= 0) continue;
      let at = c, steps = 0;
      while (w.height[at]! > 0 && steps < 5000) { at = hydro.parent[at]!; steps++; expect(at).toBeGreaterThanOrEqual(0); }
      expect(w.height[at]!).toBeLessThanOrEqual(0);
    }
  });
  it('a água só desce: a bacia cheia nunca sobe rio abaixo', () => {
    for (let c = 0; c < 6 * n * n; c++) {
      if (w.height[c]! <= 0) continue;
      expect(hydro.filled[hydro.parent[c]!]!).toBeLessThanOrEqual(hydro.filled[c]!);
    }
  });
  it('a água junta rio abaixo e forma rios', () => {
    let rivers = 0;
    for (let c = 0; c < 6 * n * n; c++) if (hydro.flow[c]! >= RIVER_FLOW) rivers++;
    expect(rivers).toBeGreaterThan(0);
  });
  it('a bacia fechada vira lago', () => {
    const f = 4, c = f * n * n + Math.round(n * 0.6) * n + Math.round(n * 0.7);
    expect(hydro.lake[c]).toBe(1);
  });
});
