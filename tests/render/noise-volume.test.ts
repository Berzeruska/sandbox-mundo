import { describe, expect, it } from 'vitest';
import { buildNoiseVolume } from '../../src/render/noise-volume';

describe('volume de ruído do shader', () => {
  it('é fixo e tem o tamanho certo', () => {
    const a = buildNoiseVolume(8);
    expect(a.length).toBe(8 * 8 * 8 * 4);
    expect(a).toEqual(buildNoiseVolume(8));
  });

  it('valores bem espalhados (média ~127, usa a faixa toda)', () => {
    const a = buildNoiseVolume(32);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean).toBeGreaterThan(120);
    expect(mean).toBeLessThan(135);
    let min = 255;
    let max = 0;
    for (const v of a) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
  });
});
