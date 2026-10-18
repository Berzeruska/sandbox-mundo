import { describe, expect, it } from 'vitest';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { createWorld } from '../../src/world/create';
import { Crust } from '../../src/world/plates';
import { Tectonics } from '../../src/world/tectonics';
import { advanceDisplayTick, candidatesOf, LINE_BIT, NEAR_CELLS, nearSteps, othersCanReach, packPlateCell, PLATE_MASK, rotate, sourcePoint } from '../../src/render/plate-motion';
import { packPlates } from '../../src/sim/core';

describe('movimento suave das placas (regra do shader)', () => {
  it('entre recomposições, o desenho interpolado bate com a recomposição completa (miolo das placas)', () => {
    const grid = new CubeSphere(64);
    const w = createWorld({ seedText: 'suave', seed: 11, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w, { relief: false });
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

  it('candidatas guardadas na textura dão o mesmo resultado que sondar em volta (miolo das placas)', () => {
    const grid = new CubeSphere(64);
    const w = createWorld({ seedText: 'suave', seed: 11, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w, { relief: false });
    t.recompose();
    const packed = packPlates(w);
    const valueAt = (p: Vec3) => {
      const c = grid.pointToCell(p[0], p[1], p[2]);
      return packed[c * 2]! | (packed[c * 2 + 1]! << 8);
    };
    const axis = w.plates.map((pl) => {
      const s = Math.hypot(...pl.omega);
      return [pl.omega[0] / s, pl.omega[1] / s, pl.omega[2] / s] as Vec3;
    });
    const step = grid.cellAngle * 1.8; // quase uma recomposição inteira
    const delta = axis.map(() => step);
    let same = 0;
    let total = 0;
    for (let c = 0; c < w.cellCount; c++) {
      const p: Vec3 = [grid.positions[c * 3]!, grid.positions[c * 3 + 1]!, grid.positions[c * 3 + 2]!];
      const probe = sourcePoint(p, { plateAt: valueAt, axis, delta, maxDelta: step });
      const stored = sourcePoint(p, { plateAt: valueAt, axis, delta, maxDelta: step, cellAngle: grid.cellAngle });
      total++;
      if ((probe?.plate ?? -1) === (stored?.plate ?? -1)) same++;
    }
    // As sondas olham só 4 direções; as guardadas cobrem tudo em volta: quase sempre concordam e,
    // quando não, a guardada achou uma placa que as sondas perderam.
    expect(same / total).toBeGreaterThan(0.995);
  });

  it('textura de placas: outras placas por perto (até NEAR_CELLS passos) e marca de "encosta"', () => {
    const grid = new CubeSphere(64);
    const w = createWorld({ seedText: 'x', seed: 2, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    const packed = packPlates(w);
    // Distância (passos) de cada célula até a placa vizinha mais próxima, por busca em largura.
    for (const target of [0, 1]) {
      const dist = new Int32Array(w.cellCount).fill(99);
      let frontier: number[] = [];
      for (let c = 0; c < w.cellCount; c++) if (w.plate[c] === target) { dist[c] = 0; frontier.push(c); }
      for (let d = 1; d <= NEAR_CELLS + 2 && frontier.length; d++) {
        const next: number[] = [];
        for (const c of frontier) for (let k = 0; k < 4; k++) {
          const nb = grid.neighbor(c, k);
          if (dist[nb]! > d) { dist[nb] = d; next.push(nb); }
        }
        frontier = next;
      }
      let checked = 0;
      for (let c = 0; c < w.cellCount; c++) {
        if (w.plate[c] === target) continue;
        const v = packed[c * 2]! | (packed[c * 2 + 1]! << 8);
        expect(v & PLATE_MASK).toBe(w.plate[c]);
        const has = candidatesOf(v).includes(target);
        // Perto: a placa-alvo está entre as candidatas (salvo cruzamento com 3+ placas, só 2 cabem).
        if (dist[c]! <= NEAR_CELLS && candidatesOf(v).length < 3) expect(has).toBe(true);
        if (dist[c]! > NEAR_CELLS) expect(has).toBe(false);
        if (dist[c] === 1) expect(v & LINE_BIT).toBe(LINE_BIT);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('distância guardada até a outra placa mais perto nunca passa da verdadeira (RG: pular a busca é seguro)', () => {
    for (const seed of [2, 7]) {
      const grid = new CubeSphere(64);
      const w = createWorld({ seedText: String(seed), seed, n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
      const packed = packPlates(w);
      // Distância (passos) até a célula de outra placa mais perto, por busca em largura de cada placa.
      const nearest = new Int32Array(w.cellCount).fill(99);
      const plates = new Set(w.plate);
      for (const target of plates) {
        const dist = new Int32Array(w.cellCount).fill(99);
        let frontier: number[] = [];
        for (let c = 0; c < w.cellCount; c++) if (w.plate[c] === target) { dist[c] = 0; frontier.push(c); }
        for (let d = 1; d <= NEAR_CELLS + 2 && frontier.length; d++) {
          const next: number[] = [];
          for (const c of frontier) for (let k = 0; k < 4; k++) {
            const nb = grid.neighbor(c, k);
            if (dist[nb]! > d) { dist[nb] = d; next.push(nb); }
          }
          frontier = next;
        }
        for (let c = 0; c < w.cellCount; c++) if (w.plate[c] !== target) nearest[c] = Math.min(nearest[c]!, dist[c]!);
      }
      let skipped = 0;
      for (let c = 0; c < w.cellCount; c++) {
        const v = packed[c * 2]! | (packed[c * 2 + 1]! << 8);
        if (nearest[c]! <= NEAR_CELLS) expect(nearSteps(v)).toBeLessThanOrEqual(nearest[c]!);
        // Placas que andaram 1 célula: as células a mais de ~5 passos de outra placa não testam ninguém.
        if (!othersCanReach(v, grid.cellAngle, grid.cellAngle)) skipped++;
      }
      expect(skipped / w.cellCount).toBeGreaterThan(0.5);
    }
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

  it('relógio do desenho: segue o ritmo, corrige aos poucos, nunca volta nem salta', () => {
    const dt = 1 / 60;
    const rate = 240; // 20×
    // Em regime: alvo andando no mesmo ritmo -> anda exatamente o nominal.
    expect(advanceDisplayTick(100, 100, rate, dt)).toBeCloseTo(104, 9);
    // Worker parou de mandar (alvo congelado e já ultrapassado): desacelera, mas não volta.
    let d = 100;
    for (let k = 0; k < 120; k++) {
      const next = advanceDisplayTick(d, 100, rate, dt);
      expect(next).toBeGreaterThanOrEqual(d);
      expect(next - d).toBeLessThanOrEqual(3 * rate * dt + 1e-9);
      d = next;
    }
    // Ficou para trás: alcança, sem salto (no máximo 3× o passo nominal por quadro).
    d = 0;
    const target = 120;
    const next = advanceDisplayTick(d, target, rate, dt);
    expect(next - d).toBeLessThanOrEqual(3 * rate * dt + 1e-9);
    for (let k = 0; k < 600; k++) d = advanceDisplayTick(d, target + rate * dt * k, rate, dt);
    expect(Math.abs(d - (target + rate * dt * 599))).toBeLessThan(rate * 0.1);
    // Pausado: espera se passou; alcança suavemente se ficou para trás.
    expect(advanceDisplayTick(50, 40, 0, dt)).toBe(50);
    expect(advanceDisplayTick(40, 50, 0, dt)).toBeGreaterThan(40);
    expect(advanceDisplayTick(40, 50, 0, dt)).toBeLessThan(50);
  });
});
