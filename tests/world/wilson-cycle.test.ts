import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { MAX_PLATE_RATE, TENURE, TENURE_JITTER_MAX, Tectonics } from '../../src/world/tectonics';

/**
 * Bloco G2 (pedido do usuário, 2026-10-15): ciclo de Wilson. O supercontinente se forma, fica um
 * tempo e racha de novo pelas suturas; a deriva nunca morre.
 */

const TICKS_PER_MINUTE = 60 * 240; // 20× = 240 passos por segundo
const N = 128;
const grid = new CubeSphere(N);

/** Velocidade relativa média entre placas vizinhas (atividade nas fronteiras). */
function boundaryActivity(w: WorldState, t: Tectonics): number {
  const { positions, neighbors } = w.grid;
  let sum = 0;
  let count = 0;
  for (let c = 0; c < w.cellCount; c++) {
    const a = w.plate[c]!;
    for (let d = 0; d < 4; d++) {
      const b = w.plate[neighbors[c * 4 + d]!]!;
      if (b === a) continue;
      const ma = t.plateMotion(a);
      const mb = t.plateMotion(b);
      const o = [0, 1, 2].map((i) => ma.axis[i]! * ma.speed - mb.axis[i]! * mb.speed);
      const p = [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!];
      sum += Math.hypot(o[1]! * p[2]! - o[2]! * p[1]!, o[2]! * p[0]! - o[0]! * p[2]!, o[0]! * p[1]! - o[1]! * p[0]!);
      count++;
      break;
    }
  }
  return sum / Math.max(1, count);
}

/** Quantos grupos soldados têm placas com continente de verdade (≥ 1,5% do planeta). */
function continentalGroups(w: WorldState, t: Tectonics): number {
  const cont = new Float64Array(w.plates.length);
  for (let c = 0; c < w.cellCount; c++) if (w.crust[c] === Crust.Continental) cont[w.plate[c]!]!++;
  const roots = new Set<number>();
  for (let p = 0; p < w.plates.length; p++) if (cont[p]! >= 0.015 * w.cellCount) roots.add(t.groupOf(p));
  return roots.size;
}

describe('G2: ciclo de Wilson em 15 min a 20× com placas 100%', () => {
  it.each(['terra', 'mundo', '7', '42', 'ilha'])('semente "%s": o supercontinente se forma e racha, e a deriva não morre', (seedText) => {
    const w = createWorld({ seedText, seed: seedFrom(seedText), n: N, seaLevel: 0, landFraction: 0.3 }, grid);
    const t = new Tectonics(w);
    const every = TICKS_PER_MINUTE / 8;
    const activity0 = boundaryActivity(w, t);
    let oneGroup = 0;
    let longestOneGroup = 0;
    let low = 0;
    let longestLow = 0;
    for (let k = 1; k <= 15 * TICKS_PER_MINUTE; k++) {
      t.step(1);
      if (k % every) continue;
      oneGroup = continentalGroups(w, t) === 1 ? oneGroup + every : 0;
      longestOneGroup = Math.max(longestOneGroup, oneGroup);
      low = boundaryActivity(w, t) < 0.3 * activity0 ? low + every : 0;
      longestLow = Math.max(longestLow, low);
    }
    expect(t.cycle.supercontinents).toBeGreaterThanOrEqual(1);
    expect(t.cycle.ruptures).toBeGreaterThanOrEqual(1);
    // Um grupo continental só por no máximo 1,5 mandato (o mais longo sorteado).
    expect(longestOneGroup * MAX_PLATE_RATE).toBeLessThanOrEqual(1.5 * TENURE * TENURE_JITTER_MAX);
    // Atividade nas fronteiras abaixo de 30% da inicial por no máximo um mandato (o supercontinente
    // quase para enquanto dura: a atividade baixa é o próprio mandato).
    expect(longestLow * MAX_PLATE_RATE).toBeLessThanOrEqual(TENURE * TENURE_JITTER_MAX);
  }, 120_000);
});

describe('G2: ruptura', () => {
  /**
   * Duas placas de continente lado a lado (x > 0 e x ≤ 0, só no sul: z < −0,2) e uma terceira,
   * oceânica, no resto do planeta. Uma fenda simples na linha x = 0.
   */
  function weldedBlock() {
    const g = new CubeSphere(64);
    const w = new WorldState({ seedText: '', seed: 11, n: 64, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) {
      const x = g.positions[i * 3]!;
      const z = g.positions[i * 3 + 2]!;
      const land = z < -0.2;
      w.plate[i] = land ? (x > 0 ? 0 : 1) : 2;
      w.elevation[i] = land ? 300 : -4000;
      w.crust[i] = land ? Crust.Continental : Crust.Oceanic;
    }
    const plate = (id: number, center: Vec3) => ({ id, seed: center, center, omega: [0, 0.2, 0] as Vec3, continental: 1, color: [0, 0, 0] as const });
    w.plates = [plate(0, [0.7, 0, -0.7]), plate(1, [-0.7, 0, -0.7]), plate(2, [0, 0, 1])];
    return w;
  }

  it('racha pelas suturas, e cada pedaço gira para abrir a fenda (sem voltar a se soldar)', () => {
    const w = weldedBlock();
    const t = new Tectonics(w, { relief: false });
    // Solda à mão (como se tivessem colidido).
    const weld = (t as unknown as { weld(a: number, b: number): void }).weld.bind(t);
    weld(0, 1);
    expect(t.groupOf(1)).toBe(t.groupOf(0));
    expect(t.forceRupture()).toBe(true);
    expect(t.cycle.ruptures).toBe(1);
    expect(t.sutureList()).toHaveLength(0);
    expect(t.groupOf(1)).not.toBe(t.groupOf(0));
    // Na fenda continental entre pedaços diferentes, as placas se afastam (velocidade normal < 0).
    // (A divisa oceânica do outro lado de uma placa que envolve outra não abre inteira: subducção.)
    const { positions, neighbors } = w.grid;
    let opening = 0;
    let closing = 0;
    // A fenda principal (entre as duas placas soldadas): quase toda abrindo.
    let mainOpening = 0;
    let mainClosing = 0;
    for (let c = 0; c < w.cellCount; c++) {
      const a = w.plate[c]!;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d]!;
        const b = w.plate[k]!;
        if (b === a || t.groupOf(a) === t.groupOf(b)) continue;
        if (w.crust[c] !== Crust.Continental || w.crust[k] !== Crust.Continental) continue;
        const ma = t.plateMotion(a);
        const mb = t.plateMotion(b);
        const o = [0, 1, 2].map((i) => ma.axis[i]! * ma.speed - mb.axis[i]! * mb.speed);
        const p = [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!];
        const n = [positions[k * 3]! - p[0]!, positions[k * 3 + 1]! - p[1]!, positions[k * 3 + 2]! - p[2]!];
        const v = [o[1]! * p[2]! - o[2]! * p[1]!, o[2]! * p[0]! - o[0]! * p[2]!, o[0]! * p[1]! - o[1]! * p[0]!];
        const vn = v[0]! * n[0]! + v[1]! * n[1]! + v[2]! * n[2]!;
        // Degrau de falha transformante (G3): a divisa corre junto com o movimento, nem abre nem
        // fecha. Só contam os trechos com velocidade normal de verdade.
        if (Math.abs(vn) < 0.3 * Math.hypot(v[0]!, v[1]!, v[2]!) * Math.hypot(n[0]!, n[1]!, n[2]!)) continue;
        const main = (a === 0 && b === 1) || (a === 1 && b === 0);
        if (vn < 0) {
          opening++;
          if (main) mainOpening++;
        } else {
          closing++;
          if (main) mainClosing++;
        }
      }
    }
    expect(mainOpening).toBeGreaterThan(0);
    expect(mainClosing / (mainOpening + mainClosing)).toBeLessThan(0.1);
    // Com o braço novo da junção tríplice (G3), que é curvo, um giro rígido não abre todos os trechos:
    // nas curvas há compressão (como nos riftes de verdade). No conjunto, a grande maioria abre.
    expect(closing / (opening + closing)).toBeLessThan(0.2);
    // Andando 1 min de jogo, os pedaços não voltam a se soldar.
    const welds = t.welds;
    for (let k = 0; k < TICKS_PER_MINUTE; k++) t.step(1);
    expect(t.welds).toBe(welds);
  });

  it('mesma semente, mesmo ciclo (determinístico)', () => {
    const run = () => {
      const w = createWorld({ seedText: 'mundo', seed: seedFrom('mundo'), n: 64, seaLevel: 0, landFraction: 0.3 });
      const t = new Tectonics(w);
      for (let k = 0; k < 10 * TICKS_PER_MINUTE; k++) t.step(1);
      return { cycle: t.cycle, welds: t.welds, plates: Array.from(w.plate) };
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
