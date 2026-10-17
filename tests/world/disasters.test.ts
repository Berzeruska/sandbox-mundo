import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters, type DisasterEvent } from '../../src/world/disasters';
import { Disturbance, Mark } from '../../src/world/disasters/disturbance';
import { MIN_MAGNITUDE, sampleMagnitude } from '../../src/world/disasters/quakes';
import { propagateTsunami, TSUNAMI_MIN_MAGNITUDE } from '../../src/world/disasters/tsunami';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 64) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Roda `years` anos de desastres naturais (placas andando) e devolve os eventos. */
function run(world: WorldState, years: number, frequency = 1, plateRate = 1): { d: Disasters; events: DisasterEvent[] } {
  const d = new Disasters(world);
  d.frequency = frequency;
  const events: DisasterEvent[] = [];
  for (let y = 1; y <= years; y++) {
    for (let k = 1; k <= TICKS_PER_YEAR; k++) {
      const o = d.step((y - 1) * TICKS_PER_YEAR + k, plateRate);
      if (o) events.push(...o.events);
    }
  }
  return { d, events };
}

/** Distância (passos de vizinhança) de cada célula até a fronteira de placa mais perto. */
function boundaryDistance(world: WorldState): Int32Array {
  const dist = new Int32Array(world.cellCount).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < world.cellCount; c++) {
    if (world.boundary[c]) {
      dist[c] = 0;
      frontier.push(c);
    }
  }
  for (let s = 1; frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let k = 0; k < 4; k++) {
        const j = world.grid.neighbors[c * 4 + k] as number;
        if (dist[j] !== -1) continue;
        dist[j] = s;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}

describe('desastres (T8): terremotos', () => {
  it('terremotos naturais só nas fronteiras de placa', () => {
    const w = worldOf();
    const { events } = run(w, 5000);
    const quakes = events.filter((e) => e.kind === DisasterKind.Quake);
    expect(quakes.length).toBeGreaterThan(20);
    const dist = boundaryDistance(w);
    for (const q of quakes) {
      const c = w.grid.pointToCell(q.point[0], q.point[1], q.point[2]);
      expect(dist[c]).toBe(0);
    }
  });

  it('muitos pequenos, poucos grandes (magnitudes de 5,5 até o máximo do tipo)', () => {
    const ms = Array.from({ length: 2000 }, (_, k) => sampleMagnitude((k + 0.5) / 2000, 9.3));
    expect(Math.min(...ms)).toBeGreaterThanOrEqual(MIN_MAGNITUDE);
    expect(Math.max(...ms)).toBeLessThanOrEqual(9.3);
    const big = ms.filter((m) => m >= 7).length;
    const small = ms.filter((m) => m < 6.5).length;
    expect(small).toBeGreaterThan(5 * big);
  });

  it('frequência 0 ou placas paradas: nenhum desastre natural', () => {
    expect(run(worldOf(), 2000, 0).events.length).toBe(0);
    expect(run(worldOf(), 2000, 1, 0).events.length).toBe(0);
  });

  it('"Raro": terremoto grande (M ≥ 7) a cada ~100–600 anos de jogo', () => {
    for (const seed of ['terra', 'mundo', '42']) {
      const { events } = run(worldOf(seed), 6000);
      const big = events.filter((e) => e.kind === DisasterKind.Quake && e.notable).length;
      expect(big, seed).toBeGreaterThanOrEqual(10);
      expect(big, seed).toBeLessThanOrEqual(60);
    }
  });

  it('determinismo: mesma semente, mesmos desastres', () => {
    const a = run(worldOf('42'), 3000).events.map((e) => [e.kind, e.tick, e.label]);
    const b = run(worldOf('42'), 3000).events.map((e) => [e.kind, e.tick, e.label]);
    expect(a).toEqual(b);
  });
});

describe('desastres (T8): tsunamis', () => {
  it('tsunami só a partir de terremoto forte no mar', () => {
    const { events } = run(worldOf('terra'), 20000);
    const quakes = new Map(events.filter((e) => e.kind === DisasterKind.Quake).map((e) => [e.tick * 1000 + Math.round(e.point[0] * 999), e]));
    const tsunamis = events.filter((e) => e.kind === DisasterKind.Tsunami);
    expect(tsunamis.length).toBeGreaterThan(0);
    const w = worldOf('terra');
    for (const t of tsunamis) {
      const q = quakes.get(t.tick * 1000 + Math.round(t.point[0] * 999));
      expect(q).toBeDefined();
      expect(q!.magnitude).toBeGreaterThanOrEqual(TSUNAMI_MIN_MAGNITUDE);
      expect(w.isWater(w.grid.pointToCell(t.point[0], t.point[1], t.point[2]))).toBe(true);
    }
  });

  it('a onda anda só pelo mar e alaga só terra baixa encostada', () => {
    const w = worldOf('terra', 64);
    const sea = [...Array(w.cellCount).keys()].find((c) => w.isWater(c) && w.heightAboveSea(c) < -3000)!;
    const r = propagateTsunami(w, sea, 9);
    expect(r.sea.length).toBeGreaterThan(50);
    for (const c of r.sea) expect(w.isWater(c)).toBe(true);
    for (const c of r.flooded) {
      expect(w.isWater(c)).toBe(false);
      expect(w.heightAboveSea(c)).toBeLessThan(40);
    }
    // Tempos de chegada em ordem crescente a partir do epicentro.
    for (let k = 1; k < r.times.length; k++) expect(r.times[k]!).toBeGreaterThanOrEqual(r.times[k - 1]!);
  });

  it('o jogador provoca tsunami no mar com qualquer frequência, e a costa alagada aparece nas cores e volta ao normal', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    const world = core.world!;
    // Mar fundo encostado em terra baixa.
    const { neighbors } = world.grid;
    let start = -1;
    for (let c = 0; c < world.cellCount && start < 0; c++) {
      if (!world.isWater(c)) continue;
      for (let k = 0; k < 4; k++) {
        const j = neighbors[c * 4 + k] as number;
        if (!world.isWater(j) && world.heightAboveSea(j) < 5 && !world.ice[j]) start = c;
      }
    }
    expect(start).toBeGreaterThanOrEqual(0);
    const before = core.colors.slice();
    core.handle({ type: 'disaster', kind: DisasterKind.Tsunami, point: cellPoint(world, start) });
    const d = core.disasters!.disturbance;
    const flooded = [...d.active];
    expect(flooded.length).toBeGreaterThan(0);
    // Mais azul que antes (alagado).
    const c0 = flooded[0]!;
    expect(core.colors[c0 * 4 + 2]! - core.colors[c0 * 4]!).toBeGreaterThan(before[c0 * 4 + 2]! - before[c0 * 4]!);
    // Anos depois a marca some e a cor volta (tempo andando, placas paradas).
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 20 * TICKS_PER_YEAR) core.advance(0.25);
    expect(d.active.size).toBe(0);
    expect(core.colors[c0 * 4 + 2]).toBe(before[c0 * 4 + 2]);
  });
});

describe('desastres: marcas temporárias', () => {
  it('a marca enfraquece com o tempo e some no fim', () => {
    const d = new Disturbance(10);
    d.mark(3, Mark.Burned, 0, 10, 12);
    expect(d.strength(3, 0)).toBe(1);
    expect(d.strength(3, 60)).toBeCloseTo(0.5, 6);
    expect(d.expire(119)).toEqual([]);
    expect(d.expire(120)).toEqual([3]);
    expect(d.kind[3]).toBe(Mark.None);
    expect(d.active.size).toBe(0);
  });

  it('marca mais curta não encurta uma mais longa', () => {
    const d = new Disturbance(4);
    d.mark(1, Mark.Ash, 0, 25, 12);
    d.mark(1, Mark.Flood, 0, 8, 12);
    expect(d.kind[1]).toBe(Mark.Ash);
  });
});
