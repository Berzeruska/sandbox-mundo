import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { cellPoint, DisasterKind, Disasters } from '../../src/world/disasters';
import { Ground, hasVegetation } from '../../src/world/disasters/ground';
import { damageRadius, HurricaneProcess, MAX_PER_QUADRANT, stormName } from '../../src/world/disasters/hurricane';
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
      // Pelo quadrante em que nasceu (andando, ele pode atravessar para o vizinho).
      for (const v of d.stormViews()) count[v.quadrant]!++;
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
      const p = new HurricaneProcess(w, g, createRng(s), s, 4, 0, 0, false, { flood: () => undefined });
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

  it('o furacão do jogador aparece sempre: longe do mar, nasce mesmo assim; segura a categoria (C3)', () => {
    const w = worldOf('terra', 128);
    const d = new Disasters(w);
    d.frequency = 0;
    // Miolo de continente.
    let inland = -1;
    for (let c = 0; c < w.cellCount; c++) if (!w.isWater(c) && (inland < 0 || w.waterDistance[c]! > w.waterDistance[inland]!)) inland = c;
    d.trigger(DisasterKind.Hurricane, cellPoint(w, inland), 0, 3);
    expect(d.stormViews().length).toBe(1);
    // No mar frio, o do jogador não perde força.
    const cold = [...Array(w.cellCount).keys()].find((c) => w.isWater(c) && !w.ice[c] && w.temperature[c]! < 10)!;
    const d2 = new Disasters(worldOf('terra', 128));
    d2.trigger(DisasterKind.Hurricane, cellPoint(w, cold), 0, 4);
    for (let t = 1; t <= 60; t++) d2.step(t, 0);
    expect(d2.stormViews().length).toBe(1);
  });
});

describe('duração do furacão do jogador tocando em terra perto da costa (E7, teste da d644319)', () => {
  it('o Ciclone 1 dura o mesmo que o Ciclone 2 (aprovado); do 3 ao 5, cada vez mais, até os 24 s', () => {
    const w = worldOf('terra', 128);
    // Terra tropical a até 6 células do mar (onde o jogador tocou no teste).
    const coast: number[] = [];
    for (let c = 0; c < w.cellCount && coast.length < 6; c += 211) {
      if (w.isWater(c) || Math.abs(Math.asin(w.grid.positions[c * 3 + 1]!)) > 0.35) continue;
      const d = w.waterDistance[c]!;
      if (d >= 1 && d <= 6) coast.push(c);
    }
    expect(coast.length).toBeGreaterThan(2);
    const life = (cell: number, cat: number): number => {
      const d = new Disasters(w);
      d.frequency = 0;
      d.trigger(DisasterKind.Hurricane, cellPoint(w, cell), 0, cat);
      let t = 0;
      while (d.stormViews().length && t < 1000) d.step(++t, 0);
      return t;
    };
    for (const c of coast) {
      const l = [1, 2, 3, 4, 5].map((cat) => life(c, cat));
      expect(l[0]!, `célula ${c}`).toBeGreaterThanOrEqual(l[1]!);
      for (let k = 2; k < 5; k++) expect(l[k]!, `célula ${c}`).toBeGreaterThanOrEqual(l[k - 1]!);
      // Furacão 5: pelo menos 12 s a mais que o Ciclone 2 em terra, até o teto de 24 s (288 passos).
      expect(l[4]!, `célula ${c}`).toBeGreaterThanOrEqual(Math.min(288, l[1]! + 144));
    }
  });
});
