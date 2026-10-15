import { describe, expect, it } from 'vitest';
import { buildColors } from '../../src/render/colors';
import { createWorld } from '../../src/world/create';

describe('cores das células', () => {
  const w = createWorld({ seedText: '1', seed: 1, n: 16, seaLevel: 0, landFraction: 0.3 });
  const out = new Uint8Array(w.cellCount * 4);
  buildColors(w, out);

  it('o canal alfa leva o código do bioma (para o shader)', () => {
    for (let i = 0; i < w.cellCount; i++) expect(out[i * 4 + 3]).toBe(w.biome[i]);
  });

  it('oceano é azulado', () => {
    const water = [...Array(w.cellCount).keys()].find((i) => w.isWater(i) && !w.ice[i])!;
    expect(out[water * 4 + 2]).toBeGreaterThan(out[water * 4]!);
  });

  it('mesmo bioma e mesma altura dão a mesma cor (sem variação por célula, que desenhava a grade)', () => {
    const a = [...Array(w.cellCount).keys()].filter((i) => w.isWater(i) && !w.ice[i] && w.elevation[i] === w.elevation[0]);
    for (const i of a) expect([...out.subarray(i * 4, i * 4 + 3)]).toEqual([...out.subarray(a[0]! * 4, a[0]! * 4 + 3)]);
  });
});
