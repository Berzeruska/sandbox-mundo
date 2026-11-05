import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind } from '../../src/world/disasters';
import { CellState, Ground, hasVegetation } from '../../src/world/disasters/ground';
import { crackLength, damageRadius, quakeDamage, SLIDE_MIN_DROP } from '../../src/world/disasters/quake-damage';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Célula de terra com mais encostas íngremes em volta (montanha com vales). */
function steepSpot(world: WorldState): number {
  const { neighbors } = world.grid;
  const drop = (c: number) => Math.max(...[0, 1, 2, 3].map((d) => world.elevation[c]! - world.elevation[neighbors[c * 4 + d]!]!));
  let best = -1;
  let score = -1;
  for (let c = 0; c < world.cellCount; c += 7) {
    if (world.isWater(c) || world.heightAboveSea(c) < 300) continue;
    const p = cellPoint(world, c);
    let s = 0;
    for (const j of world.grid.cellsInCap(p[0], p[1], p[2], 6 * world.grid.cellAngle)) if (!world.isWater(j) && drop(j) > SLIDE_MIN_DROP) s++;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

describe('terremoto (R5)', () => {
  it('raio do estrago e fenda pela magnitude (tabela da especificação)', () => {
    expect([6, 7, 8, 9, 9.5].map(damageRadius)).toEqual([1, 3, 5, 8, 11]);
    expect([7, 8, 9, 9.5].map(crackLength)).toEqual([6, 12, 24, 32]);
    expect(crackLength(6)).toBe(0);
    expect(damageRadius(5.5)).toBe(0);
  });

  it('quanto maior a magnitude, maior a fenda e a área atingida', () => {
    const w = worldOf();
    const c = steepSpot(w);
    const sizes = [7, 8, 9, 9.5].map((m) => {
      const d = quakeDamage(w, new Ground(w.cellCount), c, m, 0, createRng(3));
      return { crack: d.crack.size, zone: d.zone.length };
    });
    for (let k = 1; k < sizes.length; k++) {
      expect(sizes[k]!.crack).toBeGreaterThan(sizes[k - 1]!.crack);
      expect(sizes[k]!.zone).toBeGreaterThan(sizes[k - 1]!.zone);
    }
  });

  it('deslizamento só em encosta: começa numa célula íngreme e desce', () => {
    const w = worldOf();
    const c = steepSpot(w);
    const g = new Ground(w.cellCount);
    const d = quakeDamage(w, g, c, 9.5, 0, createRng(5));
    expect(d.slides.length).toBeGreaterThan(2);
    const { neighbors } = w.grid;
    for (const s of d.slides) {
      const top = s.path[0]!;
      const drop = Math.max(...[0, 1, 2, 3].map((k) => w.elevation[top]! - w.elevation[neighbors[top * 4 + k]!]!));
      expect(drop).toBeGreaterThan(SLIDE_MIN_DROP);
      // Sempre descendo.
      for (let k = 1; k < s.path.length; k++) expect(w.elevation[s.path[k]!]!).toBeLessThan(w.elevation[s.path[k - 1]!]!);
      // A fenda passa por cima do deslizamento quando se cruzam.
      for (const x of s.cells) expect([CellState.Slide, CellState.Crack]).toContain(g.state[x]);
    }
    // Vegetação do raio perdeu parte (20–60%) e a fenda está marcada.
    const veg = d.zone.filter((x) => hasVegetation(w.biome[x]!) && !w.isWater(x) && g.state[x] !== CellState.Slide);
    for (const x of veg) expect(g.cover[x]).toBeLessThan(0.86);
    expect([...d.crack.keys()].some((x) => g.state[x] === CellState.Crack)).toBe(true);
  });

  it('o deslizamento muda o relevo para sempre (anda com a placa como o pincel)', () => {
    const core = new SimulationCore(() => undefined, () => 0);
    core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
    core.handle({ type: 'disasterFrequency', level: 0 });
    const w = core.world!;
    const c = steepSpot(w);
    const before = w.elevation.slice();
    core.handle({ type: 'disaster', kind: DisasterKind.Quake, point: cellPoint(w, c), strength: 9.5 });
    let lowered = 0;
    for (let x = 0; x < w.cellCount; x++) if (w.elevation[x]! < before[x]! - 5) lowered++;
    expect(lowered).toBeGreaterThan(0);
    const after = w.elevation.slice();
    // Décadas depois (placas paradas), o relevo continua como ficou; a fenda some em ~50 anos.
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    while (core.clock.tick < 60 * TICKS_PER_YEAR) core.advance(0.25);
    expect(w.elevation).toEqual(after);
    expect([...core.disasters!.ground.active].some((x) => core.disasters!.ground.state[x] === CellState.Crack)).toBe(false);
  });

  // Teste da `58f53e7` (F2): "o buraco do terremoto some quando o continente anda". Pelo desenho (R5 e
  // base comum 4), o que fica para sempre é a encosta mais baixa, gravada na placa como o pincel: ela
  // tem que andar com a placa e continuar lá depois das recomposições. A fenda e as cicatrizes dos
  // deslizamentos são marcas temporárias (fenda ~50 anos, deslizamentos 20–40 anos).
  it('a encosta rebaixada anda com a placa e continua rebaixada depois das recomposições (F2)', () => {
    // Dois mundos iguais com as placas andando; só um leva o terremoto. Perto da fronteira a tectônica
    // também mexe no relevo: a comparação é com o mesmo ponto da crosta no mundo sem terremoto.
    const make = () => {
      const box = { recomposed: 0 };
      const core = new SimulationCore((msg) => {
        if (msg.type === 'recomposed') box.recomposed++;
      }, () => 0);
      core.handle({ type: 'newWorld', seedText: 'terra', n: 64 });
      core.handle({ type: 'disasterFrequency', level: 0 });
      return { core, box };
    };
    const a = make();
    const b = make();
    const w = a.core.world!;
    const n = w.cellCount;
    const keyOf = (core: SimulationCore, c: number) => core.world!.plate[c]! * n + (core as unknown as { cellRef: Int32Array }).cellRef[c]!;
    const c = steepSpot(w);
    const before = w.elevation.slice();
    a.core.handle({ type: 'disaster', kind: DisasterKind.Quake, point: cellPoint(w, c), strength: 9.5 });
    const lowered = new Map<number, number>();
    for (let x = 0; x < n; x++) if (w.elevation[x]! < before[x]! - 5) lowered.set(keyOf(a.core, x), before[x]! - w.elevation[x]!);
    expect(lowered.size).toBeGreaterThan(0);
    const start = new Set([...Array(n).keys()].filter((x) => lowered.has(keyOf(a.core, x))));
    for (const { core } of [a, b]) {
      core.handle({ type: 'plateRate', rate: 1 });
      core.handle({ type: 'speed', speed: 20 });
    }
    while (a.box.recomposed < 3 && a.core.clock.tick < 40000) {
      a.core.advance(0.25);
      b.core.advance(0.25);
    }
    expect(a.box.recomposed).toBe(3);
    expect(b.core.clock.tick).toBe(a.core.clock.tick);
    // Onde cada ponto rebaixado está agora: mais baixo que o mesmo ponto no mundo sem terremoto, por pelo
    // menos metade do que desceu (a erosão e o alisamento das recomposições gastam um pouco), em 90% dos
    // pontos (na fronteira a própria tectônica pode refazer o relevo).
    const elsewhere = new Map<number, number>();
    for (let x = 0; x < n; x++) elsewhere.set(keyOf(b.core, x), b.core.world!.elevation[x]!);
    let found = 0;
    let moved = 0;
    const ratios: number[] = [];
    for (let x = 0; x < n; x++) {
      const drop = lowered.get(keyOf(a.core, x));
      const ref = elsewhere.get(keyOf(a.core, x));
      if (drop === undefined || ref === undefined) continue;
      found++;
      if (!start.has(x)) moved++;
      ratios.push(+((ref - w.elevation[x]!) / drop).toFixed(2));
    }
    expect(found).toBeGreaterThan(lowered.size * 0.8);
    expect(ratios.filter((r) => r >= 0.5).length).toBeGreaterThanOrEqual(found * 0.9);
    expect(moved).toBeGreaterThan(0);
  });
});
