import { describe, expect, it } from 'vitest';
import { buildColors, hillshade } from '../../src/render/colors';
import { latLonToPoint } from '../../src/world/cubesphere';
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

describe('sombreado de relevo', () => {
  const make = () => {
    const w = createWorld({ seedText: '1', seed: 1, n: 32, seaLevel: 0, landFraction: 0.3 });
    w.elevation.fill(500);
    return w;
  };
  const g = make().grid;
  const p = latLonToPoint(0.3, 0.4);
  const center = g.pointToCell(p[0], p[1], p[2]);

  it('terra plana não tem sombra', () => {
    expect(hillshade(make(), center)).toBeCloseTo(1, 9);
  });

  it('encosta virada para o noroeste é mais clara que a virada para o sudeste', () => {
    // Morro: altura cai com a distância de um pico.
    const w = make();
    for (let i = 0; i < w.cellCount; i++) {
      const dot = g.positions[i * 3]! * p[0] + g.positions[i * 3 + 1]! * p[1] + g.positions[i * 3 + 2]! * p[2];
      w.elevation[i] = 500 + 3000 * Math.max(0, 1 - Math.acos(Math.min(1, dot)) / (g.cellAngle * 8));
    }
    const nw = g.pointToCell(...latLonToPoint(0.3 + g.cellAngle * 3, 0.4 - g.cellAngle * 3));
    const se = g.pointToCell(...latLonToPoint(0.3 - g.cellAngle * 3, 0.4 + g.cellAngle * 3));
    expect(hillshade(w, nw)).toBeGreaterThan(1.05);
    expect(hillshade(w, se)).toBeLessThan(0.95);
  });
});
