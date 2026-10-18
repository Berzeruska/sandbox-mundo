import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { droughtHeat, HEAT_C, startDrought } from '../../src/world/disasters/drought';
import { FloodProcess, floodPlan, lowestNear } from '../../src/world/disasters/flood';
import { CellState, Ground, hasVegetation } from '../../src/world/disasters/ground';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Célula de terra com vegetação mais longe do mar (miolo de continente). */
function inland(world: WorldState, ok: (c: number) => boolean = () => true): number {
  let best = -1;
  for (let c = 0; c < world.cellCount; c++) {
    if (world.isWater(c) || world.ice[c] || !hasVegetation(world.biome[c]!) || !ok(c)) continue;
    if (best < 0 || world.waterDistance[c]! > world.waterDistance[best]!) best = c;
  }
  return best;
}

describe('seca (R4)', () => {
  it('região grande e irregular; aquece mais no miolo (+2 a +6 °C) e tira vegetação ano a ano', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const center = inland(w);
    const started = startDrought(w, g, center, 20, 8, 0)!;
    expect(started.cells.length).toBeGreaterThan(400);
    // Borda irregular: a distância das células da borda ao centro varia bastante.
    const p0 = cellPoint(w, center);
    const dist = (c: number) => Math.acos(Math.min(1, cellPoint(w, c).reduce((a, x, k) => a + x * p0[k]!, 0))) / w.grid.cellAngle;
    const inSet = new Set(started.cells);
    const edge = started.cells.filter((c) => [0, 1, 2, 3].some((d) => !inSet.has(w.grid.neighbors[c * 4 + d]!) && !w.isWater(w.grid.neighbors[c * 4 + d]!)));
    const ds = edge.map(dist);
    expect(Math.max(...ds) - Math.min(...ds)).toBeGreaterThan(6);
    // Calor: miolo mais quente que a borda.
    expect(droughtHeat(g.levelOf(center))).toBeCloseTo(HEAT_C[1], 5);
    expect(Math.min(...edge.map((c) => droughtHeat(g.levelOf(c))))).toBeLessThan(3);
    // Anos depois: o miolo perdeu bem mais vegetação que a borda.
    for (let tick = 1; tick <= 6 * TICKS_PER_YEAR; tick++) {
      g.expire(tick, TICKS_PER_YEAR);
      started.process.step(tick);
    }
    const veg = (cs: number[]) => cs.filter((c) => hasVegetation(w.biome[c]!)).map((c) => g.cover[c]!);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(g.cover[center]).toBeLessThan(0.4);
    expect(mean(veg(edge))).toBeGreaterThan(mean(veg([center])) + 0.2);
    // Acabou a seca: o calor sai e a vegetação volta.
    for (let tick = 6 * TICKS_PER_YEAR + 1; tick <= 9 * TICKS_PER_YEAR; tick++) g.expire(tick, TICKS_PER_YEAR);
    expect(g.state[center]).toBe(CellState.None);
    const before = g.cover[center]!;
    for (let y = 0; y < 5; y++) g.year(w);
    expect(g.cover[center]).toBeGreaterThan(before);
  });
});

describe('enchente (R4)', () => {
  it('a água começa no ponto mais baixo e segue o terreno baixo (não faz círculo)', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const center = inland(w, (c) => w.heightAboveSea(c) < 600);
    const start = lowestNear(w, g, center);
    const plan = floodPlan(w, g, start, 50, 250);
    expect(plan.cells[0]).toBe(start);
    const top = w.elevation[start]! + 50;
    for (const c of plan.cells) expect(w.elevation[c]!).toBeLessThanOrEqual(top);
    // Em ordem de altura vizinha: nenhuma célula de fora encostada na água é mais baixa que a água
    // que já entrou, salvo quando bateu no tamanho máximo.
    if (plan.cells.length < 250) {
      const inSet = new Set(plan.cells);
      for (const c of plan.cells) for (let d = 0; d < 4; d++) {
        const j = w.grid.neighbors[c * 4 + d]!;
        if (!inSet.has(j) && !w.isWater(j) && !w.ice[j]) expect(w.elevation[j]!).toBeGreaterThan(top);
      }
    }
  });

  it('sobe em ~1 s, deixa solo fértil, e a vegetação volta mais rápido nele', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const start = lowestNear(w, g, inland(w, (c) => w.heightAboveSea(c) < 600));
    const plan = floodPlan(w, g, start, 60, 200);
    const flood = new FloodProcess(w, g, plan, 0, 2, createRng(1));
    let tick = 0;
    while (flood.step(++tick));
    expect(tick).toBeLessThanOrEqual(13);
    for (const c of plan.cells) expect([CellState.Flooded, CellState.Lake]).toContain(g.state[c]);
    // Anos depois a água baixa e fica solo fértil.
    for (; tick <= 4 * TICKS_PER_YEAR; tick++) g.expire(tick, TICKS_PER_YEAR);
    const fertile = plan.cells.filter((c) => g.state[c] === CellState.Fertile && hasVegetation(w.biome[c]!));
    expect(fertile.length).toBeGreaterThan(plan.cells.length / 2);
    // Mesma perda de vegetação: no solo fértil volta mais rápido que num chão comum.
    const c = fertile[0]!;
    const plain = new Ground(w.cellCount);
    g.cover[c] = 0;
    plain.damage(c, 1);
    g.year(w);
    plain.year(w);
    expect(g.cover[c]!).toBeGreaterThan(plain.cover[c]! * 1.9);
  });

  it('a seca e a enchente provocadas andam passo a passo no relógio', () => {
    const w = worldOf('terra', 64);
    const d = new Disasters(w);
    d.frequency = 0;
    const c = inland(w, (x) => w.heightAboveSea(x) < 600);
    d.trigger(DisasterKind.Flood, cellPoint(w, c), 0);
    d.trigger(DisasterKind.Drought, cellPoint(w, inland(w)), 0);
    expect(d.running).toBe(2);
    for (let t = 1; t <= 24; t++) d.step(t, 0);
    // A enchente já subiu toda; a seca continua.
    expect(d.running).toBe(1);
  });
});
