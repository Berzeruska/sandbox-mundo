import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { CubeSphere } from '../../src/world/cubesphere';
import { landComponents } from '../../src/world/generation';
import { Tectonics } from '../../src/world/tectonics';

/**
 * Critério de "bonito" do usuário (2026-10-15): depois de a Pangeia se partir, de 4 a 7
 * continentes de tamanhos variados e nenhum com mais de ~40% da terra. A conferência visual é em
 * N = 256 (docs/img/m2-formas-*.png); aqui roda em N = 128 para caber no CI, com uma folga pequena
 * pela resolução menor.
 */
const TICKS_PER_MINUTE_AT_20X = 60 * 240;

describe('formas dos continentes depois da Pangeia se partir (placas no máximo, 2 min a 20×)', () => {
  const grid = new CubeSphere(128);
  it.each(['terra', 'mundo', '7'])('semente "%s": 4 a 8 continentes, nenhum com mais de 45% da terra', (seedText) => {
    const w = createWorld({ seedText, seed: seedFrom(seedText), n: 128, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w);
    for (let k = 0; k < 2 * TICKS_PER_MINUTE_AT_20X; k++) t.step(1);
    const sizes = landComponents(w);
    const land = sizes.reduce((a, b) => a + b, 0);
    const continents = sizes.filter((s) => s >= 0.02 * land);
    expect(continents.length).toBeGreaterThanOrEqual(4);
    expect(continents.length).toBeLessThanOrEqual(8);
    expect((continents[0] ?? 0) / land).toBeLessThan(0.45);
    expect(w.landFraction()).toBeGreaterThan(0.24);
  }, 60_000);
});
