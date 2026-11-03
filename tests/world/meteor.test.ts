import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { glacialOffset, IMPACT_RAMP_YEARS } from '../../src/world/climate';
import { buildColors } from '../../src/render/colors';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellDistance, cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { CRATER_DEPTH, CRATER_RADIUS, ENTRY_TICKS, GIANT_WINTER, impact, NATURAL_PER_YEAR, sampleNaturalMeteor } from '../../src/world/disasters/meteor';
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

  // Defeito achado na F3: o que nasce no meio do passo de outro desastre (o tsunami e os incêndios do
  // meteoro, o fogo da lava) era perdido. Pelo desenho (C12), o meteoro acende incêndios em volta.
  it('o incêndio do meteoro anda de verdade (não some ao nascer no impacto)', () => {
    const w = worldOf();
    const forest = [...Array(w.cellCount).keys()].find((c) => [5, 6, 12].includes(w.biome[c]!) && w.waterDistance[c]! > 15)!;
    const d = new Disasters(w);
    d.frequency = 0;
    d.trigger(DisasterKind.Meteor, cellPoint(w, forest), 0, 3);
    let burning = 0;
    for (let t = 1; t <= ENTRY_TICKS + 30; t++) {
      d.step(t, 0);
      burning = Math.max(burning, [...d.ground.active].filter((x) => d.ground.state[x] === CellState.Burning).length);
    }
    expect(burning).toBeGreaterThan(0);
    expect(d.running).toBeGreaterThan(0);
  });

  it('no mar, do médio para cima faz tsunami; o pequeno não', () => {
    const w = worldOf();
    const sea = [...Array(w.cellCount).keys()].find((c) => w.heightAboveSea(c) < -3000)!;
    for (const [size, tsunami] of [[1, false], [3, true]] as const) {
      const d = new Disasters(worldOf());
      d.frequency = 0;
      d.trigger(DisasterKind.Meteor, cellPoint(w, sea), 0, size);
      const kinds: number[] = [];
      let wave = 0;
      for (let t = 1; t <= ENTRY_TICKS + 200; t++) {
        kinds.push(...(d.step(t, 0)?.events ?? []).map((e) => e.kind));
        wave += [...d.ground.active].filter((x) => d.ground.state[x] === CellState.Wave).length;
      }
      expect(kinds.includes(DisasterKind.Tsunami), `tamanho ${size}`).toBe(tsunami);
      // A onda anda de verdade (antes o processo do tsunami do meteoro era perdido).
      expect(wave > 0, `onda, tamanho ${size}`).toBe(tsunami);
    }
  });

  it('o gigante esfria o planeta aos poucos (E6), sem mexer no mar, e volta no tempo certo', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.handle({ type: 'plateRate', rate: 0 });
    const w = core.world!;
    const before = w.climateOffset;
    const sea = w.seaLevel;
    core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cellPoint(w, inland(w)), strength: 4 });
    core.handle({ type: 'speed', speed: 20 });
    const yearsAfterHit = (y: number) => {
      while (core.clock.tick < ENTRY_TICKS + y * TICKS_PER_YEAR) core.advance(0.05);
    };
    // Chega aos poucos: no primeiro ano, menos da metade do frio.
    yearsAfterHit(1);
    expect(w.climateOffset).toBeGreaterThan(before - GIANT_WINTER.amount * 0.5);
    // Depois de IMPACT_RAMP_YEARS, quase todo (a prévia anda em degraus de meio grau).
    yearsAfterHit(IMPACT_RAMP_YEARS + 0.5);
    expect(w.climateOffset).toBeLessThan(before - GIANT_WINTER.amount + 0.6);
    // O mar não muda (o mar segue o gelo das geleiras, que leva milênios).
    expect(w.seaLevel).toBe(sea);
    // Volta ao normal no fim do inverno (sem esperar o motor).
    yearsAfterHit(GIANT_WINTER.years + 1);
    expect(Math.abs(w.climateOffset - before)).toBeLessThan(0.3);
  }, 60_000);

  it('vários gigantes empilhados, dois jogados pausados: o mundo volta célula a célula ao que era (B2)', () => {
    // B2 (teste da adf001ea): "depois de uma era do gelo feita com meteoros, a temperatura sobe ao
    // máximo". O teste antigo via só o número do Dados com um gigante; este olha o que o jogador vê:
    // temperatura, gelo e bioma de cada célula e as cores da tela.
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.handle({ type: 'plateRate', rate: 0 });
    const w = core.world!;
    const temp0 = w.temperature.slice();
    const biome0 = w.biome.slice();
    const ice0 = w.ice.slice();
    const cells = [inland(w), 3, 1500, 4000, 5100].map((c) => cellPoint(w, c));
    core.handle({ type: 'speed', speed: 0 });
    core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cells[0]!, strength: 4 });
    core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cells[1]!, strength: 4 });
    core.advance(1);
    core.handle({ type: 'speed', speed: 1 });
    let coldest = 0;
    const colors = (core as unknown as { colors: Uint8Array }).colors;
    const full = new Uint8Array(colors.length);
    for (let k = 0; k < 3; k++) {
      core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cells[2 + k]!, strength: 4 });
      for (let f = 0; f < 60; f++) {
        core.advance(1 / 20);
        coldest = Math.min(coldest, w.climateOffset);
      }
    }
    // As cores da tela (repintura só onde mudou) são as mesmas de uma repintura completa.
    buildColors(w, full, undefined, undefined, core.disasters!.ground);
    expect(colors).toEqual(full);
    expect(coldest).toBeLessThan(-3 * GIANT_WINTER.amount);
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < (GIANT_WINTER.years + 10) * TICKS_PER_YEAR) core.advance(0.05);
    // Só o ciclo glacial natural (milésimos de grau neste começo), sem resto de frio do impacto.
    expect(Math.abs(w.climateOffset - glacialOffset(core.clock.tick))).toBeLessThan(0.01);
    // Fora das crateras (o relevo mudou ali para sempre), cada célula volta à temperatura, ao gelo e ao
    // bioma de antes.
    const crater = new Set<number>();
    for (const p of cells) for (const c of w.grid.cellsInCap(p[0], p[1], p[2], 40 * w.grid.cellAngle)) crater.add(c);
    let differ = 0;
    for (let c = 0; c < w.cellCount; c++) {
      if (crater.has(c)) continue;
      expect(Math.abs(w.temperature[c]! - temp0[c]!)).toBeLessThan(0.01);
      if (w.biome[c] !== biome0[c] || w.ice[c] !== ice0[c]) differ++;
    }
    expect(differ).toBe(0);
    buildColors(w, full, undefined, undefined, core.disasters!.ground);
    expect(colors).toEqual(full);
  }, 60_000);

  it('recomposição das placas no meio do inverno: o frio vai por cima e a tela fica certa (B1, B2)', () => {
    let now = 0;
    const core = new SimulationCore(() => undefined, () => now);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 32 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.handle({ type: 'plateRate', rate: 1 });
    core.handle({ type: 'speed', speed: 20 });
    const w = core.world!;
    const recompositions = () => (core as unknown as { work: { recompositions: number } }).work.recompositions;
    const colors = (core as unknown as { colors: Uint8Array }).colors;
    const full = new Uint8Array(colors.length);
    let seen = recompositions();
    let last = 0;
    // Gigantes a cada 10 anos até uma recomposição chegar no meio do frio.
    for (let k = 0; ; k++) {
      if (k % 2 === 0) {
        core.handle({ type: 'disaster', kind: DisasterKind.Meteor, point: cellPoint(w, (k * 977) % w.cellCount), strength: 4 });
        last = core.clock.tick;
      }
      now += 250;
      core.advance(0.25);
      if (recompositions() > seen && w.climateOffset < -GIANT_WINTER.amount * 0.5) break;
      seen = recompositions();
      expect(k).toBeLessThan(600);
    }
    buildColors(w, full, undefined, undefined, core.disasters!.ground);
    expect(colors).toEqual(full);
    while (core.clock.tick < last + (GIANT_WINTER.years + 10) * TICKS_PER_YEAR) {
      now += 250;
      core.advance(0.25);
    }
    expect(Math.abs(w.climateOffset - glacialOffset(core.clock.tick))).toBeLessThan(0.01);
    buildColors(w, full, undefined, undefined, core.disasters!.ground);
    expect(colors).toEqual(full);
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

it('em terra a cratera não vira mar: o fundo fica acima do nível do mar', () => {
  const w = worldOf();
  // Terra baixa (100–400 m): a cratera grande (900 m) passaria do nível do mar.
  const c = [...Array(w.cellCount).keys()].find((x) => !w.isWater(x) && w.heightAboveSea(x) > 100 && w.heightAboveSea(x) < 400 && w.waterDistance[x]! > 8)!;
  const hit = impact(w, new Ground(w.cellCount), c, 3, 0, createRng(1));
  hit.terrainCells.forEach((x, k) => {
    if (!w.isWater(x)) expect(w.heightAboveSea(x) + hit.terrainDeltas[k]!).toBeGreaterThan(0);
  });
});

// P8 opção (b) (decisão do usuário, 2026-11-03): crateras no mesmo lugar somam o estrago, alargando e
// aprofundando, sem virar mar em terra. A área soma: raio novo = √(raio antigo² + raio do meteoro²).
describe('crateras sobrepostas somam (P8 b)', () => {
  const hitAt = (d: Disasters, w: WorldState, c: number, size: number, from: number) => {
    d.trigger(DisasterKind.Meteor, cellPoint(w, c), from, size);
    for (let t = from + 1; t <= from + ENTRY_TICKS + 2; t++) {
      const o = d.step(t, 0);
      // Aplica no relevo o que o desastre mudou (como o relógio faz).
      for (const ch of o?.terrain ?? []) ch.cells.forEach((x, k) => (w.elevation[x] = (w.elevation[x] as number) + (ch.deltas[k] as number)));
    }
  };
  const ring = (w: WorldState, c: number, from: number, to: number) => [...Array(w.cellCount).keys()].filter((x) => {
    const d = cellDistance(w, c, x);
    return d >= from && d <= to;
  });

  it('o segundo meteoro dentro da cratera alarga pela soma das áreas; em terra o fundo fica acima do mar', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 0;
    const c = inland(w);
    hitAt(d, w, c, 3, 0);
    expect(d.craters).toHaveLength(1);
    const r0 = CRATER_RADIUS[3]!;
    expect(d.craters[0]!.radius).toBe(r0);
    // A faixa que era a borda da primeira (r0 a 1,25·r0) antes do segundo:
    const band = ring(w, c, r0 * 1.05, Math.sqrt(r0 * r0 + r0 * r0) * 0.85);
    const before = band.map((x) => w.heightAboveSea(x));
    // Cai um pouco fora do centro, mas dentro da cratera.
    const inside = ring(w, c, 2, 3)[0]!;
    hitAt(d, w, inside, 3, 100);
    expect(d.craters).toHaveLength(1);
    expect(d.craters[0]!.radius).toBeCloseTo(Math.sqrt(2) * r0, 6);
    expect(d.craters[0]!.cell).toBe(c);
    // A cratera alargou: a antiga borda afundou.
    const after = band.map((x) => w.heightAboveSea(x));
    const lower = after.filter((h, k) => h < before[k]! - 50).length;
    expect(lower).toBeGreaterThan(band.length * 0.6);
    // Em terra continua terra.
    for (const x of ring(w, c, 0, d.craters[0]!.radius * 1.5)) if (!w.isWater(x)) expect(w.heightAboveSea(x)).toBeGreaterThan(0);
  });

  it('fora da cratera nasce outra; a antiga não muda', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 0;
    const c = inland(w);
    hitAt(d, w, c, 2, 0);
    const far = ring(w, c, 30, 31).find((x) => !w.isWater(x))!;
    hitAt(d, w, far, 2, 100);
    expect(d.craters).toHaveLength(2);
    expect(d.craters[0]!.radius).toBe(CRATER_RADIUS[2]);
  });

  it('a cratera anda com a placa (o centro acompanha a recomposição)', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 0;
    const c = inland(w);
    hitAt(d, w, c, 2, 0);
    // Recomposição sintética: cada célula vai para a vizinha de índice + 7.
    const n = w.cellCount;
    d.remap((x) => x, (x) => (x - 7 + n) % n);
    expect(d.craters[0]!.cell).toBe((c + 7) % n);
  });
});
