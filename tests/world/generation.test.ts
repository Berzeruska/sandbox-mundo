import { describe, expect, it } from 'vitest';
import { CubeSphere } from '../../src/world/cubesphere';
import { generateTerrain, landComponents, thresholdForFraction } from '../../src/world/generation';
import { WorldState } from '../../src/world/state';

const grid = new CubeSphere(64);
const make = (seed: number, landFraction = 0.3) => {
  const w = new WorldState({ seedText: String(seed), seed, n: 64, seaLevel: 0, landFraction }, grid);
  generateTerrain(w);
  return w;
};

describe('geração da Pangeia', () => {
  it('é determinística: mesma semente, mesmo terreno', () => {
    expect(make(42).elevation).toEqual(make(42).elevation);
  });

  it('sementes diferentes geram terrenos diferentes', () => {
    expect(make(1).elevation).not.toEqual(make(2).elevation);
  });

  it.each([1, 2, 3, 77, 2026])('semente %i: fração de terra dentro de ±5% do alvo', (seed) => {
    expect(Math.abs(make(seed).landFraction() - 0.3)).toBeLessThan(0.05);
  });

  it('respeita outra fração de terra pedida', () => {
    expect(Math.abs(make(5, 0.45).landFraction() - 0.45)).toBeLessThan(0.05);
  });

  it.each([1, 2, 3, 77, 2026])('semente %i: um continente principal dominante', (seed) => {
    const w = make(seed);
    const sizes = landComponents(w);
    const land = sizes.reduce((a, b) => a + b, 0);
    expect((sizes[0] as number) / land).toBeGreaterThan(0.8);
  });

  it('tem montanhas altas e oceano profundo', () => {
    const w = make(9);
    expect(Math.max(...w.elevation)).toBeGreaterThan(2500);
    expect(Math.min(...w.elevation)).toBeLessThan(-3000);
  });

  it('thresholdForFraction deixa a fração pedida acima do limiar', () => {
    const values = Float32Array.from({ length: 1000 }, (_, i) => i);
    const t = thresholdForFraction(values, 0.3);
    expect(values.filter((v) => v > t).length).toBeCloseTo(300, -1);
  });

  it('thresholdForFraction dá o mesmo valor que ordenar tudo (com repetidos e em qualquer ordem)', () => {
    let s = 12345;
    const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const length of [1, 2, 3, 10, 999, 5000]) {
      for (const levels of [3, 50, 1e9]) {
        const values = Float32Array.from({ length }, () => Math.floor(next() * levels) - levels / 2);
        for (const fraction of [0, 0.01, 0.3, 0.5, 0.99, 1]) {
          const sorted = Float32Array.from(values).sort();
          const k = Math.min(length - 1, Math.max(0, Math.floor((1 - fraction) * length)));
          expect(thresholdForFraction(values, fraction)).toBe(sorted[k]);
        }
      }
    }
  });
});

describe('moveAlong', () => {
  it('anda o ângulo pedido e continua na esfera', async () => {
    const { moveAlong } = await import('../../src/world/generation');
    const { latLonToPoint } = await import('../../src/world/cubesphere');
    for (const [lat, lon] of [[0, 0], [0.8, 2], [-1.2, -1]] as const) {
      const p = latLonToPoint(lat, lon);
      for (const bearing of [0, 1, 3]) {
        const q = moveAlong(p, bearing, 0.5);
        expect(Math.hypot(...q)).toBeCloseTo(1, 10);
        expect(Math.acos(p[0] * q[0] + p[1] * q[1] + p[2] * q[2])).toBeCloseTo(0.5, 10);
      }
    }
    // Rumo 0 = norte: a latitude aumenta.
    const q = moveAlong(latLonToPoint(0, 0), 0, 0.3);
    expect(q[1]).toBeGreaterThan(0);
  });
});
