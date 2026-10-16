import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { CubeSphere, cellShape, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { MAX_PLATE_RATE, SUTURE_GRACE, Tectonics } from '../../src/world/tectonics';

/**
 * Bloco G1 (pedido do usuário, 2026-10-15): continentes não migram para os polos, colisão falsa por
 * arredondamento não solda, e a solda some quando as placas deixam de se tocar.
 */

const TICKS_PER_MINUTE = 60 * 240; // 20× = 240 passos por segundo
const N = 128;
const grid = new CubeSphere(N);

/** Área de cada célula (esferorradianos): as células equiangulares não têm todas a mesma área. */
const area = (() => {
  const a = new Float64Array(6 * N * N);
  for (let f = 0; f < 6; f++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[f * N * N + y * N + x] = cellShape(f, x, y, N).area;
  return a;
})();

const latDeg = (y: number) => (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;

/** Latitude média absoluta da crosta continental (pesada pela área) e fração dela acima de 60°. */
function continentalLatitude(w: WorldState): { mean: number; polar: number } {
  let total = 0;
  let sum = 0;
  let polar = 0;
  for (let c = 0; c < w.cellCount; c++) {
    if (w.crust[c] !== Crust.Continental) continue;
    const a = area[c]!;
    const lat = Math.abs(latDeg(w.grid.positions[c * 3 + 1]!));
    total += a;
    sum += a * lat;
    if (lat > 60) polar += a;
  }
  return { mean: sum / total, polar: polar / total };
}

function rotate(p: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
  const x: Vec3 = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
  return [p[0] * c + x[0] * s + k[0] * d * (1 - c), p[1] * c + x[1] * s + k[1] * d * (1 - c), p[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

describe('G1: rotação rígida, costuras do cubo e colisão falsa', () => {
  it('todas as placas com o mesmo eixo: o mapa gira rígido, sem solda nem crosta perdida, cruzando as faces', () => {
    const w = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: N, seaLevel: 0, landFraction: 0.3 }, grid);
    // Eixo inclinado: os continentes cruzam várias costuras entre faces.
    const l = Math.hypot(0.3, 0.8, 0.5);
    const axis: Vec3 = [0.3 / l, 0.8 / l, 0.5 / l];
    for (const p of w.plates) p.omega = [...axis];
    const t = new Tectonics(w, { relief: false, stages: false });
    // Linha de base: a crosta continental inicial girada pela conta exata.
    const start: { p: Vec3; a: number }[] = [];
    for (let c = 0; c < w.cellCount; c++) {
      if (w.crust[c] === Crust.Continental) start.push({ p: [w.grid.positions[c * 3]!, w.grid.positions[c * 3 + 1]!, w.grid.positions[c * 3 + 2]!], a: area[c]! });
    }
    const land0 = w.landFraction();
    const ticks = 3 * TICKS_PER_MINUTE;
    for (let k = 0; k < ticks; k++) t.step(1);
    let total = 0;
    let sum = 0;
    for (const s of start) {
      total += s.a;
      sum += s.a * Math.abs(latDeg(rotate(s.p, axis, MAX_PLATE_RATE * ticks)[1]));
    }
    expect(t.recompositions).toBeGreaterThan(20);
    // Sem movimento relativo não há colisão: antes do G1, o consumo por arredondamento soldava placas (6 soldas).
    expect(t.welds).toBe(0);
    expect(Math.abs(continentalLatitude(w).mean - sum / total)).toBeLessThan(0.5);
    expect(Math.abs(w.landFraction() - land0)).toBeLessThan(0.005);
  }, 60_000);
});

describe('G1: solda à distância', () => {
  /** Duas placas (x > 0 e x ≤ 0) de continente, girando em sentidos opostos: colidem perto de (0,0,-1). */
  function collidingContinents() {
    const g = new CubeSphere(64);
    const w = new WorldState({ seedText: '', seed: 5, n: 64, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) {
      w.plate[i] = g.positions[i * 3]! > 0 ? 0 : 1;
      w.elevation[i] = 300;
      w.crust[i] = Crust.Continental;
    }
    const plate = (id: number, omega: Vec3, center: Vec3) => ({ id, seed: center, center, omega, continental: 1, color: [0, 0, 0] as const });
    w.plates = [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, -1, 0], [-1, 0, 0])];
    return w;
  }

  /** Gira o bloco pelo ângulo e recompõe (o giro comum de duas placas que se anulam é lento demais). */
  function nudge(t: Tectonics, w: WorldState, times: number): void {
    for (let r = 0; r < times; r++) {
      t.angle[0] = t.angle[0]! + 2 * w.grid.cellAngle;
      t.angle[1] = t.angle[1]! + 2 * w.grid.cellAngle;
      t.recompose();
    }
  }

  it('com contato, a sutura fica; quando os continentes deixam de se tocar, a solda some e cada um segue o seu rumo', () => {
    const w = collidingContinents();
    const t = new Tectonics(w, { relief: false });
    for (let k = 0; k < 3_000_000 && t.welds === 0; k++) t.step(1);
    expect(t.welds).toBe(1);
    expect(t.sutureList()).toHaveLength(1);
    expect(t.groupOf(1)).toBe(t.groupOf(0));

    // Contato continental: a sutura continua.
    nudge(t, w, SUTURE_GRACE + 2);
    expect(t.sutureList()).toHaveLength(1);
    expect(t.suturesDissolved).toBe(0);

    // A placa 1 perde a crosta continental perto da divisa (vira fundo oceânico), por algumas
    // recomposições seguidas (a divisa do bloco soldado treme 1–2 células por arredondamento e
    // reaparece crosta que estava por baixo): sem continente de uma a até SUTURE_REACH da outra.
    const sinkNearBoundary = () => {
      const near = new Uint8Array(w.cellCount);
      let frontier: number[] = [];
      for (let c = 0; c < w.cellCount; c++) {
        if (w.plate[c] !== 1) continue;
        for (let d = 0; d < 4; d++) if (w.plate[w.grid.neighbors[c * 4 + d]!] === 0) frontier.push(c);
      }
      for (const c of frontier) near[c] = 1;
      for (let step = 0; step < 6; step++) {
        const next: number[] = [];
        for (const c of frontier) {
          for (let d = 0; d < 4; d++) {
            const k = w.grid.neighbors[c * 4 + d]!;
            if (!near[k] && w.plate[k] === 1) {
              near[k] = 1;
              next.push(k);
            }
          }
        }
        frontier = next;
      }
      const sunk: number[] = [];
      for (let c = 0; c < w.cellCount; c++) {
        if (!near[c]) continue;
        w.elevation[c] = -4000;
        sunk.push(c);
      }
      t.syncCells(sunk);
    };
    for (let r = 0; r < SUTURE_GRACE + 4 && t.suturesDissolved === 0; r++) {
      sinkNearBoundary();
      nudge(t, w, 1);
    }
    expect(t.suturesDissolved).toBe(1);
    expect(t.sutureList()).toHaveLength(0);
    expect(t.groupOf(1)).not.toBe(t.groupOf(0));
    // Cada um ganhou um polo de Euler próprio.
    const a = t.plateMotion(0);
    const b = t.plateMotion(1);
    const same = Math.abs(a.speed - b.speed) < 1e-9 && a.axis.every((v, d) => Math.abs(v - b.axis[d]!) < 1e-9);
    expect(same).toBe(false);
  });
});

describe('G1: latitude da terra sem tendência em 10 min (20×, placas 100%)', () => {
  const seeds = ['terra', 'mundo', '7', '42', 'ilha'];
  const slopes: number[] = [];

  it.each(seeds)('semente "%s": a terra flutua, sem ir para os polos', (seedText) => {
    const w = createWorld({ seedText, seed: seedFrom(seedText), n: N, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w);
    const samples: { min: number; mean: number; polar: number }[] = [];
    const every = TICKS_PER_MINUTE / 4;
    for (let k = 0; k <= 10 * TICKS_PER_MINUTE; k++) {
      if (k % every === 0) samples.push({ min: k / TICKS_PER_MINUTE, ...continentalLatitude(w) });
      t.step(1);
    }
    // Referência: terra espalhada por igual no globo tem latitude média 32,7° e 13,4% acima de 60°.
    for (const s of samples) {
      expect(s.mean).toBeGreaterThan(20);
      expect(s.mean).toBeLessThan(45);
      expect(s.polar).toBeLessThan(0.3);
      // Depois da dispersão da Pangeia (primeiro estágio), nada de terra acumulada nos polos.
      if (s.min >= 4) expect(s.polar).toBeLessThan(0.25);
    }
    expect(t.reorganizations).toBeGreaterThan(0);
    // Inclinação da reta (graus por minuto), para a média entre as sementes.
    const n = samples.length;
    const mx = samples.reduce((a, s) => a + s.min, 0) / n;
    const my = samples.reduce((a, s) => a + s.mean, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const s of samples) {
      sxy += (s.min - mx) * (s.mean - my);
      sxx += (s.min - mx) ** 2;
    }
    slopes.push(sxy / sxx);
  }, 120_000);

  it('na média das sementes, nenhuma tendência (nem para os polos, nem para o equador)', () => {
    expect(slopes).toHaveLength(seeds.length);
    const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
    expect(Math.abs(mean)).toBeLessThan(0.75);
  });
});
