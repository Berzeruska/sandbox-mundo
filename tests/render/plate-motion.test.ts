import { describe, expect, it } from 'vitest';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { createWorld } from '../../src/world/create';
import { Crust } from '../../src/world/plates';
import { Tectonics } from '../../src/world/tectonics';
import { extrapolateAngle, packPlateCell, rotate, sourcePoint } from '../../src/render/plate-motion';

describe('movimento suave das placas (regra do shader)', () => {
  it('entre recomposições, o desenho interpolado bate com a recomposição completa (miolo das placas)', () => {
    const grid = new CubeSphere(64);
    const w = createWorld({ seedText: 'suave', seed: 11, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w);
    // Composição "base": placas num ângulo qualquer.
    for (let p = 0; p < t.angle.length; p++) t.angle[p] = 0.05 * (p % 3);
    t.recompose();
    const base = Float64Array.from(t.angle);
    const baseElevation = Float32Array.from(w.elevation);
    const basePlates = Uint8Array.from(w.plate);
    const baseCrust = Uint8Array.from(w.crust);
    const axis = w.plates.map((pl) => {
      const s = Math.hypot(...pl.omega);
      return [pl.omega[0] / s, pl.omega[1] / s, pl.omega[2] / s] as Vec3;
    });
    // As placas andam mais um pouco (menos de 1 célula) e o mundo é recomposto de verdade.
    const step = grid.cellAngle * 0.8;
    for (let p = 0; p < t.angle.length; p++) t.angle[p] = base[p]! + step;
    t.recompose();
    // Agora o desenho interpolado a partir da base deve mostrar o mesmo que a recomposição.
    const plateAt = (p: Vec3) => {
      const c = grid.pointToCell(p[0], p[1], p[2]);
      return packPlateCell(basePlates[c]!, baseCrust[c] === Crust.Continental);
    };
    // A textura já é uma amostragem por célula: o desenho interpolado pode trocar o conteúdo pela
    // célula vizinha (arredondamento duplo), mas nunca deve errar a placa nem andar mais que isso.
    let interior = 0;
    let rightPlate = 0;
    let withinOneCell = 0;
    for (let c = 0; c < w.cellCount; c++) {
      if (w.boundary[c]) continue;
      const p: Vec3 = [grid.positions[c * 3]!, grid.positions[c * 3 + 1]!, grid.positions[c * 3 + 2]!];
      const src = sourcePoint(p, { plateAt, axis, delta: axis.map(() => step), maxDelta: step });
      interior++;
      if (!src) continue;
      if (src.plate === w.plate[c]) rightPlate++;
      const shown = baseElevation[grid.pointToCell(...src.point)];
      // A célula e as 8 vizinhas (lados e cantos).
      const near = new Set([c]);
      for (let d = 0; d < 4; d++) {
        const nb = grid.neighbor(c, d);
        near.add(nb);
        for (let e = 0; e < 4; e++) near.add(grid.neighbor(nb, e));
      }
      if ([...near].some((k) => w.elevation[k] === shown)) withinOneCell++;
    }
    expect(rightPlate / interior).toBeGreaterThan(0.99);
    expect(withinOneCell / interior).toBeGreaterThan(0.97);
  });

  it('fenda aberta entre placas que se afastam vira "sem crosta" (o shader pinta oceano novo)', () => {
    // Placa 0 em x > 0 indo para +x perto de (0,0,1); placa 1 em x < 0 indo para -x.
    const plateAt = (p: Vec3) => packPlateCell(p[0] > 0 ? 0 : 1, true);
    const axis: Vec3[] = [[0, 1, 0], [0, -1, 0]];
    const src = sourcePoint([0, 0, 1], { plateAt, axis, delta: [0.05, 0.05], maxDelta: 0.05 });
    expect(src).toBeNull();
  });

  it('sobreposição: a continental fica por cima', () => {
    // Perto de (0,0,-1) as placas se aproximam; a 0 é continental, a 1 oceânica.
    const plateAt = (p: Vec3) => (p[0] > 0 ? packPlateCell(0, true) : packPlateCell(1, false));
    const axis: Vec3[] = [[0, 1, 0], [0, -1, 0]];
    const p: Vec3 = rotate([0, 0, -1], [0, 1, 0], 0.02); // ponto que era oceano e o continente cobriu
    const src = sourcePoint(p, { plateAt, axis, delta: [0.05, 0.05], maxDelta: 0.05 });
    expect(src?.plate).toBe(0);
  });

  it('extrapolação do ângulo: adianta pelo tempo, com limite, e nunca volta', () => {
    expect(extrapolateAngle(1, 0.5, 0.1, 0)).toBeCloseTo(1.05, 12);
    expect(extrapolateAngle(1, 0.5, 10, 0)).toBeCloseTo(1.15, 12); // no máximo 0,3 s à frente
    expect(extrapolateAngle(1, 0.5, 0.1, 2)).toBe(2); // não volta para trás
    expect(extrapolateAngle(1, 0, 5, 0)).toBe(1); // pausado
  });
});
