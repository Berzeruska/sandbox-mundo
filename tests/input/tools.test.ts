import { describe, expect, it } from 'vitest';
import { applyBrush, brushFalloff, MAX_ELEVATION, MIN_ELEVATION, softLimit, Tool } from '../../src/input/tools';
import { Biome } from '../../src/world/biomes';
import { computeWaterDistance, updateClimate } from '../../src/world/climate';
import { createWorld } from '../../src/world/create';
import { CubeSphere, faceCoordToPoint, latLonToPoint } from '../../src/world/cubesphere';
import { WorldState } from '../../src/world/state';
import { dirtyRects, packRect } from '../../src/render/dirty';

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

describe('pincel atravessa faces (bug 2026-10-15)', () => {
  const g = new CubeSphere(64);
  const flat = () => {
    const w = new WorldState({ ...params, n: 64 }, g);
    w.elevation.fill(500);
    computeWaterDistance(w);
    updateClimate(w);
    return w;
  };
  const cases: [string, [number, number, number]][] = [
    ['borda entre faces 0 e 4', faceCoordToPoint(0, -1, 0)],
    ['canto do cubo (faces 0, 2, 4)', faceCoordToPoint(0, -1, 1)],
  ];
  it.each(cases)('%s: afeta as faces vizinhas e forma um círculo na esfera', (_name, p) => {
    const w = flat();
    const before = Float32Array.from(w.elevation);
    const radiusCells = 12;
    applyBrush(w, Tool.Lower, p, radiusCells, 0.5);
    const radius = radiusCells * g.cellAngle;
    const faces = new Set<number>();
    for (let i = 0; i < g.cellCount; i++) {
      const dot = g.positions[i * 3]! * p[0] + g.positions[i * 3 + 1]! * p[1] + g.positions[i * 3 + 2]! * p[2];
      const angle = Math.acos(Math.min(1, dot));
      const changed = w.elevation[i] !== before[i];
      // Todas as células dentro do raio mudam; nenhuma fora dele.
      if (angle < radius * 0.999) expect(changed).toBe(true);
      if (angle > radius * 1.001) expect(changed).toBe(false);
      if (changed) faces.add(g.faceOf(i));
    }
    const expectedFaces = new Set([...g.cellsInCap(p[0], p[1], p[2], radius)].map((c) => g.faceOf(c)));
    expect(faces).toEqual(expectedFaces);
    expect(faces.size).toBeGreaterThanOrEqual(2);
  });

  it('o canto do cubo atinge as 3 faces que se encontram nele', () => {
    const w = flat();
    const before = Float32Array.from(w.elevation);
    applyBrush(w, Tool.Lower, faceCoordToPoint(0, -1, 1), 12, 0.5);
    const faces = new Set<number>();
    for (let i = 0; i < g.cellCount; i++) if (w.elevation[i] !== before[i]) faces.add(g.faceOf(i));
    expect([...faces].sort()).toEqual([0, 2, 4]);
  });

  it('packRect copia exatamente o retângulo da face', () => {
    const n = 8;
    const colors = Uint8Array.from({ length: 6 * n * n * 4 }, (_, k) => k % 251);
    const r = { face: 3, x0: 2, y0: 5, x1: 6, y1: 7 };
    const out = packRect(colors, n, r);
    expect(out.length).toBe(5 * 3 * 4);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const src = ((r.face * n + y) * n + x) * 4;
        const dst = ((y - r.y0) * 5 + (x - r.x0)) * 4;
        expect([...out.subarray(dst, dst + 4)]).toEqual([...colors.subarray(src, src + 4)]);
      }
    }
  });
});

describe('queda suave do pincel (T14)', () => {
  it('falloff: 1 no centro, 0 na borda, sempre decrescente e suave', () => {
    expect(brushFalloff(0)).toBe(1);
    expect(brushFalloff(1)).toBe(0);
    let prev = 1;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const v = brushFalloff(t);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    // Chega na borda sem degrau: perto de 1, já é quase zero.
    expect(brushFalloff(0.95)).toBeLessThan(0.001);
  });

  const profile = (tool: Tool, seconds: number) => {
    const g = new CubeSphere(128);
    const w = new WorldState({ ...params, n: 128 }, g);
    w.elevation.fill(200);
    computeWaterDistance(w);
    updateClimate(w);
    const c = latLonToPoint(0.3, 0.5);
    const radiusCells = 20;
    for (let f = 0; f < seconds * 60; f++) applyBrush(w, tool, c, radiusCells, 1 / 60);
    // Altura média por anel (fração do raio).
    const rings = new Array(10).fill(0);
    const counts = new Array(10).fill(0);
    let outside = 0;
    for (let i = 0; i < w.cellCount; i++) {
      const dot = g.positions[i * 3]! * c[0] + g.positions[i * 3 + 1]! * c[1] + g.positions[i * 3 + 2]! * c[2];
      const t = Math.acos(Math.min(1, dot)) / (radiusCells * g.cellAngle);
      if (t < 1) {
        rings[Math.floor(t * 10)] += w.elevation[i]!;
        counts[Math.floor(t * 10)]++;
      } else if (w.elevation[i] !== 200) outside++;
    }
    return { rings: rings.map((s, k) => s / counts[k]), outside, max: Math.max(...w.elevation), min: Math.min(...w.elevation) };
  };

  it('Elevar faz um morro: anéis cada vez mais baixos do centro à borda, borda quase intacta', () => {
    const { rings, outside } = profile(Tool.Raise, 1.5);
    for (let k = 1; k < rings.length; k++) expect(rings[k]).toBeLessThan(rings[k - 1]!);
    expect(rings[9]! - 200).toBeLessThan(0.02 * (rings[0]! - 200));
    expect(outside).toBe(0);
    // Sem platô: meio do raio bem mais baixo que o centro.
    expect(rings[5]! - 200).toBeLessThan(0.45 * (rings[0]! - 200));
  });

  it('segurando 4 s (o caso que virava platô), continua um morro abaixo do teto', () => {
    const { rings, max } = profile(Tool.Raise, 4);
    expect(max).toBeLessThan(MAX_ELEVATION);
    // Centro bem mais alto que o anel do meio, e o topo ainda arredondado (não uma mesa).
    expect(rings[0]! - rings[5]!).toBeGreaterThan(2000);
    expect(rings[0]! - rings[2]!).toBeGreaterThan(300);
  });

  it('Rebaixar faz uma bacia com a mesma forma', () => {
    const { rings, min } = profile(Tool.Lower, 1.5);
    for (let k = 1; k < rings.length; k++) expect(rings[k]).toBeGreaterThan(rings[k - 1]!);
    expect(min).toBeGreaterThanOrEqual(MIN_ELEVATION);
  });

  it('softLimit desacelera perto do teto e do fundo', () => {
    expect(softLimit(0, 1)).toBe(1);
    expect(softLimit(MAX_ELEVATION, 1)).toBe(0);
    expect(softLimit(MAX_ELEVATION - 3000, 1)).toBeCloseTo(0.5, 6);
    expect(softLimit(0, -1)).toBe(-1);
    expect(softLimit(MIN_ELEVATION, -1)).toBe(-0);
  });
});
