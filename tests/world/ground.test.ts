import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { BIOME_INFO, Biome } from '../../src/world/biomes';
import { NO_LAYERS, SOIL_COLORS, vegetationColor, writeCellColor } from '../../src/render/colors';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { CellState, Ground, REGROW_YEARS } from '../../src/world/disasters/ground';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 64) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Primeira célula de terra sem gelo com o bioma dado. */
function cellOf(world: WorldState, biome: number): number {
  for (let c = 0; c < world.cellCount; c++) if (world.biome[c] === biome && !world.isWater(c) && !world.ice[c]) return c;
  throw new Error(`sem ${biome}`);
}

/** Anos até a vegetação da célula voltar a 100%, partindo de 0. */
function yearsToRegrow(world: WorldState, c: number): number {
  const g = new Ground(world.cellCount);
  g.damage(c, 1);
  for (let y = 1; y <= 200; y++) {
    g.year(world);
    if (g.cover[c] === 1) return y;
  }
  return Infinity;
}

describe('vegetação por célula (R2)', () => {
  it('volta na velocidade do bioma: campo em ~4 anos, floresta temperada em ~40, taiga em ~60', () => {
    const w = worldOf();
    for (const biome of [Biome.Grassland, Biome.TemperateForest, Biome.Taiga]) {
      const years = REGROW_YEARS[biome]!;
      const got = yearsToRegrow(w, cellOf(w, biome));
      expect(got, BIOME_INFO[biome]!.name).toBeGreaterThanOrEqual(Math.floor(years * 0.75));
      expect(got, BIOME_INFO[biome]!.name).toBeLessThanOrEqual(Math.ceil(years / 0.75) + 1);
    }
  });

  it('não volta enquanto queima, é lava ou lama; no solo fértil volta 2× mais rápido', () => {
    const w = worldOf();
    const c = cellOf(w, Biome.TemperateForest);
    const g = new Ground(w.cellCount);
    g.damage(c, 1);
    g.setState(c, CellState.Mud, 0, 30, TICKS_PER_YEAR);
    for (let y = 0; y < 10; y++) g.year(w);
    expect(g.cover[c]).toBe(0);
    const slow = yearsToRegrow(w, c);
    const f = new Ground(w.cellCount);
    f.damage(c, 1);
    f.setState(c, CellState.Fertile, 0, 100, TICKS_PER_YEAR);
    let fast = 0;
    while (f.cover[c]! < 1) {
      f.year(w);
      fast++;
    }
    expect(fast).toBeLessThanOrEqual(Math.ceil(slow / 2) + 1);
  });

  it('deserto, montanha e gelo não têm vegetação para perder', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const c = cellOf(w, Biome.HotDesert);
    g.damage(c, 1);
    g.year(w);
    expect(g.cover[c]).toBe(1);
    expect(g.active.has(c)).toBe(false);
  });
});

describe('cores do chão (R2)', () => {
  it('vegetação 0% = solo nu; 100% = cor do bioma; floresta a 30% passa por campo', () => {
    expect(vegetationColor(Biome.Grassland, 0)).toEqual(SOIL_COLORS[Biome.Grassland]);
    expect(vegetationColor(Biome.Grassland, 1)).toEqual(BIOME_INFO[Biome.Grassland]!.color);
    const forest30 = [...vegetationColor(Biome.TemperateForest, 0.3)!];
    const soil = SOIL_COLORS[Biome.TemperateForest]!;
    const grass = BIOME_INFO[Biome.Grassland]!.color;
    for (let k = 0; k < 3; k++) expect(forest30[k]).toBeCloseTo(soil[k]! + (grass[k]! - soil[k]!) * 0.6, 6);
    expect(vegetationColor(Biome.HotDesert, 0)).toBeNull();
  });

  it('queimada fica quase preta; a camada "Ver biomas" mostra o mundo sem os desastres', () => {
    const w = worldOf();
    const c = cellOf(w, Biome.TemperateForest);
    const g = new Ground(w.cellCount);
    g.damage(c, 1);
    g.setState(c, CellState.Burned, 0, 3, TICKS_PER_YEAR);
    const plain = new Uint8Array(w.cellCount * 4);
    const burned = new Uint8Array(w.cellCount * 4);
    writeCellColor(w, c, plain);
    writeCellColor(w, c, burned, NO_LAYERS, undefined, g);
    const lum = (a: Uint8Array) => a[c * 4]! + a[c * 4 + 1]! + a[c * 4 + 2]!;
    expect(lum(burned)).toBeLessThan(160);
    expect(lum(burned)).toBeLessThan(lum(plain));
    const layer = { ...NO_LAYERS, biomes: true };
    const a = new Uint8Array(w.cellCount * 4);
    const b = new Uint8Array(w.cellCount * 4);
    writeCellColor(w, c, a, layer);
    writeCellColor(w, c, b, layer, undefined, g);
    expect([...b.subarray(c * 4, c * 4 + 4)]).toEqual([...a.subarray(c * 4, c * 4 + 4)]);
  });
});

describe('desastres passo a passo (R2)', () => {
  it('cada desastre em andamento roda uma vez por passo, na ordem em que começou, até acabar', () => {
    const d = new Disasters(worldOf());
    d.frequency = 0;
    const log: string[] = [];
    const proc = (name: string, steps: number) => {
      let left = steps;
      return {
        step(tick: number): boolean {
          log.push(`${name}${tick}`);
          return --left > 0;
        },
      };
    };
    d.start(proc('a', 3));
    d.start(proc('b', 1));
    for (let t = 1; t <= 4; t++) d.step(t, 0);
    expect(log).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(d.running).toBe(0);
  });

  it('mesma semente + mesmos comandos = mesmo chão, em 1× ou em 20×', () => {
    const run = (speed: 1 | 20, dt: number) => {
      const core = new SimulationCore(() => undefined, () => 0);
      core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
      core.handle({ type: 'plateRate', rate: 0 });
      const w = core.world!;
      const land = [...Array(w.cellCount).keys()].find((c) => w.heightAboveSea(c) > 100 && w.heightAboveSea(c) < 1000 && !w.ice[c])!;
      core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, land) });
      core.handle({ type: 'disaster', kind: DisasterKind.Drought, point: cellPoint(w, land) });
      core.handle({ type: 'speed', speed });
      while (core.clock.tick < 30 * TICKS_PER_YEAR) core.advance(dt);
      const g = core.disasters!.ground;
      return { tick: core.clock.tick, cover: g.cover.slice(), state: g.state.slice(), colors: core.colors.slice() };
    };
    const slow = run(1, 1 / 12);
    const fast = run(20, 0.25);
    // O relógio para em múltiplos diferentes do passo; compara no mesmo passo.
    expect(slow.tick).toBe(fast.tick);
    expect(fast.cover).toEqual(slow.cover);
    expect(fast.state).toEqual(slow.state);
    expect(fast.colors).toEqual(slow.colors);
  }, 60_000);
});
