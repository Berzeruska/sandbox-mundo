import { describe, expect, it } from 'vitest';
import { buildColors, cellHash } from '../../src/render/colors';
import { createWorld } from '../../src/world/create';

describe('cores das células', () => {
  it('cellHash é fixo e fica em [0, 1)', () => {
    expect(cellHash(123)).toBe(cellHash(123));
    for (let i = 0; i < 1000; i++) {
      expect(cellHash(i)).toBeGreaterThanOrEqual(0);
      expect(cellHash(i)).toBeLessThan(1);
    }
  });

  it('preenche RGBA opaco para todas as células', () => {
    const w = createWorld({ seedText: '1', seed: 1, n: 16, seaLevel: 0, landFraction: 0.3 });
    const out = new Uint8Array(w.cellCount * 4);
    buildColors(w, out);
    for (let i = 0; i < w.cellCount; i++) expect(out[i * 4 + 3]).toBe(255);
    // Oceano é azulado, terra não.
    const water = [...Array(w.cellCount).keys()].find((i) => w.isWater(i) && !w.ice[i])!;
    expect(out[water * 4 + 2]).toBeGreaterThan(out[water * 4]!);
  });
});
