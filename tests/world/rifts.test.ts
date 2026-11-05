import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Noise3D } from '../../src/world/noise';
import { RIFT_CORRIDOR, retraceBorders, sliverAlong, stepOffsets, traceArm } from '../../src/world/rifts';

const grid = new CubeSphere(64);
const P = (c: number): Vec3 => [grid.positions[c * 3]!, grid.positions[c * 3 + 1]!, grid.positions[c * 3 + 2]!];
/** Calota em volta de (0,0,1) com raio `r` (rad): a "terra" dos testes. */
function cap(r: number): Uint8Array {
  const m = new Uint8Array(grid.cellCount);
  for (let c = 0; c < grid.cellCount; c++) if (Math.acos(Math.min(1, P(c)[2])) < r) m[c] = 1;
  return m;
}
const adjacent = (a: number, b: number) => [0, 1, 2, 3].some((d) => grid.neighbors[a * 4 + d] === b);

describe('riftes traçados (G3)', () => {
  it('degraus: trechos com o mesmo desvio, pontas presas em zero', () => {
    const s = stepOffsets(80, createRng(3));
    expect(Math.abs(s[0]!)).toBe(0);
    expect(Math.abs(s[s.length - 1]!)).toBe(0);
    // Há degraus: o desvio muda aos saltos, e fica parado dentro de um trecho.
    const changes = [...s].filter((v, i) => i > 4 && i < s.length - 5 && v !== s[i - 1]).length;
    expect(changes).toBeGreaterThan(2);
    expect(changes).toBeLessThan(20);
  });

  it('o braço fica na área permitida, é contínuo e chega na ponta', () => {
    const allowed = cap(0.5);
    const start = grid.pointToCell(-0.35, 0, Math.sqrt(1 - 0.35 * 0.35));
    const end = grid.pointToCell(0.35, 0, Math.sqrt(1 - 0.35 * 0.35));
    const rng = createRng(5);
    const path = traceArm({ grid, allowed, start, end, height: () => 0, rng, noise: new Noise3D(rng) })!;
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(end);
    for (const c of path) expect(allowed[c]).toBe(1);
    for (let k = 1; k < path.length; k++) expect(adjacent(path[k - 1]!, path[k]!)).toBe(true);
    // Serpenteia/anda em degraus: mais comprido que a linha reta.
    expect(path.length).toBeGreaterThan(0.7 / grid.cellAngle);
  });

  it('braço livre termina na costa e não volta para trás', () => {
    const allowed = cap(0.4);
    const coast = (c: number) => [0, 1, 2, 3].some((d) => !allowed[grid.neighbors[c * 4 + d]!]);
    const start = grid.pointToCell(0, 0, 1);
    const rng = createRng(9);
    const path = traceArm({ grid, allowed, start, direction: [1, 0, 0], goal: coast, height: () => 0, rng, noise: new Noise3D(rng) })!;
    expect(coast(path[path.length - 1]!)).toBe(true);
    expect(P(path[path.length - 1]!)[0]).toBeGreaterThan(0.2);
  });

  it('retraçar duas metades: o miolo não muda, a divisa nova é irregular e separa os lados', () => {
    const region = cap(0.6);
    const label = new Int32Array(grid.cellCount).fill(-1);
    for (let c = 0; c < grid.cellCount; c++) if (region[c]) label[c] = P(c)[0] > 0 ? 1 : 0;
    const before = Int32Array.from(label);
    const res = retraceBorders({ grid, region, label, height: () => 0, rng: createRng(11) });
    expect(res.cuts.length).toBeGreaterThan(0);
    expect(res.moved).toBeGreaterThan(0);
    // Só a faixa da divisa muda (até o corredor); o miolo de cada lado fica.
    for (let c = 0; c < grid.cellCount; c++) {
      if (!region[c] || label[c] === before[c]) continue;
      expect(Math.abs(P(c)[0])).toBeLessThan((RIFT_CORRIDOR + 2) * grid.cellAngle);
    }
    // Cada célula do pedaço 0 que encosta no 1 está perto do corte (os lados não se misturam).
    const cut = new Set(res.cuts.flatMap((k) => k.path));
    for (let c = 0; c < grid.cellCount; c++) {
      if (!region[c] || cut.has(c)) continue;
      for (let d = 0; d < 4; d++) {
        const k = grid.neighbors[c * 4 + d]!;
        if (region[k] && !cut.has(k) && label[k] !== label[c]) {
          expect([0, 1, 2, 3].some((e) => cut.has(grid.neighbors[c * 4 + e]!) || cut.has(grid.neighbors[k * 4 + e]!))).toBe(true);
        }
      }
    }
  });

  it('junção tríplice: os braços se encontram; com o braço que falha, dois pedaços viram um', () => {
    const region = cap(0.6);
    const label = new Int32Array(grid.cellCount).fill(-1);
    for (let c = 0; c < grid.cellCount; c++) {
      if (!region[c]) continue;
      const a = Math.atan2(P(c)[1], P(c)[0]);
      label[c] = a < -Math.PI / 3 ? 0 : a < Math.PI / 3 ? 1 : 2;
    }
    const res = retraceBorders({ grid, region, label, height: () => 0, rng: createRng(2), failChance: 1 });
    expect(res.junctions.length).toBeGreaterThan(0);
    expect(res.kept.length).toBe(1);
    expect(res.cuts.length).toBe(2);
    expect(new Set([...label].filter((l) => l >= 0)).size).toBe(2);
  });

  it('lasca: só de um lado do braço, na largura pedida', () => {
    const region = cap(0.6);
    const path: number[] = [];
    for (let k = -20; k <= 20; k++) path.push(grid.pointToCell(0.02 * k, 0, Math.sqrt(1 - (0.02 * k) ** 2)));
    const cells = sliverAlong(grid, region, path, 1, 4);
    expect(cells.length).toBeGreaterThan(40);
    const ys = cells.map((c) => P(c)[1]);
    // Lado: todos com o mesmo sinal do produto com a normal do braço (aqui, y > 0 ou y < 0).
    expect(ys.every((y) => y > 0) || ys.every((y) => y < 0)).toBe(true);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThan(5 * grid.cellAngle);
  });
});
