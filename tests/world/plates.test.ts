import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { generateTerrain } from '../../src/world/generation';
import {
  Boundary,
  classifyBoundary,
  Crust,
  CONTINENTAL_DEPTH,
  PANGEA_PLATE_SHARE,
  generatePlates,
  landCentroid,
  MAX_PLATES,
  MIN_PLATES,
  plateVelocity,
  smoothBoundaries,
} from '../../src/world/plates';
import { WorldState } from '../../src/world/state';

const grid = new CubeSphere(64);
const make = (seed: number) => createWorld({ seedText: String(seed), seed, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
const seeds = [1, 2, 3, 77, 2026];

describe('placas tectônicas: geração', () => {
  it.each(seeds)('semente %i: toda célula tem placa e o número de placas fica entre 8 e 14', (seed) => {
    const w = make(seed);
    expect(w.plates.length).toBeGreaterThanOrEqual(MIN_PLATES);
    expect(w.plates.length).toBeLessThanOrEqual(MAX_PLATES);
    const used = new Set<number>();
    for (let i = 0; i < w.cellCount; i++) {
      expect(w.plate[i]).toBeLessThan(w.plates.length);
      used.add(w.plate[i]!);
    }
    expect(used.size).toBe(w.plates.length);
  });

  it.each(seeds)('semente %i: cada placa é uma peça só (contígua)', (seed) => {
    const w = make(seed);
    for (let p = 0; p < w.plates.length; p++) {
      const start = w.plate.indexOf(p);
      const seen = new Uint8Array(w.cellCount);
      const stack = [start];
      seen[start] = 1;
      let reached = 0;
      while (stack.length) {
        const c = stack.pop()!;
        reached++;
        for (let d = 0; d < 4; d++) {
          const nb = grid.neighbor(c, d);
          if (!seen[nb] && w.plate[nb] === p) {
            seen[nb] = 1;
            stack.push(nb);
          }
        }
      }
      expect(reached).toBe(w.plate.filter((x) => x === p).length);
    }
  });

  it.each(seeds)('semente %i: a Pangeia fica repartida em pelo menos 3 placas', (seed) => {
    const w = make(seed);
    const landPerPlate = new Map<number, number>();
    let land = 0;
    for (let i = 0; i < w.cellCount; i++) {
      if (w.isWater(i)) continue;
      land++;
      landPerPlate.set(w.plate[i]!, (landPerPlate.get(w.plate[i]!) ?? 0) + 1);
    }
    const significant = [...landPerPlate.values()].filter((c) => c >= 0.05 * land).length;
    expect(significant).toBeGreaterThanOrEqual(3);
  });

  it('é determinística e muda com a semente', () => {
    expect(make(5).plate).toEqual(make(5).plate);
    expect(make(5).plate).not.toEqual(make(6).plate);
  });

  it('não mexe no terreno: a mesma semente gera o mesmo relevo de antes das placas', () => {
    const before = new WorldState({ seedText: '9', seed: 9, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    generateTerrain(before);
    const elevation = Float32Array.from(before.elevation);
    generatePlates(before);
    expect(before.elevation).toEqual(elevation);
    expect(make(9).elevation).toEqual(elevation);
  });

  it('crosta continental é a terra e a plataforma rasa', () => {
    const w = make(3);
    for (let i = 0; i < w.cellCount; i++) {
      expect(w.crust[i]).toBe(w.heightAboveSea(i) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic);
    }
  });

  it.each(seeds)('semente %i: placas da Pangeia se afastam do centro do supercontinente', (seed) => {
    const w = make(seed);
    const land = landCentroid(w);
    const landCells = [...Array(w.cellCount).keys()].filter((i) => !w.isWater(i));
    for (const plate of w.plates) {
      const share = landCells.filter((i) => w.plate[i] === plate.id).length / landCells.length;
      if (share < PANGEA_PLATE_SHARE) continue;
      const c = plate.center;
      const away: Vec3 = [c[0] - land[0], c[1] - land[1], c[2] - land[2]];
      if (Math.hypot(...away) < 0.1) continue; // placa bem no centro: sem direção definida
      const v = plateVelocity(plate, c);
      expect(v[0] * away[0] + v[1] * away[1] + v[2] * away[2]).toBeGreaterThan(0);
    }
  });
});

describe('placas tectônicas: tipos de fronteira', () => {
  /** Duas placas: x > 0 é a placa 0, x ≤ 0 é a placa 1; velocidades escolhidas por teste. */
  const twoPlates = (omega0: Vec3, omega1: Vec3) => {
    const g = new CubeSphere(16);
    const w = new WorldState({ seedText: '', seed: 0, n: 16, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) w.plate[i] = g.positions[i * 3]! > 0 ? 0 : 1;
    const plate = (id: number, omega: Vec3) => ({ id, seed: [id ? -1 : 1, 0, 0] as Vec3, center: [id ? -1 : 1, 0, 0] as Vec3, omega, continental: 0, color: [0, 0, 0] as const });
    w.plates = [plate(0, omega0), plate(1, omega1)];
    // Célula da fronteira perto do equador, do lado da placa 0 (x > 0, z ≈ 0, y ≈ 0 ... na borda x ≈ 0).
    const boundaryCell = [...Array(w.cellCount).keys()].find(
      (i) => w.plate[i] === 0 && Math.abs(g.positions[i * 3 + 1]!) < 0.15 && g.positions[i * 3 + 2]! > 0.9 &&
        [0, 1, 2, 3].some((d) => w.plate[g.neighbor(i, d)] === 1),
    )!;
    return { w, boundaryCell };
  };

  // Na fronteira perto de (0, 0, 1): girar em torno de Y move pontos ao longo de X.
  it('aproximando = convergente', () => {
    // Placa 0 (x>0) indo para -x; placa 1 (x<0) indo para +x.
    const { w, boundaryCell } = twoPlates([0, -1, 0], [0, 1, 0]);
    expect(classifyBoundary(w, boundaryCell)).toBe(Boundary.Convergent);
  });

  it('afastando = divergente', () => {
    const { w, boundaryCell } = twoPlates([0, 1, 0], [0, -1, 0]);
    expect(classifyBoundary(w, boundaryCell)).toBe(Boundary.Divergent);
  });

  it('deslizando de lado = transformante', () => {
    // Girar em torno de X move pontos perto de (0,0,1) ao longo de Y: paralelo à fronteira.
    const { w, boundaryCell } = twoPlates([1, 0, 0], [-1, 0, 0]);
    expect(classifyBoundary(w, boundaryCell)).toBe(Boundary.Transform);
  });

  it('interior de placa não é fronteira', () => {
    const { w } = twoPlates([0, 1, 0], [0, -1, 0]);
    const inner = [...Array(w.cellCount).keys()].find((i) => w.grid.positions[i * 3]! > 0.95)!;
    expect(classifyBoundary(w, inner)).toBe(Boundary.None);
  });
});

describe('placas tectônicas: trechos de fronteira uniformes', () => {
  it.each([1, 2, 3])('semente %i: quase nenhuma célula de fronteira fica isolada com tipo diferente dos vizinhos', (seed) => {
    const w = make(seed);
    let boundaryCells = 0;
    let isolated = 0;
    for (let i = 0; i < w.cellCount; i++) {
      if (!w.boundary[i]) continue;
      boundaryCells++;
      const kinds = [0, 1, 2, 3].map((d) => w.boundary[grid.neighbor(i, d)]).filter((k) => k);
      if (kinds.length && kinds.every((k) => k !== w.boundary[i])) isolated++;
    }
    expect(boundaryCells).toBeGreaterThan(0);
    expect(isolated / boundaryCells).toBeLessThan(0.02);
  });

  it('só muda o tipo das células que já eram fronteira', () => {
    const w = make(4);
    const before = Uint8Array.from(w.boundary);
    smoothBoundaries(w);
    for (let i = 0; i < w.cellCount; i++) expect(w.boundary[i] === 0).toBe(before[i] === 0);
  });
});

describe('placas tectônicas: sem viés de latitude', () => {
  it('centros das placas e pontos triplos se espalham por igual nas faixas de latitude (igual área)', () => {
    const g = new CubeSphere(32);
    const band = (y: number) => Math.min(4, Math.floor(Math.abs(y) * 5));
    const centers = [0, 0, 0, 0, 0];
    const triples = [0, 0, 0, 0, 0];
    for (let s = 1; s <= 80; s++) {
      const w = new WorldState({ seedText: '', seed: s, n: 32, seaLevel: 0, landFraction: 0.3 }, g);
      generateTerrain(w);
      generatePlates(w);
      for (const p of w.plates) centers[band(p.center[1])]!++;
      for (let i = 0; i < w.cellCount; i++) {
        const set = new Set([w.plate[i], ...[0, 1, 2, 3].map((d) => w.plate[g.neighbor(i, d)])]);
        if (set.size >= 3) triples[band(g.positions[i * 3 + 1]!)]!++;
      }
    }
    for (const counts of [centers, triples]) {
      const total = counts.reduce((a, b) => a + b, 0);
      for (const c of counts) expect(c / total).toBeGreaterThan(0.14);
      for (const c of counts) expect(c / total).toBeLessThan(0.26);
    }
  });
});
