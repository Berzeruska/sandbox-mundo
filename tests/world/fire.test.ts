import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { Biome } from '../../src/world/biomes';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { FireProcess } from '../../src/world/disasters/fire';
import { CellState, Ground, hasVegetation } from '../../src/world/disasters/ground';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 64) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Célula de terra do bioma dado com mais vizinhas do mesmo bioma (miolo de uma região grande). */
function coreOf(world: WorldState, biome: number, maxLat = 90): number {
  const { neighbors, positions } = world.grid;
  let best = -1;
  let bestScore = -1;
  for (let c = 0; c < world.cellCount; c++) {
    if (world.biome[c] !== biome || world.isWater(c) || world.ice[c]) continue;
    if (Math.abs(Math.asin(positions[c * 3 + 1]!)) * (180 / Math.PI) > maxLat) continue;
    // Quantas células do mesmo bioma num raio de 3 passos.
    let score = 0;
    let frontier = [c];
    const seen = new Set(frontier);
    for (let s = 0; s < 3; s++) {
      const next: number[] = [];
      for (const x of frontier) for (let d = 0; d < 4; d++) {
        const j = neighbors[x * 4 + d]!;
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        if (world.biome[j] === biome) score++;
      }
      frontier = next;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Roda um incêndio até apagar e devolve as células que pegaram fogo. */
function burn(world: WorldState, start: number, seed: number, ground = new Ground(world.cellCount)): number[] {
  const lit = new Set<number>();
  const fire = new FireProcess(world, ground, createRng(seed), start, 0);
  for (let tick = 1; tick < 3000; tick++) {
    ground.expire(tick, TICKS_PER_YEAR);
    for (const c of ground.active) if (ground.state[c] === CellState.Burning) lit.add(c);
    if (!fire.step(tick)) break;
  }
  return [...lit];
}

describe('incêndio (R3)', () => {
  it('campo pega fogo e o fogo anda célula a célula', () => {
    const w = worldOf();
    const start = coreOf(w, Biome.Grassland);
    const sizes = [1, 2, 3, 4, 5].map((s) => burn(w, start, s).length);
    expect(Math.max(...sizes)).toBeGreaterThan(10);
  });

  it('não entra em deserto, gelo, montanha nem água', () => {
    for (const seed of ['terra', 'mundo']) {
      const w = worldOf(seed);
      for (const biome of [Biome.Grassland, Biome.Savanna, Biome.TemperateForest, Biome.Taiga]) {
        const start = coreOf(w, biome);
        if (start < 0) continue;
        for (const c of burn(w, start, 7)) {
          expect(w.isWater(c)).toBe(false);
          expect(w.ice[c]).toBe(0);
          expect(hasVegetation(w.biome[c]!), `bioma ${w.biome[c]}`).toBe(true);
        }
      }
    }
  });

  it('a célula queimada fica sem vegetação e a vegetação volta depois', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const start = coreOf(w, Biome.Grassland);
    const cells = burn(w, start, 3, g);
    expect(g.state[start]).toBe(CellState.Burned);
    expect(g.cover[start]).toBe(0);
    for (let y = 0; y < 20; y++) g.year(w);
    for (const c of cells) expect(g.cover[c]).toBeGreaterThan(0.5);
  });

  it('corre a favor do vento: perto do equador para oeste, nas latitudes médias para leste', () => {
    const w = worldOf('mundo');
    const eastShift = (start: number): number => {
      const p0 = cellPoint(w, start);
      let ex = p0[2];
      let ez = -p0[0];
      const l = Math.hypot(ex, ez);
      ex /= l;
      ez /= l;
      let sum = 0;
      let n = 0;
      for (let s = 1; s <= 12; s++) {
        for (const c of burn(w, start, s)) {
          const p = cellPoint(w, c);
          sum += (p[0] - p0[0]) * ex + (p[2] - p0[2]) * ez;
          n++;
        }
      }
      return n ? sum / n : 0;
    };
    const tropic = coreOf(w, Biome.Savanna, 25);
    expect(eastShift(tropic)).toBeLessThan(0);
    const mid = coreOf(w, Biome.Grassland, 60);
    const lat = Math.abs(Math.asin(cellPoint(w, mid)[1])) * (180 / Math.PI);
    if (lat >= 30 && lat < 60) expect(eastShift(mid)).toBeGreaterThan(0);
    else expect(eastShift(mid)).toBeLessThan(0);
  });
});

describe('raio (R3)', () => {
  it('raio do jogador em floresta acende; no mar só o clarão', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 0;
    const forest = coreOf(w, Biome.TemperateForest);
    const o = d.trigger(DisasterKind.Lightning, cellPoint(w, forest), 0);
    expect(o.events.map((e) => e.kind)).toEqual([DisasterKind.Lightning]);
    expect(d.ground.state[forest]).toBe(CellState.Burning);
    expect(d.running).toBe(1);

    const w2 = worldOf();
    const d2 = new Disasters(w2);
    const sea = [...Array(w2.cellCount).keys()].find((c) => w2.heightAboveSea(c) < -3000)!;
    const o2 = d2.trigger(DisasterKind.Lightning, cellPoint(w2, sea), 0);
    expect(o2.events.map((e) => e.kind)).toEqual([DisasterKind.Lightning]);
    expect(d2.running).toBe(0);
    expect([...d2.ground.active]).toEqual([]);
  });
});
