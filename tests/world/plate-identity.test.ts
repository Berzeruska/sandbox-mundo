import { describe, expect, it } from 'vitest';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import { WorldState } from '../../src/world/state';
import { FRAGMENT_SHARE, Tectonics, WELD_AFTER } from '../../src/world/tectonics';

/** Placas com identidade fixa (M2 D3): polaridade da subducção, solda continental e pedaços soltos. */

const plate = (id: number, omega: Vec3, center: Vec3) => ({ id, seed: center, center, omega, continental: 0, color: [0, 0, 0] as const });

/**
 * Duas placas (x > 0 e x ≤ 0) girando em sentidos opostos em torno de Y: perto de (0,0,-1) se
 * aproximam. `elev(i, east)` escolhe o relevo de cada célula.
 */
function twoPlates(elev: (i: number, east: boolean) => number, n = 64) {
  const g = new CubeSphere(n);
  const w = new WorldState({ seedText: '', seed: 5, n, seaLevel: 0, landFraction: 0.3 }, g);
  for (let i = 0; i < w.cellCount; i++) {
    const east = g.positions[i * 3]! > 0;
    w.plate[i] = east ? 0 : 1;
    w.elevation[i] = elev(i, east);
    w.crust[i] = w.elevation[i]! > -500 ? Crust.Continental : Crust.Oceanic;
  }
  w.plates = [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, -1, 0], [-1, 0, 0])];
  return { g, w };
}

/** Avança as placas pelo próprio relógio (como no jogo) até `recompositions` recomposições. */
function drift(t: Tectonics, recompositions: number): void {
  const target = t.recompositions + recompositions;
  while (t.recompositions < target) t.step(1);
}

describe('placas com identidade fixa', () => {
  it('duas oceânicas que se aproximam: uma só mergulha, ao longo de toda a fronteira, sem trocar de dono', () => {
    // Fundo oceânico com profundidade variando célula a célula e mesma idade dos dois lados: era
    // exatamente o caso em que cada célula escolhia um lado e as placas se comiam alternadamente.
    const { w } = twoPlates((i) => -4000 - ((i * 7919) % 997));
    const t = new Tectonics(w, { relief: false });
    const flips: number[] = [];
    let prev2: Uint8Array | null = null;
    let prev: Uint8Array | null = null;
    for (let r = 0; r < 10; r++) {
      drift(t, 1);
      const cur = Uint8Array.from(w.plate);
      if (prev && prev2) {
        let f = 0;
        for (let c = 0; c < cur.length; c++) if (cur[c] === prev2[c] && cur[c] !== prev[c]) f++;
        flips.push(f);
      }
      prev2 = prev;
      prev = cur;
    }
    // Só o arredondamento de 1 célula na linha da fronteira (antes: centenas por recomposição).
    expect(Math.max(...flips)).toBeLessThan(0.002 * w.cellCount);
    // Na região de aproximação, só uma das placas perdeu crosta: a outra avança inteira.
    const near: number[] = [];
    for (let c = 0; c < w.cellCount; c++) if (w.grid.positions[c * 3 + 2]! < -0.9) near.push(c);
    const east = near.filter((c) => w.plate[c] === 0).length;
    const west = near.length - east;
    expect(Math.min(east, west) / near.length).toBeLessThan(0.35);
  });

  it(`continentes que colidem erguem cordilheira e, depois de ${WELD_AFTER} recomposições, se soldam e param`, () => {
    const { w } = twoPlates(() => 300);
    const t = new Tectonics(w);
    drift(t, WELD_AFTER + 1);
    expect(t.welds).toBe(1);
    // Passam a girar juntas: mesmo eixo e mesma velocidade.
    const a = t.plateMotion(0);
    const b = t.plateMotion(1);
    expect(a.speed).toBeCloseTo(b.speed, 9);
    for (let d = 0; d < 3; d++) expect(a.axis[d]).toBeCloseTo(b.axis[d]!, 9);
    // Cordilheira na frente de colisão.
    expect(Math.max(...w.elevation)).toBeGreaterThan(1800);
    // Depois da solda, nada mais é consumido: a crosta não diminui (só buracos de arredondamento
    // de 1 célula na divisa são cicatrizados) e a área de cada placa não muda. A divisa pode andar
    // pela grade (o bloco soldado gira junto), mas uma placa não avança sobre a outra.
    const samples = t.sampleCount;
    const area = (p: number) => [...w.plate].filter((x) => x === p).length;
    const area0 = area(0);
    for (let r = 0; r < 4; r++) {
      // Gira o bloco direto pelo ângulo (o giro comum é lento: os dois movimentos quase se anulam).
      t.angle[0] = t.angle[0]! + 2 * w.grid.cellAngle;
      t.angle[1] = t.angle[1]! + 2 * w.grid.cellAngle;
      t.recompose();
    }
    expect(t.welds).toBe(1);
    expect(t.sampleCount).toBeGreaterThanOrEqual(samples);
    expect(t.sampleCount - samples).toBeLessThan(0.001 * w.cellCount);
    expect(Math.abs(area(0) - area0)).toBeLessThan(0.003 * w.cellCount);
  });

  it('pedaço pequeno solto de uma placa gruda na placa vizinha e leva a crosta junto', () => {
    const n = 64;
    const g = new CubeSphere(n);
    const w = new WorldState({ seedText: '', seed: 9, n, seaLevel: 0, landFraction: 0.3 }, g);
    // Placa 0 é quase tudo; placa 1 é uma ilhota (menor que o limite) com um morro, mais um
    // pedaço grande do outro lado do planeta (para a placa 1 continuar existindo).
    const islet: number[] = [];
    for (let i = 0; i < w.cellCount; i++) {
      const x = g.positions[i * 3]!;
      const z = g.positions[i * 3 + 2]!;
      const inIslet = z > 0.995;
      w.plate[i] = inIslet || x < -0.5 ? 1 : 0;
      w.elevation[i] = inIslet ? 1500 : -3000;
      w.crust[i] = inIslet ? Crust.Continental : Crust.Oceanic;
      if (inIslet) islet.push(i);
    }
    expect(islet.length).toBeGreaterThan(0);
    expect(islet.length).toBeLessThan(FRAGMENT_SHARE * w.cellCount);
    // As duas placas paradas uma em relação à outra (mesmo giro): só a regra do pedaço age.
    w.plates = [plate(0, [0, 1, 0], [1, 0, 0]), plate(1, [0, 1, 0], [-1, 0, 0])];
    const t = new Tectonics(w, { relief: false });
    drift(t, 1);
    expect(t.fragmentsAbsorbed).toBe(1);
    // A ilhota (agora girada junto com tudo) é da placa 0 e mantém o morro.
    const hill = [...w.elevation].filter((e) => e === 1500).length;
    expect(hill).toBeGreaterThan(islet.length * 0.8);
    for (let c = 0; c < w.cellCount; c++) if (w.elevation[c] === 1500) expect(w.plate[c]).toBe(0);
    // E continua andando com a nova dona nas recomposições seguintes (não some nem volta).
    drift(t, 3);
    expect([...w.elevation].filter((e) => e === 1500).length).toBeGreaterThan(islet.length * 0.8);
    expect(t.fragmentsAbsorbed).toBe(1);
  });
});
