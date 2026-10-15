import { describe, expect, it } from 'vitest';
import { applyBrush, Tool } from '../../src/input/tools';
import { Biome } from '../../src/world/biomes';
import { computeWaterDistance, updateClimate } from '../../src/world/climate';
import { createWorld } from '../../src/world/create';
import { CubeSphere, latLonToPoint } from '../../src/world/cubesphere';
import { WorldState } from '../../src/world/state';
import { dirtyRects } from '../../src/render/dirty';

const grid = new CubeSphere(64);
const params = { seedText: 't', seed: 7, n: 64, seaLevel: 0, landFraction: 0.3 };
const p = latLonToPoint(0.3, 0.5);
const center = grid.pointToCell(p[0], p[1], p[2]);

/** Mundo de terra plana com um oceano a oeste, já com clima. */
const landWorld = () => {
  const w = new WorldState(params, grid);
  w.elevation.fill(200);
  computeWaterDistance(w);
  updateClimate(w);
  return w;
};

describe('pincéis', () => {
  it('elevar sobe o centro mais que a borda e esfria o topo', () => {
    const w = landWorld();
    const t0 = w.temperature[center]!;
    for (let i = 0; i < 60; i++) applyBrush(w, Tool.Raise, p, 6, 1 / 60);
    expect(w.elevation[center]).toBeGreaterThan(2000);
    expect(w.temperature[center]).toBeLessThan(t0 - 10);
    const edge = grid.cellsInCap(p[0], p[1], p[2], grid.cellAngle * 5.5).find((c) => w.elevation[c]! < w.elevation[center]!)!;
    expect(edge).toBeDefined();
  });

  it('montanha pintada vira montanha (bioma reage)', () => {
    const w = landWorld();
    for (let i = 0; i < 120; i++) applyBrush(w, Tool.Raise, p, 4, 1 / 60);
    expect([Biome.Mountain, Biome.SnowyPeak]).toContain(w.biome[center]);
  });

  it('rebaixar desce', () => {
    const w = landWorld();
    applyBrush(w, Tool.Lower, p, 4, 0.5);
    expect(w.elevation[center]).toBeLessThan(200);
  });

  it('água abre um lago e atualiza a distância até a água em volta', () => {
    const w = landWorld();
    const { region } = applyBrush(w, Tool.Water, p, 3, 0);
    expect(w.isWater(center)).toBe(true);
    expect(w.waterDistance[center]).toBe(0);
    const near = grid.neighbor(grid.neighbor(grid.neighbor(grid.neighbor(center, 0), 0), 0), 0);
    expect(w.waterDistance[near]).toBeLessThanOrEqual(2);
    expect(region.length).toBeGreaterThan(0);
  });

  it('gelo pintado aparece mesmo no calor; derreter apaga calota polar', () => {
    const w = createWorld(params, grid);
    applyBrush(w, Tool.Ice, p, 3, 0);
    expect(w.biome[center]).toBe(Biome.Ice);
    const pole = latLonToPoint(Math.PI / 2 - 0.01, 0);
    const poleCell = grid.pointToCell(pole[0], pole[1], pole[2]);
    expect(w.ice[poleCell]).toBe(1);
    applyBrush(w, Tool.EraseIce, pole, 3, 0);
    expect(w.ice[poleCell]).toBe(0);
  });

  it('só a região em volta do pincel muda', () => {
    const w = createWorld(params, grid);
    const before = Float32Array.from(w.elevation);
    const { region } = applyBrush(w, Tool.Raise, p, 3, 0.2);
    const inRegion = new Set(region);
    for (let i = 0; i < w.cellCount; i++) if (!inRegion.has(i)) expect(w.elevation[i]).toBe(before[i]);
  });

  it('dirtyRects cobre todas as células por face', () => {
    const cells = grid.cellsInCap(...latLonToPoint(0.6, 0.78), grid.cellAngle * 4);
    const rects = dirtyRects(grid, cells);
    for (const c of cells) {
      const r = rects.find((x) => x.face === grid.faceOf(c))!;
      expect(grid.xOf(c)).toBeGreaterThanOrEqual(r.x0);
      expect(grid.xOf(c)).toBeLessThanOrEqual(r.x1);
      expect(grid.yOf(c)).toBeGreaterThanOrEqual(r.y0);
      expect(grid.yOf(c)).toBeLessThanOrEqual(r.y1);
    }
  });
});
