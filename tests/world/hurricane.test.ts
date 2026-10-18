import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { Ground, hasVegetation } from '../../src/world/disasters/ground';
import { damageRadius, HurricaneProcess, MAX_PER_QUADRANT, quadrantOf, stormName } from '../../src/world/disasters/hurricane';
import type { WorldState } from '../../src/world/state';

const worldOf = (seed = 'terra', n = 64) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Mar quente tropical encostado em terra a oeste (o furacão anda para oeste e entra nela). */
function tropicalSea(world: WorldState): number[] {
  const out: number[] = [];
  for (let c = 0; c < world.cellCount; c++) {
    if (!world.isWater(c) || world.ice[c]) continue;
    const lat = Math.abs(Math.asin(world.grid.positions[c * 3 + 1]!)) * (180 / Math.PI);
    if (lat >= 9 && lat <= 19 && world.temperature[c]! >= 26) out.push(c);
  }
  return out;
}

describe('furacão e ciclone (R8)', () => {
  it('nome pela categoria: 1–2 ciclone, 3–5 furacão; estrago de 2 a 5 células', () => {
    expect([1, 2, 3, 4, 5].map(stormName)).toEqual(['Ciclone', 'Ciclone', 'Furacão', 'Furacão', 'Furacão']);
    expect([1, 2, 3, 4, 5].map(damageRadius)).toEqual([2, 2, 3, 4, 5]);
  });

  it('no máximo 2 por quadrante, mesmo em "Muitos"', () => {
    const w = worldOf();
    const d = new Disasters(w);
    d.frequency = 4;
    let maxPerQuadrant = 0;
    for (let t = 1; t <= 3000 * 12; t++) {
      d.step(t, 0);
      if (t % 12) continue;
      const count = [0, 0, 0, 0];
      for (const v of d.stormViews()) count[quadrantOf(v.point)]!++;
      maxPerQuadrant = Math.max(maxPerQuadrant, ...count);
    }
    expect(maxPerQuadrant).toBeGreaterThan(0);
    expect(maxPerQuadrant).toBeLessThanOrEqual(MAX_PER_QUADRANT);
  }, 60_000);

  it('o estrago fica no raio: vegetação só cai perto do caminho', () => {
    const w = worldOf('terra', 128);
    const g = new Ground(w.cellCount);
    const seas = tropicalSea(w);
    // Um que toque terra.
    let h: HurricaneProcess | null = null;
    for (const s of seas) {
      const p = new HurricaneProcess(w, g, createRng(s), s, 4, 0, 0, { flood: () => undefined, ignite: () => undefined });
      if (p.track.landfall) {
        h = p;
        break;
      }
    }
    expect(h).not.toBeNull();
    const centers: { p: number[]; r: number }[] = [];
    for (let t = 1; ; t++) {
      const v = h!.view();
      if (v) centers.push({ p: v.point, r: damageRadius(h!.category) });
      if (!h!.step(t)) break;
    }
    let damaged = 0;
    for (const c of g.active) {
      if (!hasVegetation(w.biome[c]!) || g.cover[c]! >= 1) continue;
      damaged++;
      const p = cellPoint(w, c);
      const near = centers.some((x) => Math.acos(Math.min(1, x.p[0]! * p[0] + x.p[1]! * p[1] + x.p[2]! * p[2])) <= (x.r + 0.5) * w.grid.cellAngle);
      expect(near).toBe(true);
    }
    expect(damaged).toBeGreaterThan(5);
  });

  it('raio do jogador num furacão vira furacão de fogo; em terra ele acende a vegetação do miolo', () => {
    const w = worldOf('terra', 128);
    const d = new Disasters(w);
    d.frequency = 0;
    const seas = tropicalSea(w);
    let sea = -1;
    for (const s of seas) {
      const p = new HurricaneProcess(w, new Ground(w.cellCount), createRng(1), s, 4, 0, 0, { flood: () => undefined, ignite: () => undefined });
      if (p.track.landfall) {
        sea = s;
        break;
      }
    }
    d.trigger(DisasterKind.Hurricane, cellPoint(w, sea), 0, 4);
    const v = d.stormViews()[0]!;
    expect(v.fire).toBe(false);
    d.trigger(DisasterKind.Lightning, v.point, 0);
    expect(d.stormViews()[0]!.fire).toBe(true);
    let burning = 0;
    for (let t = 1; t < 400 && d.stormViews().length; t++) {
      d.step(t, 0);
      for (const c of d.ground.active) if (d.ground.state[c] === 1) burning++;
    }
    expect(burning).toBeGreaterThan(0);
  });
});
