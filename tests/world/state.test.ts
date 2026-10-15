import { describe, expect, it } from 'vitest';
import { CubeSphere } from '../../src/world/cubesphere';
import { WorldState } from '../../src/world/state';

const params = { seedText: '1', seed: 1, n: 8, seaLevel: 0, landFraction: 0.3 };

describe('WorldState', () => {
  it('cria arrays do tamanho da grade', () => {
    const w = new WorldState(params);
    expect(w.cellCount).toBe(6 * 8 * 8);
    for (const arr of [w.elevation, w.temperature, w.precipitation, w.biome, w.ice, w.iceMode, w.waterDistance]) {
      expect(arr.length).toBe(w.cellCount);
    }
  });

  it('água e terra dependem do nível do mar', () => {
    const w = new WorldState(params);
    w.elevation[0] = 10;
    w.elevation[1] = -10;
    expect(w.isWater(0)).toBe(false);
    expect(w.isWater(1)).toBe(true);
    w.seaLevel = 20;
    expect(w.isWater(0)).toBe(true);
    expect(w.heightAboveSea(0)).toBe(-10);
  });

  it('recusa grade com resolução diferente', () => {
    expect(() => new WorldState(params, new CubeSphere(4))).toThrow();
  });
});
