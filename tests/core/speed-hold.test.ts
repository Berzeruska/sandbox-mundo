import { describe, expect, it } from 'vitest';
import { holdsSpeedChange } from '../../src/core/time';
import { MeteorProcess } from '../../src/world/disasters/meteor';

describe('a velocidade espera a rocha (T8, opção 3)', () => {
  it('reduzir com rocha caindo espera; sem rocha vale na hora', () => {
    expect(holdsSpeedChange('max', 1, 2000, 1500)).toBe(true);
    expect(holdsSpeedChange(20, 5, 2000, 1500)).toBe(true);
    expect(holdsSpeedChange('max', 1, -1, 1500)).toBe(false);
    expect(holdsSpeedChange('max', 1, 1500, 1500)).toBe(false);
  });
  it('acelerar e pausar valem na hora', () => {
    expect(holdsSpeedChange(1, 20, 2000, 1500)).toBe(false);
    expect(holdsSpeedChange(1, 'max', 2000, 1500)).toBe(false);
    expect(holdsSpeedChange('max', 0, 2000, 1500)).toBe(false);
  });
  it('a rocha só conta depois de aparecer', () => {
    const out = { events: [], impacts: [], marked: [], uplifts: [], terrain: [], ice: [], winters: [] };
    const p = new MeteorProcess(100, () => 12, () => undefined, () => undefined);
    expect(p.fallingImpact()).toBe(-1);
    p.step(50, out);
    expect(p.fallingImpact()).toBe(-1);
    p.step(90, out);
    expect(p.fallingImpact()).toBe(100);
  });
});
