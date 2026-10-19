import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { createWorld } from '../../src/world/create';
import { CellState, Ground } from '../../src/world/disasters/ground';
import { inlandReach, planTsunami, TsunamiProcess, tsunamiRunup } from '../../src/world/disasters/tsunami';
import type { DisasterOutcome } from '../../src/world/disasters';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Mar fundo a ~6 células de uma costa baixa e larga. */
function offshore(world: WorldState): number {
  const { neighbors } = world.grid;
  let best = -1;
  let score = -1;
  for (let c = 0; c < world.cellCount; c += 3) {
    if (!world.isWater(c) || world.heightAboveSea(c) > -1500) continue;
    // Terra baixa a até 8 passos.
    let low = 0;
    let frontier = [c];
    const seen = new Set(frontier);
    for (let s = 0; s < 8; s++) {
      const next: number[] = [];
      for (const x of frontier) for (let d = 0; d < 4; d++) {
        const j = neighbors[x * 4 + d]!;
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        if (!world.isWater(j) && world.heightAboveSea(j) < 60) low++;
      }
      frontier = next;
    }
    if (low > score) {
      score = low;
      best = c;
    }
  }
  return best;
}

/** Roda o tsunami inteiro e devolve o relevo mudado. */
function runAll(world: WorldState, ground: Ground, start: number, m: number): DisasterOutcome['terrain'] {
  const plan = planTsunami(world, start, m);
  const p = new TsunamiProcess(ground, plan, m, 0, createRng(1));
  const out: DisasterOutcome = { events: [], marked: [], uplifts: [], terrain: [], ice: [], winters: [] };
  let tick = 1;
  for (; tick < 2000; tick++) {
    ground.expire(tick, TICKS_PER_YEAR);
    if (!p.step(tick, out)) break;
  }
  // A água termina de voltar (a lama dura 15–30 anos: bem mais que isso).
  for (const end = tick + 30; tick < end; tick++) ground.expire(tick, TICKS_PER_YEAR);
  return out.terrain;
}

describe('tsunami (R6)', () => {
  it('alcance em terra pela magnitude (tabela aprovada) e mais costa atingida quanto maior', () => {
    expect([7.5, 8, 8.5, 9, 9.5].map(inlandReach)).toEqual([3, 6, 10, 17, 28]);
    expect([7.5, 8, 8.5, 9, 9.5].map(tsunamiRunup)).toEqual([20, 40, 60, 90, 140]);
    const w = worldOf();
    const s = offshore(w);
    const land = [7.5, 8.5, 9.5].map((m) => planTsunami(w, s, m));
    for (const [k, m] of [7.5, 8.5, 9.5].entries()) {
      for (const step of land[k]!.landSteps) expect(step).toBeLessThan(inlandReach(m));
    }
    expect(land[1]!.land.length).toBeGreaterThan(land[0]!.land.length);
    expect(land[2]!.land.length).toBeGreaterThan(land[1]!.land.length);
    expect(Math.max(...land[2]!.landSteps)).toBeGreaterThan(Math.max(...land[0]!.landSteps));
  });

  it('para em terreno alto: nenhuma célula coberta é mais alta que a onda ali', () => {
    const w = worldOf();
    const plan = planTsunami(w, offshore(w), 9.5);
    plan.land.forEach((c, k) => {
      const limit = tsunamiRunup(9.5) * (1 - 0.6 * plan.landTimes[k]!) * (1 - plan.landSteps[k]! / plan.inland);
      expect(w.heightAboveSea(c)).toBeLessThan(limit);
    });
  });

  it('toda célula alcançada perde a vegetação e vira lama; a costa é raspada para sempre', () => {
    const w = worldOf();
    const g = new Ground(w.cellCount);
    const s = offshore(w);
    const plan = planTsunami(w, s, 9);
    expect(plan.land.length).toBeGreaterThan(20);
    expect(plan.seabed.length).toBeGreaterThan(0);
    const terrain = runAll(w, g, s, 9);
    for (const c of plan.land) {
      expect(g.cover[c]).toBe(0);
      expect(g.state[c]).toBe(CellState.Mud);
    }
    expect(terrain.length).toBe(1);
    const t = terrain[0]!;
    expect(t.cells.length).toBeGreaterThan(0);
    for (const d of t.deltas) {
      expect(d).toBeLessThan(0);
      expect(d).toBeGreaterThanOrEqual(-20);
    }
    // O mar recuou e a espuma passou: nada disso fica.
    for (const c of plan.band) expect([CellState.None]).toContain(g.state[c]);
  });
});
