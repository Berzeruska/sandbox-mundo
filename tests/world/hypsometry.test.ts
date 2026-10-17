import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { CubeSphere } from '../../src/world/cubesphere';
import { Tectonics } from '../../src/world/tectonics';

/**
 * G4 (critério do usuário, com o mundo real como base): aos 10 min a 20× com placas 100%, em N = 256
 * (resolução das medições de aprovação), a terra acima de 2.000 m fica entre 5% e 15%, acima de
 * 4.000 m entre 0,5% e 4%, e acima de 6.000 m abaixo de 0,3%. Nem toda montanha é extrema.
 */
const TICKS_PER_MINUTE_AT_20X = 60 * 240;

function check(seedText: string, grid: CubeSphere): void {
  const w = createWorld({ seedText, seed: seedFrom(seedText), n: 256, seaLevel: 0, landFraction: 0.3 }, grid);
  const t = new Tectonics(w);
  for (let k = 0; k < 10 * TICKS_PER_MINUTE_AT_20X; k++) t.step(1);
  let land = 0;
  let above2 = 0;
  let above4 = 0;
  let above6 = 0;
  for (let c = 0; c < w.cellCount; c++) {
    const e = w.elevation[c]!;
    if (e <= 0) continue;
    land++;
    if (e > 2000) above2++;
    if (e > 4000) above4++;
    if (e > 6000) above6++;
  }
  expect(above2 / land).toBeGreaterThan(0.05);
  expect(above2 / land).toBeLessThan(0.15);
  expect(above4 / land).toBeGreaterThan(0.005);
  expect(above4 / land).toBeLessThan(0.04);
  expect(above6 / land).toBeLessThan(0.003);
}

describe('G4: altitudes da terra aos 10 min (placas no máximo, N = 256)', () => {
  const grid = new CubeSphere(256);
  // A "7" foi falha conhecida (0,44% acima de 4.000 m, alvo 0,5%) até a plataforma continental larga
  // (2026-10-17), que deu mais crosta continental para as colisões.
  it.each(['terra', 'mundo', '42', 'ilha', '7'])('semente "%s"', (seedText) => check(seedText, grid), 300_000);
});
