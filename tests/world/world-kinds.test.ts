import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { MAX_SHADER_PLATES } from '../../src/render/plate-motion';
import { createWorld } from '../../src/world/create';
import { CubeSphere } from '../../src/world/cubesphere';
import { ARCHIPELAGO_MAX_ISLAND, ARCHIPELAGO_MAX_LAND, archipelagoReached, landComponents } from '../../src/world/generation';
import { PLATE_TUNING } from '../../src/world/plates';
import { parseWorldKind, type WorldKind, type WorldState } from '../../src/world/state';
import { Tectonics } from '../../src/world/tectonics';

// Decisão do usuário (2026-11-04): Padrão, Continentes menores e Arquipélago. O arquipélago nasce de uma
// Pangeia e vai se partindo; os critérios são os da definição do desenho, não o que o código dá.
const TICKS_PER_MINUTE_AT_20X = 60 * 240;
const grid128 = new CubeSphere(128);
const make = (seedText: string, kind: WorldKind) => createWorld({ seedText, seed: seedFrom(seedText), n: 128, seaLevel: 0, landFraction: 0.3, kind }, grid128);
const landShareOfPlates = (w: WorldState): number[] => {
  const land = new Array<number>(w.plates.length).fill(0);
  let total = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (w.isWater(c)) continue;
    land[w.plate[c] as number]!++;
    total++;
  }
  return land.map((x) => x / total);
};

describe('tipo de mundo', () => {
  it('sem tipo é o padrão: nada muda nos mundos que já existem', () => {
    const a = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: 128, seaLevel: 0, landFraction: 0.3 }, grid128);
    const b = make('terra', 'standard');
    expect(Array.from(a.plate)).toEqual(Array.from(b.plate));
  });

  it('a mesma semente com outro tipo dá outro mundo; o mesmo tipo dá o mesmo mundo', () => {
    const a = make('terra', 'archipelago');
    const b = make('terra', 'archipelago');
    expect(Array.from(a.plate)).toEqual(Array.from(b.plate));
    expect(Array.from(make('terra', 'standard').plate)).not.toEqual(Array.from(a.plate));
  });

  it('texto desconhecido na URL vira o padrão', () => {
    expect(parseWorldKind('archipelago')).toBe('archipelago');
    expect(parseWorldKind('smaller')).toBe('smaller');
    expect(parseWorldKind('xyz')).toBe('standard');
    expect(parseWorldKind(null)).toBe('standard');
  });

  it.each(['terra', 'mundo', 's3'])('continentes menores, semente "%s": nenhuma placa nasce com mais que a peça máxima', (seed) => {
    const w = make(seed, 'smaller');
    // Folga de 3 pontos: o corte traçado não cai exatamente no número.
    for (const share of landShareOfPlates(w)) expect(share).toBeLessThanOrEqual(PLATE_TUNING.smaller.maxLandShare + 0.03);
    expect(Math.max(...landShareOfPlates(make(seed, 'standard')))).toBeGreaterThan(Math.max(...landShareOfPlates(w)) - 1e-9);
  });

  it('todos os tipos cabem nas placas que o desenho aceita', () => {
    for (const kind of ['standard', 'smaller', 'archipelago'] as const) {
      for (const seed of ['terra', 'mundo', '7', 's3']) expect(make(seed, kind).plates.length).toBeLessThanOrEqual(MAX_SHADER_PLATES);
    }
  });

  it.each(['terra', 'pangeia'])(
    'arquipélago, semente "%s": nasce Pangeia, vai se partindo e chega ao desenho de ilhas',
    (seed) => {
      const w = make(seed, 'archipelago');
      // Nasce uma Pangeia: terra como a dos outros mundos e quase toda num bloco.
      expect(w.landFraction()).toBeCloseTo(0.3, 2);
      const born = landComponents(w);
      expect(born[0]! / born.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
      expect(archipelagoReached(w)).toBe(false);
      const t = new Tectonics(w);
      let reachedAt = -1;
      const maxTicks = 8 * TICKS_PER_MINUTE_AT_20X;
      for (let k = 0; k < maxTicks && reachedAt < 0; k++) if (t.step(1) && archipelagoReached(w)) reachedAt = k;
      // Vai se partindo: não fica pronto logo.
      expect(reachedAt).toBeGreaterThan(TICKS_PER_MINUTE_AT_20X / 2);
      const sizes = landComponents(w);
      const land = sizes.reduce((a, b) => a + b, 0);
      expect(w.landFraction()).toBeLessThanOrEqual(ARCHIPELAGO_MAX_LAND);
      expect(sizes[0]! / land).toBeLessThanOrEqual(ARCHIPELAGO_MAX_ISLAND);
    },
    120_000,
  );
});
