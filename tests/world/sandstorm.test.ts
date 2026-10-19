import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { windAt } from '../../src/world/disasters/fire';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { DESERTS, PLAYER_SAND_RADIUS, SAND_RADIUS, SandstormProcess } from '../../src/world/disasters/sandstorm';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

function desertEdge(world: WorldState): number {
  for (let c = 0; c < world.cellCount; c++) {
    if (!DESERTS.has(world.biome[c]!) || world.isWater(c)) continue;
    const p = cellPoint(world, c);
    const around = world.grid.cellsInCap(p[0], p[1], p[2], 8 * world.grid.cellAngle);
    if (around.filter((x) => !world.isWater(x) && !DESERTS.has(world.biome[x]!)).length > 20) return c;
  }
  return -1;
}

describe('tempestade de areia (C12)', () => {
  it('maior que a proposta: raio 10–24 (jogador 18–24)', () => {
    expect(SAND_RADIUS).toEqual([10, 24]);
    expect(PLAYER_SAND_RADIUS).toEqual([18, 24]);
  });

  it('anda com o vento e deixa areia só fora do deserto, que some em alguns anos', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const start = desertEdge(w);
    const p = new SandstormProcess(w, g, start, 14, createRng(2), 0, 0);
    const first = p.view()!.point;
    let tick = 0;
    while (p.step(++tick));
    // Andou no sentido do vento do lugar onde nasceu.
    const wind = windAt(w, start);
    const last = (p as unknown as { points: number[][] }).points.at(-1)!;
    const moved = [last[0]! - first[0], last[1]! - first[1], last[2]! - first[2]];
    expect(moved[0]! * wind[0] + moved[1]! * wind[1] + moved[2]! * wind[2]).toBeGreaterThan(0);
    const sand = [...g.active].filter((c) => g.state[c] === CellState.Sand);
    expect(sand.length).toBeGreaterThan(10);
    for (const c of sand) {
      expect(DESERTS.has(w.biome[c]!)).toBe(false);
      expect(w.isWater(c)).toBe(false);
    }
    // Temporária: em 11 anos some (e não muda bioma nenhum: o deserto não avança).
    const biomes = w.biome.slice();
    for (let t = tick; t <= tick + 11 * TICKS_PER_YEAR; t++) g.expire(t, TICKS_PER_YEAR);
    expect([...g.active].filter((c) => g.state[c] === CellState.Sand)).toEqual([]);
    expect(w.biome).toEqual(biomes);
  });

  it('a natural nasce em deserto ou na seca; o jogador provoca em qualquer terra', () => {
    const w = worldOf('terra', 64);
    const d = new Disasters(w);
    d.frequency = 4;
    let born = 0;
    for (let t = 1; t <= 300 * TICKS_PER_YEAR; t++) {
      for (const e of d.step(t, 0)?.events ?? []) {
        if (e.kind !== DisasterKind.Sandstorm) continue;
        born++;
        const c = w.grid.pointToCell(...e.point);
        expect(DESERTS.has(w.biome[c]!) || d.ground.state[c] === CellState.Heat).toBe(true);
      }
    }
    expect(born).toBeGreaterThan(0);
    const d2 = new Disasters(worldOf('terra', 64));
    d2.frequency = 0;
    const land = [...Array(w.cellCount).keys()].find((c) => !w.isWater(c) && !DESERTS.has(w.biome[c]!))!;
    expect(d2.trigger(DisasterKind.Sandstorm, cellPoint(w, land), 0).events.map((e) => e.kind)).toEqual([DisasterKind.Sandstorm]);
    expect(d2.dustViews().length).toBe(1);
  });
});
