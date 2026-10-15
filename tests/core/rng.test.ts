import { describe, expect, it } from 'vitest';
import { createRng, hashString, seedFrom } from '../../src/core/rng';

const take = (seed: number, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.uint32());
};

describe('rng', () => {
  it('mesma semente gera a mesma sequência', () => {
    expect(take(12345, 1000)).toEqual(take(12345, 1000));
  });

  it('sementes diferentes geram sequências diferentes', () => {
    expect(take(1, 50)).not.toEqual(take(2, 50));
  });

  it('next() fica em [0, 1) e tem média perto de 0.5', () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('int() respeita os limites e alcança os dois extremos', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('range() respeita os limites', () => {
    const rng = createRng(5);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });

  it('semente em texto é estável e texto numérico vira número', () => {
    expect(hashString('pangeia')).toBe(hashString('pangeia'));
    expect(hashString('pangeia')).not.toBe(hashString('pangea'));
    expect(seedFrom('42')).toBe(42);
    expect(seedFrom(' terra ')).toBe(hashString('terra'));
  });
});
