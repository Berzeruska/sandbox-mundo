import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters, type DisasterEvent } from '../../src/world/disasters';
import { CellState, Ground, hasVegetation } from '../../src/world/disasters/ground';
import { writeCellColor } from '../../src/render/colors';
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

  it('o jogador provoca tsunami no mar com qualquer frequência: a costa vira lama sem vegetação, aparece nas cores e volta ao normal', () => {
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
    const d = core.disasters!.ground;
    // O terremoto que gera o tsunami também deixa fenda e estrago perto do epicentro (R5).
    const flooded = [...d.active].filter((c) => d.state[c] === CellState.Mud);
    expect(flooded.length).toBeGreaterThan(0);
    const c0 = flooded[0]!;
    expect(d.state[c0]).toBe(CellState.Mud);
    expect(d.cover[c0]).toBe(0);
    expect([0, 1, 2].some((k) => core.colors[c0 * 4 + k] !== before[c0 * 4 + k])).toBe(true);
    // Décadas depois a lama sai, a vegetação volta e a cor é a do mundo sem desastre (tempo andando, placas paradas).
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 150 * TICKS_PER_YEAR) core.advance(0.25);
    expect(d.active.size).toBe(0);
    const clean = new Uint8Array(world.cellCount * 4);
    writeCellColor(world, c0, clean);
    expect([...core.colors.subarray(c0 * 4, c0 * 4 + 4)]).toEqual([...clean.subarray(c0 * 4, c0 * 4 + 4)]);
  });
});

describe('desastres: estados de célula (R2)', () => {
  it('o estado enfraquece com o tempo e sai no fim', () => {
    const d = new Ground(10);
    d.setState(3, CellState.Crack, 0, 10, 12);
    d.expire(0, 12);
    expect(d.strength(3)).toBe(1);
    d.expire(60, 12);
    expect(d.strength(3)).toBeCloseTo(0.5, 6);
    d.expire(119, 12);
    expect(d.state[3]).toBe(CellState.Crack);
    d.expire(120, 12);
    expect(d.state[3]).toBe(CellState.None);
    // Alagada não some: a água baixa e fica solo fértil (R4).
    d.setState(4, CellState.Flooded, 0, 1, 12);
    d.expire(12, 12);
    expect(d.state[4]).toBe(CellState.Fertile);
  });

  it('a lava esfria em basalto (100–300 anos), e só lava cobre lava e basalto', () => {
    const d = new Ground(10);
    d.setState(2, CellState.Lava, 0, 2, 12);
    d.setState(2, CellState.Flooded, 0, 8, 12);
    expect(d.state[2]).toBe(CellState.Lava);
    d.expire(24, 12);
    expect(d.state[2]).toBe(CellState.Basalt);
    const years = (d.until[2]! - 24) / 12;
    expect(years).toBeGreaterThanOrEqual(100);
    expect(years).toBeLessThanOrEqual(300);
    d.setState(2, CellState.Mud, 30, 20, 12);
    expect(d.state[2]).toBe(CellState.Basalt);
  });

  it('só repinta o que mudou de aparência', () => {
    const d = new Ground(10);
    d.damage(4, 0.6);
    expect(d.takeChanged()).toEqual([4]);
    expect(d.takeChanged()).toEqual([]);
    d.damage(4, 0.001);
    expect(d.takeChanged()).toEqual([]);
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
    expect(core.disasters!.ground.active.size).toBeGreaterThan(0);
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 60 * TICKS_PER_YEAR) core.advance(0.25);
    expect(core.disasters!.ground.active.size).toBe(0);
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

  it('incêndio natural nasce de raio, em terra com vegetação (R3)', () => {
    const w = worldOf('mundo', 64);
    const d = new Disasters(w);
    let fires = 0;
    let bolts = 0;
    for (let tick = 1; tick <= 3000 * TICKS_PER_YEAR; tick++) {
      const o = d.step(tick, 1);
      for (const e of o?.events ?? []) {
        if (e.kind === DisasterKind.Lightning) bolts++;
        if (e.kind !== DisasterKind.Fire) continue;
        fires++;
        const c = w.grid.pointToCell(e.point[0], e.point[1], e.point[2]);
        expect(w.isWater(c)).toBe(false);
        expect(hasVegetation(w.biome[c]!)).toBe(true);
      }
    }
    expect(fires).toBeGreaterThan(5);
    // Todo incêndio natural começou num raio (o aviso sai quando o fogo apaga).
    expect(bolts).toBeGreaterThanOrEqual(fires);
  }, 120_000);

  it('as marcas do clima somem: seca, enchente e queimado voltam ao normal', () => {
    const w = worldOf('terra', 64);
    const { d } = run(w, 400);
    expect(d.counts[DisasterKind.Drought]! + d.counts[DisasterKind.Flood]!).toBeGreaterThan(0);
    // Mais 200 anos sem nada novo: tudo some (o mais lento é taiga queimada voltando, até ~80 anos).
    d.frequency = 0;
    for (let y = 401; y <= 600; y++) d.step(y * TICKS_PER_YEAR, 1);
    expect(d.ground.active.size).toBe(0);
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
      [DisasterKind.Lightning]: forest,
    };
    for (const [kind, cell] of Object.entries(at)) {
      const o = d.trigger(Number(kind) as DisasterKind, cellPoint(w, cell), 12);
      const events = [...o.events];
      // O incêndio anda passo a passo (R3): o evento dele sai quando o fogo apaga.
      for (let tick = 13; Number(kind) === DisasterKind.Fire && tick < 5000 && !events.some((e) => e.kind === DisasterKind.Fire); tick++) {
        events.push(...(d.step(tick, 0)?.events ?? []));
      }
      expect(events.some((e) => e.kind === Number(kind) && e.manual), `tipo ${kind}`).toBe(true);
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
