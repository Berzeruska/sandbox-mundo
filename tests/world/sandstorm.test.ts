import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { windAt } from '../../src/world/disasters/fire';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { Biome } from '../../src/world/biomes';
import { COARSE_POWER, DESERTS, isDusty, PLAYER_SAND_RADIUS, SAND_DECAY_CELLS, SAND_END_POWER, SAND_RADIUS, SAND_TICKS, SandstormProcess, START_ROOM } from '../../src/world/disasters/sandstorm';
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

/** Distância (passos) de cada célula até a areia seca mais perto (0 na areia). */
function sandDistance(world: WorldState, g: Ground): Int32Array {
  const dist = new Int32Array(world.cellCount).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < world.cellCount; c++) {
    if (!isDusty(world, g, c)) continue;
    dist[c] = 0;
    frontier.push(c);
  }
  for (let s = 1; frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = world.grid.neighbors[c * 4 + d]!;
        if (dist[j] !== -1) continue;
        dist[j] = s;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Caminho da tempestade (pontos e força), lido por dentro. */
const pathOf = (p: SandstormProcess) => p as unknown as { points: [number, number, number][]; power: number[] };

/** Células andadas fora da areia até a força cair abaixo do fim (o máximo pelo desenho). */
const MAX_OUT_CELLS = SAND_DECAY_CELLS * Math.log(1 / SAND_END_POWER) + 1;
/** Até onde a areia grossa cai: a força passa de COARSE_POWER, mais o alcance do estrago. */
const COARSE_CELLS = SAND_DECAY_CELLS * Math.log(1 / COARSE_POWER);

describe('tempestade de areia (C12)', () => {
  it('maior que a proposta: raio 10–24 (jogador 18–24)', () => {
    expect(SAND_RADIUS).toEqual([10, 24]);
    expect(PLAYER_SAND_RADIUS).toEqual([18, 24]);
  });

  it('anda com o vento e deixa areia fora do deserto, que some em alguns anos (o deserto não avança)', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const start = desertCore(w, Biome.ColdDesert);
    const p = new SandstormProcess(w, g, start, 14, createRng(2), 0, 0);
    const first = p.view()!.point;
    let tick = 0;
    while (p.step(++tick));
    // Andou no sentido do vento do lugar onde nasceu.
    const wind = windAt(w, start);
    const last = pathOf(p).points.at(-1)!;
    const moved = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
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
});

// B4 (decisão do usuário, 2026-11-03, revertendo a E4): a tempestade é uma corrente de ar que levanta
// areia. Passa da borda do deserto (também por cima do mar) e vai perdendo força até se desfazer logo
// depois; a areia grossa cai perto, a poeira fina vai mais longe.
describe('tempestade de areia passando da borda (B4)', () => {
  // Desertos de várias sementes; de cada um, tempestades com sorteios diferentes.
  const runs = (['pangeia', 'terra', 'mundo'] as const).flatMap((seed) => {
    const w = worldOf(seed, 128);
    const depth = desertDepth(w);
    const taps = [...Array(w.cellCount).keys()].filter((c) => DESERTS.has(w.biome[c]!) && depth[c]! >= START_ROOM && depth[c]! <= 8);
    return [0, 1, 2, 3, 4, 5].map((k) => ({ w, start: taps[Math.floor(((k + 0.5) / 6) * taps.length)]!, k }));
  });

  it('passa da borda e se desfaz logo depois de sair da areia, com a força caindo fora dela', () => {
    let left = 0;
    for (const { w, start, k } of runs) {
      const g = new Ground(w.cellCount);
      const p = new SandstormProcess(w, g, start, 14, createRng(10 + k), 0, 0);
      const { points, power } = pathOf(p);
      let out = 0;
      let outside = false;
      points.forEach((pt, i) => {
        const c = w.grid.pointToCell(...pt);
        if (isDusty(w, g, c)) {
          out = 0;
          return;
        }
        outside = true;
        out += 0.5;
        // Fora da areia a força só cai.
        if (i > 0 && !isDusty(w, g, w.grid.pointToCell(...points[i - 1]!))) expect(power[i]!).toBeLessThan(power[i - 1]!);
      });
      if (outside) left++;
      // Termina no máximo MAX_OUT_CELLS células depois de sair.
      expect(out).toBeLessThanOrEqual(MAX_OUT_CELLS);
    }
    // Ela sai mesmo: nas tempestades perto da borda, a maioria passa dela.
    expect(left).toBeGreaterThan(runs.length / 2);
  });

  it('a areia grossa cai perto da borda; a poeira fina vai mais longe', () => {
    let farther = 0;
    for (const { w, start, k } of runs) {
      const g = new Ground(w.cellCount);
      const p = new SandstormProcess(w, g, start, 14, createRng(10 + k), 0, 0);
      let tick = 0;
      while (p.step(++tick));
      const dist = sandDistance(w, new Ground(w.cellCount));
      const reach = 14 * 0.8 + 1;
      for (const c of g.active) {
        if (g.state[c] !== CellState.Sand) continue;
        // `dist` conta passos entre vizinhas (em escada): até √2 vezes a distância em linha reta.
        expect(dist[c]!).toBeLessThanOrEqual((COARSE_CELLS + reach) * Math.SQRT2);
      }
      // O fim do desenho (poeira fina) passa do ponto mais longe onde a areia grossa caiu.
      const end = dist[w.grid.pointToCell(...pathOf(p).points.at(-1)!)]!;
      if (end > COARSE_CELLS) farther++;
    }
    expect(farther).toBeGreaterThan(0);
  });

  it('a natural nasce em areia seca; a areia cai só em terra com vegetação fora do deserto', () => {
    const w = worldOf('terra', 128);
    const d = new Disasters(w);
    d.frequency = 4;
    let born = 0;
    for (let t = 1; t <= 300 * TICKS_PER_YEAR; t++) {
      for (const e of d.step(t, 0)?.events ?? []) {
        if (e.kind !== DisasterKind.Sandstorm) continue;
        born++;
        expect(isDusty(w, d.ground, w.grid.pointToCell(...e.point))).toBe(true);
      }
    }
    expect(born).toBeGreaterThan(0);
    for (const c of d.ground.active) if (d.ground.state[c] === CellState.Sand) expect(w.isWater(c) || DESERTS.has(w.biome[c]!)).toBe(false);
  });

  it('o jogador provoca só em areia ou seca; fora disso, nada', () => {
    const w = worldOf('terra', 256);
    const d = new Disasters(w);
    d.frequency = 0;
    const desert = desertCore(w, Biome.ColdDesert);
    expect(d.trigger(DisasterKind.Sandstorm, cellPoint(w, desert), 0).events.map((e) => e.kind)).toEqual([DisasterKind.Sandstorm]);
    expect(d.dustViews().length).toBe(1);
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
  });

  // Teste da `58f53e7`: "no deserto quente não funciona". No jogo (N = 256), tocar em qualquer deserto
  // quente ou frio com areia seca em volta faz a tempestade: 6–15 s em 1× sobre a areia, ou menos se ela
  // sai do deserto e se desfaz.
  it.each(['pangeia', 'terra', 'mundo'])('no jogo (N = 256, %s): tocar no deserto quente ou frio faz a tempestade', (seed) => {
    const w = worldOf(seed, 256);
    const depth = desertDepth(w);
    for (const biome of [Biome.HotDesert, Biome.ColdDesert]) {
      const taps = [...Array(w.cellCount).keys()].filter((c) => w.biome[c] === biome && depth[c]! >= START_ROOM * 2);
      expect(taps.length).toBeGreaterThan(0);
      for (let k = 0; k < 12; k++) {
        const c = taps[Math.floor(((k + 0.5) / 12) * taps.length)]!;
        const d = new Disasters(w);
        d.frequency = 0;
        expect(d.trigger(DisasterKind.Sandstorm, cellPoint(w, c), 0).events.map((e) => e.kind)).toEqual([DisasterKind.Sandstorm]);
        let t = 0;
        let onSand = 0;
        let left = false;
        while (d.dustViews().length) {
          const v = d.dustViews()[0]!;
          if (isDusty(w, d.ground, w.grid.pointToCell(...v.point))) onSand++;
          else left = true;
          d.step(++t, 0);
        }
        if (!left) expect(t).toBeGreaterThanOrEqual(SAND_TICKS[0]);
        expect(onSand).toBeLessThanOrEqual(SAND_TICKS[1]);
        expect(t).toBeLessThanOrEqual(SAND_TICKS[1] + MAX_OUT_CELLS / 0.5 + 1);
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
