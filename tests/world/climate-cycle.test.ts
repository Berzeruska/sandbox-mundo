import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { SimulationCore } from '../../src/sim/core';
import { APPLY_DELAY_TICKS, CLIMATE_STEP } from '../../src/sim/geology';
import { Biome, classifyCell, PEAK_HEIGHT, SNOW_MIN_PRECIP } from '../../src/world/biomes';
import {
  applyClimateOffset,
  climateOffsetAt,
  computeWaterDistance,
  GLACIAL_AMPLITUDE,
  GLACIAL_PERIOD_TICKS,
  glacialOffset,
  glideToward,
  seaLevelFor,
  updateClimate,
} from '../../src/world/climate';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { Tectonics } from '../../src/world/tectonics';

const worldOf = (seed = 'terra', n = 64) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });
const iceCells = (w: WorldState) => w.ice.reduce((a, b) => a + b, 0);

describe('clima (T7): temperatura global e ciclo glacial', () => {
  it('o recálculo parcial (só o desvio mudou) bate com o total', () => {
    const a = worldOf();
    const b = worldOf();
    // Mesmo degrau do mar (desvio pequeno): caminho parcial.
    expect(applyClimateOffset(a, -0.3)).toBe(false);
    b.climateOffset = -0.3;
    computeWaterDistance(b);
    updateClimate(b);
    expect(a.temperature).toEqual(b.temperature);
    expect(a.ice).toEqual(b.ice);
    expect(a.biome).toEqual(b.biome);
  });

  it('a área de gelo cresce com a temperatura global menor e recua com ela maior', () => {
    const counts = [-6, -3, 0, 3, 6].map((offset) => {
      const w = worldOf();
      applyClimateOffset(w, offset);
      return iceCells(w);
    });
    for (let k = 1; k < counts.length; k++) expect(counts[k]!).toBeLessThan(counts[k - 1]!);
  });

  it('ciclo e controle se somam', () => {
    for (const tick of [0, 30_000, 96_000, 110_000]) {
      for (const control of [-10, -3, 0, 4, 10]) expect(climateOffsetAt(tick, control)).toBeCloseTo(glacialOffset(tick) + control, 9);
    }
    // O controle vai de −10 a +10.
    expect(climateOffsetAt(0, 50)).toBe(10);
    expect(climateOffsetAt(0, -50)).toBe(-10);
    // E o mundo com ciclo + controle é o mesmo que com o desvio somado.
    const a = worldOf();
    const b = worldOf();
    applyClimateOffset(a, climateOffsetAt(60_000, 2));
    applyClimateOffset(b, glacialOffset(60_000) + 2);
    expect(a.ice).toEqual(b.ice);
  });

  it('ciclo forte: começa normal, esfria devagar até −8 °C e esquenta rápido; repete', () => {
    expect(glacialOffset(0)).toBe(0);
    const coldest = glacialOffset(0.8 * GLACIAL_PERIOD_TICKS);
    expect(coldest).toBeCloseTo(-GLACIAL_AMPLITUDE, 6);
    // Esfriar leva 80% do ciclo; esquentar, 20%.
    expect(glacialOffset(0.4 * GLACIAL_PERIOD_TICKS)).toBeCloseTo(-GLACIAL_AMPLITUDE / 2, 6);
    expect(glacialOffset(0.9 * GLACIAL_PERIOD_TICKS)).toBeCloseTo(-GLACIAL_AMPLITUDE / 2, 6);
    expect(glacialOffset(GLACIAL_PERIOD_TICKS + 1234)).toBeCloseTo(glacialOffset(1234), 9);
    for (let t = 0; t < GLACIAL_PERIOD_TICKS; t += 500) expect(glacialOffset(t)).toBeLessThanOrEqual(0);
  });

  it('no máximo glacial o mar desce ~120 m e aparece terra nova (nunca sobe acima do normal)', () => {
    expect(seaLevelFor(0, -GLACIAL_AMPLITUDE)).toBe(-120);
    expect(seaLevelFor(0, 10)).toBe(0);
    const w = worldOf();
    const land0 = w.landFraction();
    expect(applyClimateOffset(w, -GLACIAL_AMPLITUDE)).toBe(true);
    expect(w.seaLevel).toBe(-120);
    expect(w.landFraction()).toBeGreaterThan(land0);
    // A geologia não muda: a crosta segue pelo nível de referência.
    for (let i = 0; i < w.cellCount; i += 97) expect(w.heightAboveBase(i)).toBe(w.elevation[i]);
  });

  it('neve depende da chuva: montanha alta, fria e seca fica rocha', () => {
    const base = { height: PEAK_HEIGHT + 500, temp: -5, ice: false, nearWater: false };
    expect(classifyCell({ ...base, precip: SNOW_MIN_PRECIP + 100 })).toBe(Biome.SnowyPeak);
    expect(classifyCell({ ...base, precip: SNOW_MIN_PRECIP - 100 })).toBe(Biome.Mountain);
  });
});

describe('clima (T7): erosão pela chuva', () => {
  it('o lado chuvoso de uma cordilheira desgasta mais que o seco', () => {
    const n = 32;
    const g = new CubeSphere(n);
    const w = new WorldState({ seedText: '', seed: 0, n, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) {
      w.plate[i] = 0;
      w.elevation[i] = 5000;
      w.crust[i] = Crust.Continental;
      // Metade chuvosa (x > 0), metade seca.
      w.precipitation[i] = g.positions[i * 3]! > 0 ? 2000 : 100;
    }
    const axis: Vec3 = [0, 1, 0];
    w.plates = [{ id: 0, seed: axis, center: axis, omega: axis, continental: 0, color: [0, 0, 0] }];
    const t = new Tectonics(w, { stages: false });
    t.recompose();
    let wet = 0;
    let dry = 0;
    let nw = 0;
    let nd = 0;
    for (let i = 0; i < w.cellCount; i++) {
      if (g.positions[i * 3]! > 0.2) {
        wet += w.elevation[i]!;
        nw++;
      } else if (g.positions[i * 3]! < -0.2) {
        dry += w.elevation[i]!;
        nd++;
      }
    }
    expect(wet / nw).toBeLessThan(dry / nd - 5);
  });
});

describe('clima (T7): no jogo, com placas paradas', () => {
  it('o clima segue o ciclo glacial mesmo sem placas, e o relógio mostra o desvio com o atraso de sempre', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'speed', speed: 20 });
    core.handle({ type: 'plateRate', rate: 0 });
    while (core.clock.tick < 40_000) core.advance(0.25);
    const shownTick = core.clock.tick - APPLY_DELAY_TICKS;
    // O desvio mostrado é o de um passo recente (no máximo um degrau de clima atrás).
    expect(core.world!.climateOffset).toBeLessThan(-1);
    expect(Math.abs(core.world!.climateOffset - glacialOffset(shownTick))).toBeLessThan(CLIMATE_STEP + 0.05);
  });

  it('o controle do jogador muda o clima aos poucos (1 °C por segundo real, também pausado)', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'speed', speed: 0 });
    const ice0 = iceCells(core.world!);
    core.handle({ type: 'climateControl', control: -8 });
    expect(core.world!.climateOffset).toBe(0);
    for (let k = 0; k < 4; k++) core.advance(0.25);
    // 1 s depois: −1 °C (refeito em degraus de 0,5 °C).
    expect(core.world!.climateOffset).toBeCloseTo(-1, 6);
    for (let k = 0; k < 40; k++) core.advance(0.25);
    expect(core.world!.climateOffset).toBe(-8);
    expect(iceCells(core.world!)).toBeGreaterThan(ice0);
  });

  it('caminhada do controle: passo limitado pela taxa, chega no alvo sem passar', () => {
    expect(glideToward(0, -8, 1)).toBe(-1);
    expect(glideToward(-7.6, -8, 1)).toBe(-8);
    expect(glideToward(2, 5, 0.5, 2)).toBe(3);
    expect(glideToward(3, 3, 1)).toBe(3);
  });
});
