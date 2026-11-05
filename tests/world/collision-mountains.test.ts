import { describe, expect, it } from 'vitest';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { COLLISION_BASE, CRATON_RIGID, SHOULDER_MIN, Tectonics } from '../../src/world/tectonics';

const plate = (id: number, omega: Vec3, center: Vec3) => ({ id, seed: center, center, omega, continental: 1, color: [0, 0, 0] as const });

/** Um continente só (placa 0), plano a 300 m: a montanha recebida é medida sem outra coisa no caminho. */
function flat(rigidity?: (plate: number, ref: number) => number) {
  const g = new CubeSphere(48);
  const w = new WorldState({ seedText: '', seed: 5, n: 48, seaLevel: 0, landFraction: 0.3 }, g);
  w.elevation.fill(300);
  w.crust.fill(Crust.Continental);
  w.plate.fill(0);
  w.plates = [plate(0, [0, 0.5, 0], [0, 0, 1])];
  const t = new Tectonics(w, { erosion: false, stages: false, ...(rigidity ? { rigidity } : {}) });
  type Dep = { plate: number; mass: number; normal: number; count: number };
  const deposit = (c: number, mass: number, normal: number) => {
    const inner = t as unknown as { deposits: Map<number, Dep>; collisionMountains(e: Float32Array): void };
    inner.deposits.set(c, { plate: 0, mass, normal, count: 1 });
    inner.collisionMountains(w.elevation);
  };
  return { g, w, t, deposit };
}
const sum = (a: Float32Array) => a.reduce((acc, v) => acc + v, 0);

describe('G4: continente amassa e vira montanha', () => {
  it('a crosta consumida vira altura: a soma das alturas sobe exatamente a massa entregue', () => {
    const { g, w, t, deposit } = flat();
    const c0 = g.pointToCell(0, 0, 1);
    const before = sum(w.elevation);
    deposit(c0, 20_000, 1);
    expect(sum(w.elevation) - before).toBeCloseTo(20_000, -1);
    expect(t.collisionMassOut).toBeCloseTo(20_000, -1);
    expect(Math.max(...w.elevation)).toBeGreaterThan(300 + 500);
  });

  it('colisão oblíqua: a mesma crosta faz montanha mais baixa e mais larga', () => {
    const a = flat();
    const b = flat();
    const c0 = a.g.pointToCell(0, 0, 1);
    a.deposit(c0, 30_000, 1);
    b.deposit(c0, 30_000, 0.2);
    expect(Math.max(...b.w.elevation)).toBeLessThan(Math.max(...a.w.elevation));
    // Largura: células que receberam alguma crosta.
    const wide = (w: WorldState) => [...w.elevation].filter((e) => e > 310).length;
    expect(wide(b.w)).toBeGreaterThan(wide(a.w));
  });

  it('planalto: crosta demais enche o teto e alarga, sem jogar crosta fora', () => {
    const small = flat();
    const big = flat();
    const c0 = small.g.pointToCell(0, 0, 1);
    small.deposit(c0, 40_000, 1);
    big.deposit(c0, 400_000, 1);
    const capped = (w: WorldState) => [...w.elevation].filter((e) => e >= 6999).length;
    expect(capped(big.w)).toBeGreaterThan(capped(small.w) + 10);
    expect(big.t.collisionMassOut).toBeCloseTo(400_000, -2);
  });

  it('cráton: a cordilheira para na frente dele e sobe em escarpa', () => {
    // Metade x > 0,15 da placa é cráton.
    const { g, w, deposit } = flat((_p, ref) => (g.positions[ref * 3]! > 0.15 ? 1 : 0));
    const c0 = g.pointToCell(0, 0, 1);
    deposit(c0, 200_000, 1);
    let steepest = 0;
    for (let c = 0; c < w.cellCount; c++) {
      if (g.positions[c * 3]! <= 0.15) continue;
      // Cráton não engrossa.
      expect(w.elevation[c]).toBe(300);
      for (let d = 0; d < 4; d++) {
        const k = g.neighbors[c * 4 + d]!;
        if (g.positions[k * 3]! <= 0.15) steepest = Math.max(steepest, w.elevation[k]! - w.elevation[c]!);
      }
    }
    expect(steepest).toBeGreaterThan(2000);
    expect(CRATON_RIGID).toBeLessThan(1);
  });

  it('ombreira de rifte: as bordas da fenda nova sobem e ficam altas quando ela vira mar', () => {
    // Dois continentes a 300 m se afastando perto de (0,0,1).
    const g = new CubeSphere(64);
    const w = new WorldState({ seedText: '', seed: 3, n: 64, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) {
      w.plate[i] = g.positions[i * 3]! > 0 ? 0 : 1;
      w.elevation[i] = 300;
      w.crust[i] = Crust.Continental;
    }
    w.plates = [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, -1, 0], [-1, 0, 0])];
    const t = new Tectonics(w, { stages: false, erosion: false });
    for (let k = 0; k < 8; k++) {
      t.angle[0] = t.angle[0]! + g.cellAngle;
      t.angle[1] = t.angle[1]! + g.cellAngle;
      t.tick += 800;
      t.recompose();
    }
    // Perto de (0,0,1): há mar novo no meio e terra acima da ombreira mínima nas bordas, mais alta que
    // a terra junto da costa.
    let ocean = 0;
    let shoulder = 0;
    for (let c = 0; c < w.cellCount; c++) {
      if (g.positions[c * 3 + 2]! < 0.9) continue;
      if (w.crust[c] === Crust.Oceanic) ocean++;
      if (w.elevation[c]! >= SHOULDER_MIN) shoulder++;
    }
    expect(ocean).toBeGreaterThan(0);
    expect(shoulder).toBeGreaterThan(10);
    expect(COLLISION_BASE).toBeLessThan(0);
  });
});
