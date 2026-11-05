import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import { Tool } from '../../src/input/tools';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters, type DisasterOutcome } from '../../src/world/disasters';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { coneTop, growCone, LavaProcess, type Volcano } from '../../src/world/disasters/volcano';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

const volcanoAt = (cell: number, cone = 3): Volcano => ({ id: 1, cell, kind: 'player', hotspot: -1, cone, top: coneTop(cone), awake: true, until: 1e9, nextEruption: 0, extinct: false });

/** Ergue o cone no mundo (como o relógio faz) e solta a lava até acabar. Devolve as células com lava. */
function erupt(world: WorldState, ground: Ground, v: Volcano, budget: number): { lava: number[]; newLand: number[] } {
  const t = growCone(world, ground, v, null);
  t.cells.forEach((c, k) => (world.elevation[c] = world.elevation[c]! + t.deltas[k]!));
  let newLand: number[] = [];
  const p = new LavaProcess(world, ground, createRng(2), v, budget, () => undefined, (cells) => (newLand = cells));
  const lava: number[] = [];
  for (let tick = 1; tick < 500; tick++) {
    const before = new Set(ground.active);
    const alive = p.step(tick);
    for (const c of ground.active) if (!before.has(c) && (ground.state[c] === CellState.Lava || ground.state[c] === CellState.Basalt)) lava.push(c);
    if (!alive) break;
  }
  return { lava, newLand };
}

/** Terra alta e longe do mar (para a lava ter onde descer). */
function highland(world: WorldState): number {
  let best = -1;
  for (let c = 0; c < world.cellCount; c++) {
    if (world.isWater(c) || world.heightAboveSea(c) < 300 || world.heightAboveSea(c) > 1500) continue;
    if (best < 0 || world.waterDistance[c]! > world.waterDistance[best]!) best = c;
  }
  return best;
}

describe('vulcão (R7)', () => {
  it('o cone é relevo de verdade: mais alto no anel, cratera mais funda, rocha marcada', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const c = highland(w);
    const v = volcanoAt(c, 4);
    const h0 = w.elevation.slice();
    const t = growCone(w, g, v, null);
    t.cells.forEach((x, k) => (w.elevation[x] = w.elevation[x]! + t.deltas[k]!));
    expect(g.rock[c]).toBe(255);
    const rimGain = Math.max(...t.cells.filter((x) => g.rock[x]! < 255 && g.rock[x]! > 200).map((x) => w.elevation[x]! - h0[x]!));
    expect(rimGain).toBeGreaterThan(w.elevation[c]! - h0[c]! + 200);
  });

  it('a lava desce: sai da cratera e cada célula nova não fica muito acima de onde veio', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const c = highland(w);
    const { lava } = erupt(w, g, volcanoAt(c), 60);
    expect(lava.length).toBeGreaterThan(20);
    // No geral, desce: a lava termina bem mais baixo que a cratera.
    const end = lava.slice(-10).map((x) => w.elevation[x]!);
    expect(Math.max(...end)).toBeLessThan(w.elevation[c]!);
    // Nunca entra na cratera nem passa pelo cone fora do canal.
    expect(lava.filter((x) => g.rock[x] === 255)).toEqual([]);
  });

  it('lava que chega ao mar endurece e vira terra nova', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    // Vulcão de ilha: perto da costa, a lava escorre para o mar.
    let coast = -1;
    for (let x = 0; x < w.cellCount && coast < 0; x++) {
      if (w.isWater(x) || w.ice[x] || w.heightAboveSea(x) > 200) continue;
      if ([0, 1, 2, 3].filter((d) => w.isWater(w.grid.neighbors[x * 4 + d]!)).length >= 2) coast = x;
    }
    const { newLand } = erupt(w, g, volcanoAt(coast, 2), 120);
    expect(newLand.length).toBeGreaterThan(0);
    for (const x of newLand) expect(g.state[x]).toBe(CellState.Basalt);
  });

  it('vulcão adormecido não entra em erupção sozinho antes da hora; com frequência 0, nunca', () => {
    const w = worldOf('terra', 64);
    const d = new Disasters(w);
    expect(d.volcanoes.length).toBeGreaterThan(3);
    d.frequency = 0;
    const events: DisasterOutcome['events'] = [];
    for (let t = 1; t <= 500 * TICKS_PER_YEAR; t += 1) events.push(...(d.step(t, 1)?.events ?? []));
    expect(events.filter((e) => e.kind === DisasterKind.Volcano)).toEqual([]);
    // Com frequência: acorda só quando chega a hora dele.
    const d2 = new Disasters(worldOf('terra', 64));
    const first = Math.min(...d2.volcanoes.map((v) => v.until));
    for (let t = 1; t < first; t++) {
      const o = d2.step(t, 1);
      expect((o?.events ?? []).filter((e) => e.kind === DisasterKind.Volcano && !e.label.includes('dorsal') && e.label.includes('acordou'))).toEqual([]);
    }
  });

  it('o jogador: tocar fora cria um vulcão (cone + erupção); tocar nele acorda de novo', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    const w = core.world!;
    const c = highland(w);
    const h0 = w.elevation[c]!;
    const before = core.disasters!.volcanoes.length;
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
    const d = core.disasters!;
    expect(d.volcanoes.length).toBe(before + 1);
    const v = d.volcanoes[d.volcanoes.length - 1]!;
    expect(v.awake).toBe(true);
    expect(w.elevation[c]!).toBeGreaterThan(h0 + 300);
    expect(d.ground.state[c]).toBe(CellState.Lava);
    v.awake = false;
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
    expect(d.volcanoes.length).toBe(before + 1);
    expect(v.awake).toBe(true);
  });

  it('o vulcão e o basalto andam com a placa nas recomposições', () => {
    let recomposed = 0;
    const core = new SimulationCore((msg) => {
      if (msg.type === 'recomposed') recomposed++;
    }, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    const w = core.world!;
    const c = highland(w);
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
    const d = core.disasters!;
    const v = d.volcanoes[d.volcanoes.length - 1]!;
    const plate = w.plate[c]!;
    // Um derrame de basalto que dura muito (o natural dura 100–300 anos; a primeira recomposição deste
    // mundo vem depois disso).
    const flow = w.grid.cellsInCap(...cellPoint(w, c), 6 * w.grid.cellAngle).filter((x) => !d.ground.rock[x] && w.plate[x] === plate && !w.isWater(x));
    for (const x of flow) d.ground.setState(x, CellState.Basalt, core.clock.tick, 5000, TICKS_PER_YEAR);
    const start = cellPoint(w, v.cell);
    core.handle({ type: 'plateRate', rate: 1 });
    core.handle({ type: 'speed', speed: 20 });
    while (recomposed < 2 && core.clock.tick < 20000) core.advance(0.25);
    expect(recomposed).toBe(2);
    // A cratera andou (a placa girou), continua com a rocha e na mesma placa; o basalto foi junto.
    const now = cellPoint(w, v.cell);
    expect(Math.hypot(now[0] - start[0], now[1] - start[1], now[2] - start[2])).toBeGreaterThan(0);
    expect(w.plate[v.cell]).toBe(plate);
    expect(d.ground.rock[v.cell]).toBe(255);
    const basalt = [...d.ground.active].filter((x) => d.ground.state[x] === CellState.Basalt);
    // Parte foi coberta pela lava da própria erupção (que esfria e some antes da recomposição).
    expect(basalt.length).toBeGreaterThan(flow.length * 0.6);
    for (const x of basalt) expect(w.plate[x]).toBe(plate);
  }, 60_000);
});

it('raio num vulcão faz a lava espirrar no cone (teste da 30e5e93)', () => {
  const w = worldOf('terra', 64);
  const d = new Disasters(w);
  d.frequency = 0;
  const v = d.volcanoes.find((x) => !w.isWater(x.cell))!;
  const lavaBefore = [...d.ground.active].filter((c) => d.ground.state[c] === CellState.Lava).length;
  d.trigger(DisasterKind.Lightning, cellPoint(w, v.cell), 0);
  const lava = [...d.ground.active].filter((c) => d.ground.state[c] === CellState.Lava);
  expect(lava.length).toBeGreaterThan(lavaBefore + 3);
  // O do jogador também acorda o vulcão.
  expect(v.awake).toBe(true);
});

describe('vulcão debaixo do gelo (C10)', () => {
  /** Relógio com um vulcão do jogador coberto por gelo pintado. */
  function iced(icyClimate: boolean) {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.handle({ type: 'plateRate', rate: 0 });
    const w = core.world!;
    // Lugar quente (sem gelo do clima) ou frio (de gelo).
    let c = -1;
    for (let x = 0; x < w.cellCount; x++) {
      if (w.isWater(x) || w.heightAboveSea(x) < 200 || w.heightAboveSea(x) > 1500) continue;
      const cold = w.temperature[x]! < -8;
      if (cold !== icyClimate) continue;
      if (!icyClimate && w.ice[x]) continue;
      if (c < 0 || w.waterDistance[x]! > w.waterDistance[c]!) c = x;
    }
    expect(c, icyClimate ? 'lugar frio' : 'lugar quente').toBeGreaterThanOrEqual(0);
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
    const d = core.disasters!;
    const v = d.volcanoes[d.volcanoes.length - 1]!;
    v.awake = false;
    // Gelo pintado por cima do cone e em volta.
    core.handle({ type: 'brush', tool: Tool.Ice, point: cellPoint(w, c), radius: v.cone + 4, dt: 1 });
    return { core, w, d, v, c };
  }

  it('acordado, derrete o gelo em volta e solta a enchente do degelo, que deixa areia e cascalho', () => {
    const { core, w, d, v, c } = iced(false);
    expect(w.ice[c]).toBe(1);
    core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
    expect(v.awake).toBe(true);
    expect(w.ice[c]).toBe(0);
    core.handle({ type: 'speed', speed: 1 });
    for (let k = 0; k < 30; k++) core.advance(1 / 12);
    // A água passa em 1–2 anos e vira areia e cascalho: conta as duas.
    const water = [...d.ground.active].filter((x) => d.ground.state[x] === CellState.Meltwater || d.ground.state[x] === CellState.Outwash);
    expect(water.length).toBeGreaterThan(5);
    // Desce: termina mais baixo que o pé do cone.
    expect(Math.min(...water.map((x) => w.elevation[x]!))).toBeLessThan(w.elevation[c]!);
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 5 * 12) core.advance(0.25);
    expect([...d.ground.active].some((x) => d.ground.state[x] === CellState.Outwash)).toBe(true);
  });

  it('o gelo derretido volta só onde o clima é de gelo, e devagar', () => {
    for (const icy of [false, true]) {
      const { core, w, v, c } = iced(icy);
      core.handle({ type: 'disaster', kind: DisasterKind.Volcano, point: cellPoint(w, c) });
      v.awake = false;
      v.until = Number.MAX_SAFE_INTEGER;
      expect(w.ice[c]).toBe(0);
      core.handle({ type: 'speed', speed: 20 });
      // Em 30 anos ainda não voltou.
      while (core.clock.tick < 30 * 12) core.advance(0.25);
      expect(w.ice[c]).toBe(0);
      while (core.clock.tick < 160 * 12) core.advance(0.25);
      expect(w.ice[c], icy ? 'clima de gelo' : 'clima quente').toBe(icy ? 1 : 0);
    }
  }, 120_000);
});
