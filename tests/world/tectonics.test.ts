import { describe, expect, it } from 'vitest';
import { applyBrush, Tool } from '../../src/input/tools';
import { computeWaterDistance, updateClimate } from '../../src/world/climate';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { landComponents } from '../../src/world/generation';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { MAX_PLATE_RATE, RIDGE_DEPTH, Tectonics } from '../../src/world/tectonics';

/** Gira v pelo ângulo a em torno do eixo unitário k (Rodrigues). */
function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d * (1 - c),
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d * (1 - c),
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d * (1 - c),
  ];
}

const plate = (id: number, omega: Vec3, center: Vec3) => ({ id, seed: center, center, omega, continental: 0, color: [0, 0, 0] as const });

/** Mundo sintético: placas e relevo escolhidos pelo teste. */
function synthetic(n: number, plateOf: (p: Vec3) => number, elevOf: (p: Vec3, i: number) => number, plates: ReturnType<typeof plate>[]) {
  const g = new CubeSphere(n);
  const w = new WorldState({ seedText: '', seed: 0, n, seaLevel: 0, landFraction: 0.3 }, g);
  for (let i = 0; i < w.cellCount; i++) {
    const p: Vec3 = [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
    w.plate[i] = plateOf(p);
    w.elevation[i] = elevOf(p, i);
    w.crust[i] = w.elevation[i]! > -500 ? Crust.Continental : Crust.Oceanic;
  }
  w.plates = plates;
  return w;
}

describe('tectônica: movimento das placas', () => {
  it('velocidade 0 congela: nada muda e não há recomposição', () => {
    const w = createWorld({ seedText: '1', seed: 1, n: 32, seaLevel: 0, landFraction: 0.3 });
    const before = Float32Array.from(w.elevation);
    const t = new Tectonics(w);
    for (let k = 0; k < 10_000; k++) expect(t.step(0)).toBe(false);
    expect(t.recompositions).toBe(0);
    expect(w.elevation).toEqual(before);
  });

  it('uma placa sozinha gira sem deformar: cada célula mostra exatamente a crosta do ponto girado', () => {
    const axis: Vec3 = [0.3, 0.9, 0.3].map((v, _, a) => v / Math.hypot(...a)) as Vec3;
    const w = synthetic(32, () => 0, (_p, i) => (i * 37) % 2000 - 1000, [plate(0, axis, [0, 1, 0])]);
    const elev0 = Float32Array.from(w.elevation);
    const t = new Tectonics(w, { relief: false });
    const angle = 0.37;
    t.angle[0] = angle;
    t.recompose();
    const g = w.grid;
    for (let c = 0; c < w.cellCount; c++) {
      const back = rotate([g.positions[c * 3]!, g.positions[c * 3 + 1]!, g.positions[c * 3 + 2]!], axis, -angle);
      expect(w.elevation[c]).toBe(elev0[g.pointToCell(back[0], back[1], back[2])]);
    }
    // Sem fronteira, nenhuma crosta nasce nem morre.
    expect(t.sampleCount).toBe(w.cellCount);
  });

  describe('duas placas girando em sentidos opostos em torno de Y', () => {
    // Placa 0 (x > 0, continental) e placa 1 (x < 0, oceânica). Perto de (0,0,1) elas se afastam;
    // perto de (0,0,-1) elas se aproximam.
    const make = () => {
      const w = synthetic(
        48,
        (p) => (p[0] > 0 ? 0 : 1),
        (p) => (p[0] > 0 ? 500 : -3000),
        [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, -1, 0], [-1, 0, 0])],
      );
      const t = new Tectonics(w, { relief: false });
      t.angle[0] = 0.12;
      t.angle[1] = 0.12;
      t.recompose();
      return { w, t };
    };
    const near = (w: WorldState, target: Vec3, maxAngle: number) => {
      const out: number[] = [];
      for (let i = 0; i < w.cellCount; i++) {
        const d = w.grid.positions[i * 3]! * target[0] + w.grid.positions[i * 3 + 1]! * target[1] + w.grid.positions[i * 3 + 2]! * target[2];
        if (Math.acos(Math.min(1, d)) < maxAngle) out.push(i);
      }
      return out;
    };

    it('onde se afastam, nasce crosta oceânica nova na profundidade da dorsal', () => {
      const { w } = make();
      const ridge = near(w, [0, 0, 1], 0.12).filter((i) => w.elevation[i] === RIDGE_DEPTH);
      expect(ridge.length).toBeGreaterThan(5);
      for (const i of ridge) expect(w.crust[i]).toBe(Crust.Oceanic);
    });

    it('onde se aproximam, a continental fica por cima e a oceânica é consumida', () => {
      const { w, t } = make();
      // O continente avançou sobre onde antes era oceano (x < 0, perto de (0,0,-1)).
      const overrun = near(w, [-0.15, 0, -1].map((v, _, a) => v / Math.hypot(...a)) as Vec3, 0.06);
      expect(overrun.some((i) => w.elevation[i] === 500)).toBe(true);
      // Houve consumo: menos amostras vivas do que células + dorsal nova.
      const ridgeCells = [...w.elevation].filter((e) => e === RIDGE_DEPTH).length;
      expect(t.sampleCount).toBeLessThan(w.cellCount + ridgeCells);
    });
  });

  it('falha transformante (deslizando de lado) não abre oceano nem destrói continente', () => {
    // Girar em torno de X move os pontos paralelamente à fronteira x = 0.
    const w = synthetic(48, (p) => (p[0] > 0 ? 0 : 1), () => 500, [plate(0, [1, 0, 0], [1, 0, 0]), plate(1, [-1, 0, 0], [-1, 0, 0])]);
    const t = new Tectonics(w, { relief: false });
    t.angle[0] = 0.2;
    t.angle[1] = 0.2;
    t.recompose();
    expect([...w.elevation].filter((e) => e === RIDGE_DEPTH).length).toBe(0);
    expect([...w.elevation].every((e) => e === 500)).toBe(true);
  });

  it('é determinística: mesma semente e mesmos passos, mesmo planeta', () => {
    const run = () => {
      const w = createWorld({ seedText: '7', seed: 7, n: 32, seaLevel: 0, landFraction: 0.3 });
      const t = new Tectonics(w);
      for (let k = 0; k < 40_000; k++) t.step(1);
      return { elevation: w.elevation, plate: w.plate, recompositions: t.recompositions };
    };
    const a = run();
    const b = run();
    expect(a.recompositions).toBeGreaterThan(0);
    expect(a.elevation).toEqual(b.elevation);
    expect(a.plate).toEqual(b.plate);
  });

  it.each([1, 2, 3])('semente %i: com as placas no máximo, a Pangeia se parte em continentes', (seed) => {
    const w = createWorld({ seedText: String(seed), seed, n: 64, seaLevel: 0, landFraction: 0.3 });
    const land = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);
    const big = (sizes: number[]) => sizes.filter((s) => s >= 0.05 * land(sizes)).length;
    expect(big(landComponents(w))).toBe(1);
    const t = new Tectonics(w);
    // ~0,3 rad de deslocamento (o equivalente a ~2 min reais em 20× com o controle no máximo).
    const ticks = Math.round(0.3 / MAX_PLATE_RATE);
    for (let k = 0; k < ticks; k++) t.step(1);
    expect(big(landComponents(w))).toBeGreaterThanOrEqual(2);
    expect(w.landFraction()).toBeGreaterThan(0.2);
    expect(w.landFraction()).toBeLessThan(0.45);
    expect([...w.elevation].every(Number.isFinite)).toBe(true);
  });

  it('uma montanha pintada viaja junto com a placa', () => {
    const axis: Vec3 = [0, 1, 0];
    const w = synthetic(48, () => 0, () => 200, [plate(0, axis, [0, 1, 0])]);
    computeWaterDistance(w);
    updateClimate(w);
    const t = new Tectonics(w, { relief: false });
    const point: Vec3 = [0, 0, 1];
    const { region } = applyBrush(w, Tool.Raise, point, 4, 2);
    t.syncCells(region);
    const peakBefore = w.elevation[w.grid.pointToCell(...point)]!;
    expect(peakBefore).toBeGreaterThan(2000);
    t.angle[0] = 0.4;
    t.recompose();
    const moved = rotate(point, axis, 0.4);
    expect(w.elevation[w.grid.pointToCell(...moved)]).toBe(peakBefore);
    expect(w.elevation[w.grid.pointToCell(...point)]).toBe(200);
  });
});
