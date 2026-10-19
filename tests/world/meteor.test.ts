import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { CRATER_DEPTH, ENTRY_TICKS, GIANT_WINTER, impact, NATURAL_PER_YEAR, sampleNaturalMeteor } from '../../src/world/disasters/meteor';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

function inland(world: WorldState): number {
  let best = -1;
  for (let c = 0; c < world.cellCount; c++) if (!world.isWater(c) && (best < 0 || world.waterDistance[c]! > world.waterDistance[best]!)) best = c;
  return best;
}

describe('meteoro (C12)', () => {
  it('cratera de verdade: fundo afundado, borda erguida; maior pelo tamanho', () => {
    const w = worldOf();
    const c = inland(w);
    const sizes = [1, 2, 3, 4].map((s) => {
      const hit = impact(w, new Ground(w.cellCount), c, s, 0, createRng(1));
      const deep = Math.min(...hit.terrainDeltas);
      const rim = Math.max(...hit.terrainDeltas);
      return { cells: hit.terrainCells.length, deep, rim };
    });
    sizes.forEach((x, k) => {
      expect(x.deep).toBeLessThanOrEqual(-CRATER_DEPTH[k + 1]! * 0.7);
      expect(x.rim).toBeGreaterThan(0);
      if (k) expect(x.cells).toBeGreaterThan(sizes[k - 1]!.cells);
    });
  });

  it('fundo escuro, entulho na borda, vegetação derrubada e incêndio do meteoro', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 0;
    const c = inland(w);
    const o = d.trigger(DisasterKind.Meteor, cellPoint(w, c), 0, 3);
    expect(o.events.map((e) => e.kind)).toEqual([DisasterKind.Meteor]);
    const fires: string[] = [];
    let terrain = 0;
    for (let t = 1; t <= ENTRY_TICKS + 200; t++) {
      const out = d.step(t, 0);
      terrain += out?.terrain.length ?? 0;
      for (const e of out?.events ?? []) if (e.kind === DisasterKind.Fire) fires.push(e.cause!);
    }
    expect(terrain).toBe(1);
    expect(d.ground.state[c]).toBe(CellState.Impact);
    expect([...d.ground.active].some((x) => d.ground.state[x] === CellState.Ejecta)).toBe(true);
    for (const f of fires) expect(f).toBe('meteoro');
  });

  it('no mar, do médio para cima faz tsunami; o pequeno não', () => {
    const w = worldOf();
    const sea = [...Array(w.cellCount).keys()].find((c) => w.heightAboveSea(c) < -3000)!;
    for (const [size, tsunami] of [[1, false], [3, true]] as const) {
      const d = new Disasters(worldOf());
      d.frequency = 0;
      d.trigger(DisasterKind.Meteor, cellPoint(w, sea), 0, size);
      const kinds: number[] = [];
      for (let t = 1; t <= ENTRY_TICKS + 1; t++) kinds.push(...(d.step(t, 0)?.events ?? []).map((e) => e.kind));
      expect(kinds.includes(DisasterKind.Tsunami), `tamanho ${size}`).toBe(tsunami);
    }
  });

  it('o gigante esfria o planeta por um tempo (inverno de impacto) e depois volta', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.handle({ type: 'plateRate', rate: 0 });
    const w = core.world!;
    const before = w.climateOffset;
    core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cellPoint(w, inland(w)), strength: 4 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < ENTRY_TICKS + 24) core.advance(0.05);
    expect(w.climateOffset).toBeLessThan(before - GIANT_WINTER.amount * 0.9);
    while (core.clock.tick < (GIANT_WINTER.years + 2 + 41) * TICKS_PER_YEAR) core.advance(0.25);
    expect(Math.abs(w.climateOffset - before)).toBeLessThan(0.6);
  }, 60_000);

  it('naturais: pequenos os mais comuns, depois médios, grandes e gigante raríssimo', () => {
    for (let k = 2; k <= 4; k++) expect(NATURAL_PER_YEAR[k]!).toBeLessThan(NATURAL_PER_YEAR[k - 1]!);
    const rng = createRng(7);
    const count = [0, 0, 0, 0, 0];
    for (let y = 0; y < 400000; y++) count[sampleNaturalMeteor(rng, 1)]!++;
    expect(count[1]!).toBeGreaterThan(count[2]!);
    expect(count[2]!).toBeGreaterThan(count[3]!);
  });
});
