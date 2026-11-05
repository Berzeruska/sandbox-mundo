import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { oceanDepthAt, RIDGE_DEPTH, Tectonics, TRENCH_DEPTH } from '../../src/world/tectonics';

const plate = (id: number, omega: Vec3, center: Vec3) => ({ id, seed: center, center, omega, continental: 0, color: [0, 0, 0] as const });

/** Duas placas (x > 0 e x ≤ 0) girando em sentidos opostos em torno de Y: perto de (0,0,-1)
 * elas se aproximam, perto de (0,0,1) se afastam. Relevo de cada lado escolhido pelo teste. */
function twoPlates(east: number, west: number, n = 64) {
  const g = new CubeSphere(n);
  const w = new WorldState({ seedText: '', seed: 3, n, seaLevel: 0, landFraction: 0.3 }, g);
  for (let i = 0; i < w.cellCount; i++) {
    const east0 = g.positions[i * 3]! > 0;
    w.plate[i] = east0 ? 0 : 1;
    w.elevation[i] = east0 ? east : west;
    w.crust[i] = w.elevation[i]! > -500 ? Crust.Continental : Crust.Oceanic;
  }
  w.plates = [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, -1, 0], [-1, 0, 0])];
  const t = new Tectonics(w);
  const run = (steps: number) => {
    for (let k = 0; k < steps; k++) {
      t.angle[0] = t.angle[0]! + g.cellAngle;
      t.angle[1] = t.angle[1]! + g.cellAngle;
      t.tick += 800;
      t.recompose();
    }
  };
  const near = (target: Vec3, maxAngle: number) => {
    const out: number[] = [];
    for (let i = 0; i < w.cellCount; i++) {
      const d = g.positions[i * 3]! * target[0] + g.positions[i * 3 + 1]! * target[1] + g.positions[i * 3 + 2]! * target[2];
      if (Math.acos(Math.min(1, d)) < maxAngle) out.push(i);
    }
    return out;
  };
  return { w, g, t, run, near };
}

describe('relevo nas fronteiras (T5)', () => {
  it('colisão continental ergue cordilheira dos dois lados', () => {
    const { w, run, near } = twoPlates(300, 300);
    run(6);
    const front = near([0, 0, -1], 0.15);
    const peak = Math.max(...front.map((i) => w.elevation[i]!));
    expect(peak).toBeGreaterThan(1800); // faixa larga (erosão e suavização espalham a massa)
    // Longe da colisão nada sobe.
    expect(Math.max(...near([1, 0, 0], 0.3).map((i) => w.elevation[i]!))).toBeLessThan(400);
  });

  it('oceano contra continente: fossa no mar e cordilheira no continente', () => {
    const { w, run, near } = twoPlates(300, -4000);
    run(6);
    const front = near([0, 0, -1], 0.2);
    const deepest = Math.min(...front.map((i) => w.elevation[i]!));
    const highest = Math.max(...front.map((i) => w.elevation[i]!));
    expect(deepest).toBeLessThan(-5500);
    expect(deepest).toBeGreaterThanOrEqual(TRENCH_DEPTH);
    expect(highest).toBeGreaterThan(1200);
  });

  it('oceano contra oceano: arco de ilhas emerge do mar', () => {
    const { w, run, near } = twoPlates(-3000, -4500);
    run(10);
    // A placa de cima avança sobre a outra; a fossa e o arco andam junto com a frente.
    const front = near([0, 0, -1], 0.4);
    expect(front.some((i) => w.elevation[i]! > 0)).toBe(true); // ilhas
    expect(Math.min(...front.map((i) => w.elevation[i]!))).toBeLessThan(-5000); // fossa
  });

  it('dorsal: fundo oceânico novo é raso e afunda com a idade', () => {
    expect(oceanDepthAt(0)).toBe(RIDGE_DEPTH);
    expect(oceanDepthAt(20_000)).toBeLessThan(oceanDepthAt(5_000));
    expect(oceanDepthAt(1e9)).toBeCloseTo(RIDGE_DEPTH - 2500, 6);
    const { w, run, near } = twoPlates(-3000, -3000);
    run(8);
    // No rifte (perto de (0,0,1)): o miolo (mais novo) é mais raso que as bordas (mais velhas).
    const center = near([0, 0, 1], 0.02).map((i) => w.elevation[i]!);
    const flank = near([Math.sin(0.06), 0, Math.cos(0.06)], 0.02).map((i) => w.elevation[i]!);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(center)).toBeGreaterThan(avg(flank));
  });

  it('continente que se rasga: a borda vira plataforma rasa, com recorte irregular', () => {
    const { w, g, run } = twoPlates(400, 400);
    run(4);
    // Margens do rifte: crosta continental a até 2 células do oceano novo, perto de (0,0,1). A
    // primeira é o vale de rifte que ficou na borda quando o meio virou mar (correção 1).
    const margin: number[] = [];
    const nearOcean = (i: number) => [0, 1, 2, 3].some((d) => w.elevation[g.neighbor(i, d)]! < -1500);
    for (let i = 0; i < w.cellCount; i++) {
      if (w.crust[i] !== Crust.Continental || g.positions[i * 3 + 2]! < 0.9) continue;
      if (nearOcean(i) || [0, 1, 2, 3].some((d) => w.crust[g.neighbor(i, d)] === Crust.Continental && nearOcean(g.neighbor(i, d)))) margin.push(i);
    }
    expect(margin.length).toBeGreaterThan(10);
    // Parte afundou para plataforma (abaixo do mar, rasa) e parte segue terra: costa irregular.
    expect(margin.some((i) => w.elevation[i]! < 0 && w.elevation[i]! >= -200)).toBe(true);
    expect(margin.some((i) => w.elevation[i]! > 0)).toBe(true);
  });

  it('rodada longa num mundo de verdade: terra entre 20% e 40%, montanhas, nada inválido', () => {
    const grid = new CubeSphere(64);
    const w = createWorld({ seedText: 'longo', seed: 99, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w);
    for (let k = 0; k < 60_000; k++) t.step(1);
    expect(t.recompositions).toBeGreaterThan(5);
    expect(w.landFraction()).toBeGreaterThan(0.2);
    expect(w.landFraction()).toBeLessThan(0.4);
    expect([...w.elevation].every(Number.isFinite)).toBe(true);
    expect(Math.max(...w.elevation)).toBeGreaterThan(2500);
  });
});
