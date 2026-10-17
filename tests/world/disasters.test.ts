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

  it('frequência 0: nenhum desastre natural; placas paradas: só os do clima', () => {
    expect(run(worldOf(), 2000, 0).events.length).toBe(0);
    const still = run(worldOf(), 2000, 1, 0).events;
    expect(still.length).toBeGreaterThan(0);
    const geo: number[] = [DisasterKind.Quake, DisasterKind.Tsunami, DisasterKind.Volcano];
    expect(still.filter((e) => geo.includes(e.kind))).toEqual([]);
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

describe('desastres (T9): vulcões e pontos quentes', () => {
  it('erupções naturais só em arcos e dorsais (perto das fronteiras) ou sobre os pontos quentes', () => {
    const w = worldOf('42');
    const { d, events } = run(w, 6000);
    const eruptions = events.filter((e) => e.kind === DisasterKind.Volcano);
    expect(eruptions.length).toBeGreaterThan(20);
    const dist = boundaryDistance(w);
    const hot = new Set(d.hotspots.map((p) => w.grid.pointToCell(p[0], p[1], p[2])));
    for (const e of eruptions) {
      const c = w.grid.pointToCell(e.point[0], e.point[1], e.point[2]);
      expect(dist[c]! <= 4 || hot.has(c), e.label).toBe(true);
    }
  });

  it('a erupção ergue o relevo para sempre e as cinzas somem', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    const w = core.world!;
    const land = [...Array(w.cellCount).keys()].find((c) => w.heightAboveSea(c) > 100 && w.heightAboveSea(c) < 1000 && !w.boundary[c])!;
    const h0 = w.elevation[land]!;
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, land) });
    expect(w.elevation[land]!).toBeGreaterThan(h0 + 1000);
    expect(core.disasters!.disturbance.active.size).toBeGreaterThan(0);
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 40 * TICKS_PER_YEAR) core.advance(0.25);
    expect(core.disasters!.disturbance.active.size).toBe(0);
    expect(w.elevation[land]!).toBeGreaterThan(h0 + 1000);
  });

  it('ponto quente sob placa andando forma uma cadeia de ilhas', () => {
    // Mesmo mundo com e sem o ponto quente, no mar mais longe de terra: as ilhas a mais são dele.
    const islandsNear = (hotspot: boolean): number => {
      const core = new SimulationCore(() => undefined, () => 0);
      core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
      core.handle({ type: 'disasterFrequency', level: 0 });
      const w = core.world!;
      const dist = new Int32Array(w.cellCount).fill(-1);
      let frontier: number[] = [];
      for (let c = 0; c < w.cellCount; c++) {
        if (!w.isWater(c)) {
          dist[c] = 0;
          frontier.push(c);
        }
      }
      for (let s = 1; frontier.length; s++) {
        const next: number[] = [];
        for (const c of frontier) {
          for (let k = 0; k < 4; k++) {
            const j = w.grid.neighbors[c * 4 + k]!;
            if (dist[j] === -1) {
              dist[j] = s;
              next.push(j);
            }
          }
        }
        frontier = next;
      }
      let far = 0;
      for (let c = 0; c < w.cellCount; c++) if (dist[c]! > dist[far]!) far = c;
      const p = cellPoint(w, far);
      core.disasters!.hotspots = hotspot ? [p] : [];
      core.handle({ type: 'plateRate', rate: 1 });
      core.handle({ type: 'speed', speed: 20 });
      while (core.clock.tick < 4000 * TICKS_PER_YEAR) core.advance(0.25);
      // Ilhas (pedaços de terra) que encostam no círculo de 0,25 rad em volta do ponto quente.
      const near = new Set(w.grid.cellsInCap(p[0], p[1], p[2], 0.25));
      const seen = new Uint8Array(w.cellCount);
      let islands = 0;
      for (const s of near) {
        if (seen[s] || w.isWater(s)) continue;
        islands++;
        const stack = [s];
        seen[s] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          for (let k = 0; k < 4; k++) {
            const j = w.grid.neighbors[c * 4 + k]!;
            if (!seen[j] && !w.isWater(j)) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
      return islands;
    };
    expect(islandsNear(true) - islandsNear(false)).toBeGreaterThanOrEqual(2);
  }, 300_000);
});

describe('desastres (T10): clima', () => {
  it('furacão só nasce em oceano tropical quente e perde força em terra', () => {
    const w = worldOf('terra', 64);
    const { events } = run(w, 3000);
    const storms = events.filter((e) => e.kind === DisasterKind.Hurricane);
    expect(storms.length).toBeGreaterThan(20);
    for (const e of storms) {
      const c = w.grid.pointToCell(e.point[0], e.point[1], e.point[2]);
      const lat = Math.abs(Math.asin(e.point[1])) * (180 / Math.PI);
      expect(w.isWater(c)).toBe(true);
      expect(lat).toBeGreaterThanOrEqual(7.9);
      expect(lat).toBeLessThanOrEqual(20.1);
      expect(w.temperature[c]!).toBeGreaterThanOrEqual(26);
      // Em terra a força só cai.
      const path = e.path!;
      const st = e.strength!;
      for (let k = 1; k < st.length; k++) {
        const prev = w.grid.pointToCell(path[(k - 1) * 3]!, path[(k - 1) * 3 + 1]!, path[(k - 1) * 3 + 2]!);
        if (!w.isWater(prev)) expect(st[k]!).toBeLessThan(st[k - 1]!);
      }
    }
  });

  it('incêndio natural só em floresta sob seca', () => {
    const w = worldOf('mundo', 64);
    const d = new Disasters(w);
    let fires = 0;
    for (let y = 1; y <= 6000; y++) {
      const tick = y * TICKS_PER_YEAR;
      // Antes do passo: guarda quais células estavam secas.
      const before = d.disturbance.kind.slice();
      const o = d.step(tick, 1);
      for (const e of o?.events ?? []) {
        if (e.kind !== DisasterKind.Fire) continue;
        fires++;
        const c = w.grid.pointToCell(e.point[0], e.point[1], e.point[2]);
        expect([5, 6, 12]).toContain(w.biome[c]);
        expect(before[c]).toBe(Mark.Dry);
      }
    }
    expect(fires).toBeGreaterThan(5);
  });

  it('as marcas do clima somem: seca, enchente e queimado voltam ao normal', () => {
    const w = worldOf('terra', 64);
    const { d } = run(w, 400);
    expect(d.counts[DisasterKind.Drought]! + d.counts[DisasterKind.Flood]!).toBeGreaterThan(0);
    // Mais 100 anos sem nada novo: tudo some (a mais longa, queimado, dura 60).
    d.frequency = 0;
    for (let y = 401; y <= 500; y++) d.step(y * TICKS_PER_YEAR, 1);
    expect(d.disturbance.active.size).toBe(0);
  });

  it('frequências em 1.000 anos em "Raro" dentro da faixa esperada', () => {
    for (const seed of ['terra', 'mundo', '42']) {
      const { events } = run(worldOf(seed, 64), 1000);
      const n = (k: number) => events.filter((e) => e.kind === k).length;
      expect(n(DisasterKind.Drought), seed).toBeGreaterThanOrEqual(5);
      expect(n(DisasterKind.Drought), seed).toBeLessThanOrEqual(45);
      expect(n(DisasterKind.Flood), seed).toBeGreaterThanOrEqual(5);
      expect(n(DisasterKind.Flood), seed).toBeLessThanOrEqual(45);
      expect(n(DisasterKind.Hurricane), seed).toBeGreaterThanOrEqual(10);
      expect(n(DisasterKind.Hurricane), seed).toBeLessThanOrEqual(60);
      // Grandes (avisos): um a cada ~60–120 anos (1–2 min em 1×), com folga: 5 a 25 em 1.000 anos.
      const notable = events.filter((e) => e.notable).length;
      expect(notable, seed).toBeGreaterThanOrEqual(5);
      expect(notable, seed).toBeLessThanOrEqual(25);
    }
  });
});

describe('desastres (T11): na mão do jogador', () => {
  it('cada desastre provocado acontece com qualquer frequência (mesmo "Nenhum")', () => {
    const w = worldOf('terra', 64);
    const d = new Disasters(w);
    d.frequency = 0;
    const { neighbors } = w.grid;
    // Pontos: mar fundo encostado em terra baixa (tsunami, furacão), terra baixa (seca, enchente,
    // vulcão, terremoto), floresta (incêndio).
    let coastSea = -1;
    for (let c = 0; c < w.cellCount && coastSea < 0; c++) {
      if (!w.isWater(c)) continue;
      for (let k = 0; k < 4; k++) if (!w.isWater(neighbors[c * 4 + k]!) && w.heightAboveSea(neighbors[c * 4 + k]!) < 100) coastSea = c;
    }
    const lowland = [...Array(w.cellCount).keys()].find((c) => !w.isWater(c) && !w.ice[c] && w.heightAboveSea(c) < 150 && w.precipitation[c]! > 900)!;
    const forest = [...Array(w.cellCount).keys()].find((c) => [5, 6, 12].includes(w.biome[c]!))!;
    const at: Record<number, number> = {
      [DisasterKind.Quake]: lowland,
      [DisasterKind.Tsunami]: coastSea,
      [DisasterKind.Volcano]: lowland,
      [DisasterKind.Drought]: lowland,
      [DisasterKind.Flood]: lowland,
      [DisasterKind.Hurricane]: coastSea,
      [DisasterKind.Fire]: forest,
    };
    for (const [kind, cell] of Object.entries(at)) {
      const o = d.trigger(Number(kind) as DisasterKind, cellPoint(w, cell), 12);
      expect(o.events.some((e) => e.kind === Number(kind) && e.manual), `tipo ${kind}`).toBe(true);
    }
  });

  it('camada "Ver tensão": as fronteiras pintadas pela tensão, o resto acinzentado', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    const w = core.world!;
    core.handle({ type: 'layers', layers: { plates: false, biomes: false, resources: false, resourceMask: 0, stress: true } });
    const colors = core.colors;
    let grey = 0;
    let painted = 0;
    let land = 0;
    for (let c = 0; c < w.cellCount; c++) {
      const r = colors[c * 4]!;
      const g = colors[c * 4 + 1]!;
      const b = colors[c * 4 + 2]!;
      if (w.boundary[c]) {
        // Verde-amarelo, laranja ou vermelho: vermelho bem acima do azul.
        if (r - b > 60) painted++;
      } else if (!w.isWater(c)) {
        land++;
        if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) grey++;
      }
    }
    expect(painted).toBeGreaterThan(0.9 * [...w.boundary].filter((v) => v).length);
    expect(grey).toBeGreaterThan(0.95 * land);
  });
});
