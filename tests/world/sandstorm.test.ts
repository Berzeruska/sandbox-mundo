import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { windAt } from '../../src/world/disasters/fire';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { Biome } from '../../src/world/biomes';
import { DESERTS, isDusty, MIN_DUST_RADIUS, START_ROOM, PLAYER_SAND_RADIUS, SAND_RADIUS, SAND_TICKS, SandstormProcess } from '../../src/world/disasters/sandstorm';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Distância (passos) de cada célula até a borda do seu deserto. */
function desertDepth(world: WorldState): Int32Array {
  const depth = new Int32Array(world.cellCount).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < world.cellCount; c++) {
    if (DESERTS.has(world.biome[c]!) && !world.isWater(c) && !world.ice[c]) continue;
    depth[c] = 0;
    frontier.push(c);
  }
  for (let s = 1; frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = world.grid.neighbors[c * 4 + d]!;
        if (depth[j] !== -1) continue;
        depth[j] = s;
        next.push(j);
      }
    }
    frontier = next;
  }
  return depth;
}

/** Miolo de deserto (o ponto mais longe da borda) do tipo pedido. */
function desertCore(world: WorldState, biome: number): number {
  const depth = desertDepth(world);
  let best = -1;
  for (let c = 0; c < world.cellCount; c++) if (world.biome[c] === biome && (best < 0 || depth[c]! > depth[best]!)) best = c;
  return best;
}

/** Centros de tempestade fora da areia seca (deserto, seca ou areia), contando só os que existem. */
function centersOffSand(world: WorldState, d: Disasters): number {
  return d.dustViews().filter((v) => {
    const c = world.grid.pointToCell(...v.point);
    const s = d.ground.state[c];
    return world.isWater(c) || world.ice[c] || (!DESERTS.has(world.biome[c]!) && s !== CellState.Heat && s !== CellState.Sand);
  }).length;
}

describe('tempestade de areia (C12)', () => {
  it('maior que a proposta: raio 10–24 (jogador 18–24)', () => {
    expect(SAND_RADIUS).toEqual([10, 24]);
    expect(PLAYER_SAND_RADIUS).toEqual([18, 24]);
  });

  it('anda com o vento e deixa areia só fora do deserto, que some em alguns anos', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const start = desertCore(w, Biome.ColdDesert);
    // Seca (calor) em volta: a vegetação seca de fora do deserto recebe a areia.
    const sp = cellPoint(w, start);
    for (const c of w.grid.cellsInCap(sp[0], sp[1], sp[2], 40 * w.grid.cellAngle)) {
      if (!w.isWater(c) && !w.ice[c] && !DESERTS.has(w.biome[c]!)) g.setState(c, CellState.Heat, 0, 50, TICKS_PER_YEAR, 1);
    }
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
    expect(sand.length).toBeGreaterThan(0);
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

  it('a natural nasce e anda só sobre areia seca (deserto ou seca), e a areia só cai em lugar seco (E4)', () => {
    const w = worldOf('terra', 128);
    const d = new Disasters(w);
    d.frequency = 4;
    let born = 0;
    let wet = 0;
    for (let t = 1; t <= 300 * TICKS_PER_YEAR; t++) {
      for (const e of d.step(t, 0)?.events ?? []) {
        if (e.kind !== DisasterKind.Sandstorm) continue;
        born++;
        const c = w.grid.pointToCell(...e.point);
        expect(isDusty(w, d.ground, c)).toBe(true);
      }
      wet += centersOffSand(w, d);
    }
    expect(born).toBeGreaterThan(0);
    expect(wet).toBe(0);
    // Areia deixada só em terra que não é deserto e estava seca (calor da seca).
    for (const c of d.ground.active) if (d.ground.state[c] === CellState.Sand) expect(w.isWater(c) || DESERTS.has(w.biome[c]!)).toBe(false);
  });

  it('o jogador provoca só em areia ou seca; fora disso, nada', () => {
    const w = worldOf('terra', 256);
    const d = new Disasters(w);
    d.frequency = 0;
    const desert = desertCore(w, Biome.ColdDesert);
    expect(d.trigger(DisasterKind.Sandstorm, cellPoint(w, desert), 0).events.map((e) => e.kind)).toEqual([DisasterKind.Sandstorm]);
    expect(d.dustViews().length).toBe(1);
    for (let t = 1; t < 200; t++) {
      d.step(t, 0);
      expect(centersOffSand(w, d)).toBe(0);
    }
    // Floresta longe de deserto e seca, e o mar: nada acontece.
    const far = [...Array(w.cellCount).keys()].find((c) => {
      if (w.isWater(c) || DESERTS.has(w.biome[c]!)) return false;
      const p = cellPoint(w, c);
      return w.grid.cellsInCap(p[0], p[1], p[2], 8 * w.grid.cellAngle).every((x) => !DESERTS.has(w.biome[x]!));
    })!;
    const sea = [...Array(w.cellCount).keys()].find((c) => w.waterDistance[c] === 0 && w.elevation[c]! < -3000)!;
    const d2 = new Disasters(w);
    d2.frequency = 0;
    expect(d2.trigger(DisasterKind.Sandstorm, cellPoint(w, far), 0).events).toEqual([]);
    expect(d2.trigger(DisasterKind.Sandstorm, cellPoint(w, sea), 0).events).toEqual([]);
    expect(MIN_DUST_RADIUS).toBeGreaterThan(0);
  });

  // Teste da `58f53e7`: "no deserto quente não funciona". No jogo (N = 256), tocar em qualquer deserto
  // quente ou frio com areia seca em volta faz a tempestade, que anda só sobre areia
  // seca e dura o desenhado (6–15 s em 1×).
  it.each(['pangeia', 'terra', 'mundo'])('no jogo (N = 256, %s): tocar no deserto quente ou frio faz a tempestade de 6–15 s, só sobre areia seca', (seed) => {
    const w = worldOf(seed, 256);
    const depth = desertDepth(w);
    const fits = START_ROOM * 2;
    for (const biome of [Biome.HotDesert, Biome.ColdDesert]) {
      const taps = [...Array(w.cellCount).keys()].filter((c) => w.biome[c] === biome && depth[c]! >= fits);
      expect(taps.length).toBeGreaterThan(0);
      for (let k = 0; k < 12; k++) {
        const c = taps[Math.floor(((k + 0.5) / 12) * taps.length)]!;
        const d = new Disasters(w);
        d.frequency = 0;
        expect(d.trigger(DisasterKind.Sandstorm, cellPoint(w, c), 0).events.map((e) => e.kind)).toEqual([DisasterKind.Sandstorm]);
        let t = 0;
        while (d.dustViews().length) {
          expect(centersOffSand(w, d)).toBe(0);
          d.step(++t, 0);
        }
        expect(t).toBeGreaterThanOrEqual(SAND_TICKS[0]);
        expect(t).toBeLessThanOrEqual(SAND_TICKS[1]);
      }
    }
  });

  it('só a areia seca em terra sem gelo é poeira', () => {
    const w = worldOf('terra', 128);
    const g = new Ground(w.cellCount);
    for (let c = 0; c < w.cellCount; c++) {
      const dry = !w.isWater(c) && !w.ice[c] && DESERTS.has(w.biome[c]!);
      expect(isDusty(w, g, c)).toBe(dry);
    }
  });
});
