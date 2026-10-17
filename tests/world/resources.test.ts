import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { applyBrush, Tool } from '../../src/input/tools';
import { buildColors, DECOR_BIT, NO_LAYERS } from '../../src/render/colors';
import { GeologyEngine, worldArrays, type GeologyEvent } from '../../src/sim/geology';
import { createWorld } from '../../src/world/create';
import { CubeSphere, type Vec3 } from '../../src/world/cubesphere';
import { Crust } from '../../src/world/plates';
import {
  ALL_RESOURCES,
  countDeposits,
  depositLabel,
  depositSize,
  depositType,
  DepositSize,
  environmentOf,
  fitsEnvironment,
  generateDeposits,
  isHiddenOil,
  isRevealed,
  packDeposit,
  Resource,
  RESOURCE_INFO,
  RESOURCE_TYPES,
} from '../../src/world/resources';
import { WorldState } from '../../src/world/state';
import { Tectonics } from '../../src/world/tectonics';

const SEEDS = ['terra', 'mundo', '42', '7', 'pangeia'];
const worldOf = (seed: string, n = 128) => createWorld({ seedText: seed, seed: seedFrom(seed), n, seaLevel: 0, landFraction: 0.3 });

/** Jazidas (componentes ligados com o mesmo código): lista de células de cada uma. */
function deposits(w: WorldState): { code: number; cells: number[] }[] {
  const out: { code: number; cells: number[] }[] = [];
  const seen = new Uint8Array(w.cellCount);
  const { neighbors } = w.grid;
  for (let s = 0; s < w.cellCount; s++) {
    const code = w.deposit[s]!;
    if (!code || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    for (let k = 0; k < cells.length; k++) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[cells[k]! * 4 + d]!;
        if (!seen[j] && w.deposit[j] === code) {
          seen[j] = 1;
          cells.push(j);
        }
      }
    }
    out.push({ code, cells });
  }
  return out;
}

describe('recursos minerais (T6): geração', () => {
  const worlds = SEEDS.map((s) => worldOf(s));

  it('código de 1 byte: tipo, tamanho e revelado vão e voltam', () => {
    for (let t = 1; t <= RESOURCE_TYPES; t++) {
      for (const size of [DepositSize.Small, DepositSize.Medium, DepositSize.Large]) {
        const code = packDeposit(t as Resource, size, t === Resource.Oil);
        expect(depositType(code)).toBe(t);
        expect(depositSize(code)).toBe(size);
        expect(isRevealed(code)).toBe(t === Resource.Oil);
      }
    }
    expect(RESOURCE_INFO.length - 1).toBe(19);
    expect(depositLabel(packDeposit(Resource.Copper, DepositSize.Large))).toBe('Cobre · jazida grande');
    expect(depositLabel(packDeposit(Resource.Oil, DepositSize.Small))).toBe('Petróleo · jazida pequena (escondido)');
  });

  it('cada tipo nasce no ambiente geológico certo (ex.: nenhum cobre longe de arco ou cordilheira)', () => {
    for (const w of worlds) {
      const env = environmentOf(w);
      for (const d of deposits(w)) {
        const type = depositType(d.code);
        // A jazida cresce pelas vizinhas; a célula onde ela nasceu (pelo menos uma) tem o ambiente do tipo.
        expect(d.cells.some((c) => fitsEnvironment(type, env(c))), `${RESOURCE_INFO[type]!.name} em ${w.params.seedText}`).toBe(true);
      }
    }
  });

  it('jazidas em terra (ou plataforma, só petróleo e calcário) e de tamanho certo', () => {
    for (const w of worlds) {
      for (const d of deposits(w)) {
        const type = depositType(d.code);
        const max = { 1: 2, 2: 6, 3: 15 }[depositSize(d.code)]!;
        expect(d.cells.length).toBeLessThanOrEqual(max);
        for (const c of d.cells) {
          if (type === Resource.Oil || type === Resource.Limestone) expect(w.crust[c]).toBe(Crust.Continental);
          else expect(w.heightAboveSea(c)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('poucas e importantes: 30 a 90 jazidas por mundo; nióbio é raro (até 2)', () => {
    for (const w of worlds) {
      const counts = countDeposits(w);
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(30);
      expect(total).toBeLessThanOrEqual(90);
      expect(counts[Resource.Niobium]).toBeLessThanOrEqual(2);
    }
  });

  it('nenhum continente tem de tudo: cada tipo fica em poucas regiões (províncias)', () => {
    for (const w of worlds) {
      const counts = countDeposits(w);
      for (let t = 1; t <= RESOURCE_TYPES; t++) expect(counts[t]).toBeLessThanOrEqual(12);
    }
  });

  it('mesma semente, mesmas jazidas', () => {
    const a = worldOf('terra', 64);
    const b = worldOf('terra', 64);
    expect(a.deposit).toEqual(b.deposit);
    generateDeposits(a);
    expect(a.deposit).toEqual(b.deposit);
  });
});

describe('recursos minerais (T6): andam com a placa', () => {
  it('depois de girar uma placa, as jazidas dela giram junto', () => {
    const axis: Vec3 = [0.3, 0.9, 0.3].map((v, _, a) => v / Math.hypot(...a)) as Vec3;
    const g = new CubeSphere(32);
    const w = new WorldState({ seedText: '', seed: 0, n: 32, seaLevel: 0, landFraction: 0.3 }, g);
    for (let i = 0; i < w.cellCount; i++) {
      w.plate[i] = 0;
      w.elevation[i] = 500;
      w.crust[i] = Crust.Continental;
      if (i % 97 === 0) w.deposit[i] = packDeposit(Resource.Iron, DepositSize.Small);
    }
    w.plates = [{ id: 0, seed: [0, 1, 0], center: [0, 1, 0], omega: axis, continental: 0, color: [0, 0, 0] }];
    const before = Uint8Array.from(w.deposit);
    const t = new Tectonics(w, { relief: false });
    const angle = 0.37;
    t.angle[0] = angle;
    t.recompose();
    t.writeDeposits(w.deposit);
    // Mesma regra do teste de rotação da tectônica: cada célula mostra o ponto girado de volta.
    const rot = (v: Vec3, a: number): Vec3 => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
      return [
        v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d * (1 - c),
        v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d * (1 - c),
        v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d * (1 - c),
      ];
    };
    let moved = 0;
    for (let c = 0; c < w.cellCount; c++) {
      const back = rot([g.positions[c * 3]!, g.positions[c * 3 + 1]!, g.positions[c * 3 + 2]!], -angle);
      const from = g.pointToCell(back[0], back[1], back[2]);
      expect(w.deposit[c]).toBe(before[from]);
      if (w.deposit[c] && c !== from) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('recursos minerais (T6): formação durante a deriva', () => {
  it('nascem jazidas nas frentes ativas, do tipo certo para cada frente; mesmo resultado repetindo', () => {
    const run = () => {
      const grid = new CubeSphere(64);
      const world = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
      let results = 0;
      const consumed: number[] = [];
      const emit = (e: GeologyEvent) => {
        if (e.type !== 'result') return;
        results++;
        consumed.push(e.result.index);
      };
      const engine: GeologyEngine = new GeologyEngine({ world: 1, params: world.params, plates: world.plates, arrays: worldArrays(world), rate: 1, layers: NO_LAYERS, climateControl: 0 }, grid, emit, () => 0);
      let tick = 0;
      while (results < 120) {
        tick += 20;
        engine.receive({ type: 'advance', world: 1, tick });
        for (const index of consumed.splice(0)) engine.receive({ type: 'consumed', world: 1, index });
      }
      return engine;
    };
    const a = run();
    const formed = a.formation.formed;
    expect(formed.length).toBeGreaterThan(0);
    const allowed = {
      arco: [Resource.Copper, Resource.Gold, Resource.Silver, Resource.Sulfur, Resource.Lithium],
      colisão: [Resource.Gold, Resource.Tin, Resource.Chromium],
      rifte: [Resource.Oil, Resource.Salt],
    };
    for (const f of formed) expect(allowed[f.kind]).toContain(f.type);
    const b = run();
    expect(b.world.deposit).toEqual(a.world.deposit);
  }, 120_000);
});

describe('recursos minerais (T6): petróleo escondido e cores', () => {
  it('Rebaixar em cima de petróleo escondido revela; Elevar não', () => {
    const w = worldOf('terra', 64);
    const c = [...w.deposit.keys()].find((i) => w.heightAboveSea(i) > 0) ?? 0;
    w.deposit[c] = packDeposit(Resource.Oil, DepositSize.Medium);
    const p: Vec3 = [w.grid.positions[c * 3]!, w.grid.positions[c * 3 + 1]!, w.grid.positions[c * 3 + 2]!];
    applyBrush(w, Tool.Raise, p, 3, 0.05);
    expect(isHiddenOil(w.deposit[c]!)).toBe(true);
    const r = applyBrush(w, Tool.Lower, p, 3, 0.05);
    expect(isRevealed(w.deposit[c]!)).toBe(true);
    expect(r.revealed).toContain(c);
  });

  it('cores: minério em terra tem o bit de "desenhar de perto"; petróleo escondido não aparece', () => {
    const w = worldOf('terra', 64);
    const land = [...w.deposit.keys()].filter((i) => w.heightAboveSea(i) > 0).slice(0, 2);
    w.deposit[land[0]!] = packDeposit(Resource.Iron, DepositSize.Small);
    w.deposit[land[1]!] = packDeposit(Resource.Oil, DepositSize.Small);
    const out = new Uint8Array(w.cellCount * 4);
    buildColors(w, out);
    expect(out[land[0]! * 4 + 2]! & DECOR_BIT).toBe(DECOR_BIT);
    expect(out[land[1]! * 4 + 2]! & DECOR_BIT).toBe(0);
    // Petróleo escondido não muda a cor na visão normal.
    const plain = new Uint8Array(w.cellCount * 4);
    w.deposit[land[1]!] = 0;
    buildColors(w, plain);
    expect([...out.subarray(land[1]! * 4, land[1]! * 4 + 3)]).toEqual([...plain.subarray(land[1]! * 4, land[1]! * 4 + 3)]);
  });

  it('camada "Ver recursos": jazida fora do filtro fica cinza como o terreno', () => {
    const w = worldOf('terra', 64);
    const c = [...w.deposit.keys()].find((i) => w.heightAboveSea(i) > 0 && !w.deposit[i])!;
    w.deposit.fill(0);
    w.deposit[c] = packDeposit(Resource.Copper, DepositSize.Small);
    const on = new Uint8Array(w.cellCount * 4);
    buildColors(w, on, undefined, { ...NO_LAYERS, resources: true, resourceMask: ALL_RESOURCES });
    const off = new Uint8Array(w.cellCount * 4);
    buildColors(w, off, undefined, { ...NO_LAYERS, resources: true, resourceMask: 1 << Resource.Iron });
    const [r, g, b] = [off[c * 4]!, off[c * 4 + 1]!, off[c * 4 + 2]!];
    // Cinza: os três canais quase iguais.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    // No filtro: puxado para o verde do cobre.
    expect(on[c * 4 + 1]!).toBeGreaterThan(on[c * 4]! + 40);
  });
});
