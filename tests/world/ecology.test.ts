import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import { Biome } from '../../src/world/biomes';
import { CellState } from '../../src/world/disasters/ground';
import { BLOCK, Ecology, TRAITS } from '../../src/world/ecology';
import { SPECIES, SPECIES_COUNT, speciesIndex } from '../../src/world/species';
import type { WorldState } from '../../src/world/state';

const N = 64, TICKS = 12;
const worlds = new Map<string, WorldState>();
function worldOf(seedText: string): WorldState {
  let w = worlds.get(seedText);
  if (!w) { w = createWorld({ seedText, seed: seedFrom(seedText), n: N, seaLevel: 0, landFraction: 0.3 }); worlds.set(seedText, w); }
  return w;
}
function run(e: Ecology, years: number, from = 0, each?: (year: number) => void): void {
  for (let tick = from * TICKS; tick < (from + years) * TICKS; tick++) if (e.step(tick)) each?.(Math.floor(tick / TICKS));
}
const ix = speciesIndex;
/** Bloco com mais capacidade para a espécie. */
function bestBlock(e: Ecology, s: number): number {
  let best = 0, at = 0;
  for (let b = 0; b < e.blocks; b++) if ((e.cap[s * e.blocks + b] as number) > best) { best = e.cap[s * e.blocks + b] as number; at = b; }
  return at;
}

describe('ecologia: plantas e capacidade (E1)', () => {
  it('a capacidade de planta segue o bioma: floresta sustenta mais que deserto, mar não sustenta', () => {
    const w = worldOf('terra'), e = new Ecology(w, null);
    const mean = (biome: number): number => {
      let sum = 0, n = 0;
      for (let b = 0; b < e.blocks; b++) {
        const c = e.centerCell(b);
        if (w.biome[c] === biome && !w.isWater(c) && !w.ice[c]) { sum += e.plantCap[b] as number; n++; }
      }
      return n ? sum / n : NaN;
    };
    expect(mean(Biome.TropicalForest)).toBeGreaterThan(mean(Biome.Savanna));
    expect(mean(Biome.Savanna)).toBeGreaterThan(mean(Biome.HotDesert));
    for (let b = 0; b < e.blocks; b++) { expect(e.plantCap[b]).toBeGreaterThanOrEqual(0); expect(e.plantCap[b]).toBeLessThanOrEqual(1.2); }
  });
  it('a biomassa cresce de forma logística até a capacidade e para nela', () => {
    const e = new Ecology(worldOf('terra'), null);
    const b = bestBlock(e, ix('macaco')), cap = e.plantCap[b] as number;
    e.plant[b] = cap * 0.05;
    const seen: number[] = [];
    run(e, 30, 0, () => seen.push(e.plant[b] as number));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(cap + 1e-6);
    expect(seen[2]).toBeGreaterThan(cap * 0.05);
    expect(seen[seen.length - 1]).toBeGreaterThan(cap * 0.9);
  });
  it('custo de memória dentro do teto de 60 MB da especificação', () => {
    expect(new Ecology(worldOf('terra'), null).bytes).toBeLessThan(60 * 1048576);
  });
});

describe('ecologia: populações sem predador (E2)', () => {
  it('uma presa sozinha cresce até a capacidade do bloco e não passa muito dela', () => {
    const e = new Ecology(worldOf('terra'), null);
    e.pop.fill(0);
    const s = ix('zebra'), b = bestBlock(e, s), k = e.cap[s * e.blocks + b] as number;
    expect(k).toBeGreaterThan(1);
    e.place(s, e.centerCell(b), 2);
    const seen: number[] = [];
    run(e, 120, 0, () => seen.push(e.blockPopulation(s, b)));
    expect(seen[10]).toBeGreaterThan(2);
    expect(Math.max(...seen)).toBeLessThan(k * 1.6);
    expect(seen[seen.length - 1]).toBeGreaterThan(k * 0.4);
  });
  it('fora do bioma dela a espécie some', () => {
    const w = worldOf('terra'), e = new Ecology(w, null);
    e.pop.fill(0);
    const s = ix('camelo'), b = bestBlock(e, ix('macaco'));
    expect(e.cap[s * e.blocks + b]).toBe(0);
    e.pop[s * e.blocks + b] = 20;
    run(e, 40);
    expect(e.blockPopulation(s, b)).toBeLessThan(1);
  });
  it('a população se espalha para os blocos vizinhos que a sustentam (migração)', () => {
    const e = new Ecology(worldOf('terra'), null);
    e.pop.fill(0);
    const s = ix('bisao'), b = bestBlock(e, s);
    e.place(s, e.centerCell(b), 20);
    run(e, 60);
    let blocks = 0;
    for (let q = 0; q < e.blocks; q++) if (e.blockPopulation(s, q) > 0.5) blocks++;
    expect(blocks).toBeGreaterThan(3);
  });
});

describe('ecologia: predador e presa (E3)', () => {
  it('com o caçador a presa fica abaixo do que teria sozinha, e o refúgio a segura acima de zero', () => {
    const w = worldOf('terra');
    const alone = new Ecology(w, null), hunted = new Ecology(w, null);
    alone.pop.fill(0, ix('leao') * alone.blocks, (ix('leao') + 1) * alone.blocks);
    run(alone, 150); run(hunted, 150);
    const z = ix('zebra');
    expect(hunted.totals[z]).toBeLessThan((alone.totals[z] as number) * 0.95);
    expect(hunted.totals[z]).toBeGreaterThan((alone.totals[z] as number) * 0.1);
  });
  it('caçador sem presa morre de fome', () => {
    const e = new Ecology(worldOf('terra'), null);
    for (const prey of ['zebra', 'antilope'] as const) e.pop.fill(0, ix(prey) * e.blocks, (ix(prey) + 1) * e.blocks);
    const before = e.totals[ix('leao')] as number;
    run(e, 30);
    expect(e.totals[ix('leao')]).toBeLessThan(before * 0.2);
  });
  it('mesma semente, mesmas populações (determinismo)', () => {
    const a = new Ecology(worldOf('mundo'), null), b = new Ecology(worldOf('mundo'), null);
    run(a, 60); run(b, 60);
    expect(Array.from(a.totals)).toEqual(Array.from(b.totals));
    expect(a.pop).toEqual(b.pop);
  });
});

/**
 * Teste de aceite do M3 (`docs/M3-especificacao.md`, item 8): 1.000 anos, sem desenho, sementes fixas, sem relógio real e sem desastre.
 * Critérios (escritos antes de medir; os números ficam em `docs/decisoes.md`):
 *  (a) nenhuma extinção em massa: em nenhuma janela de 100 anos somem 20% ou mais das espécies que o mundo tinha;
 *  (b) as populações não ficam paradas: toda espécie presente varia pelo menos 1% (desvio sobre a média do total do mundo, anos 200 a 1.000);
 *  (c) ciclos de predador e presa em pelo menos 3 pares: na região onde o caçador mais vive, ele varia pelo menos 5% e acompanha a presa com atraso (correlação acima de 0,2 com a presa de 1 a 15 anos antes);
 *  (d) mesma semente, mesmo resultado.
 * Semente que falhar entra em FALHAS_CONHECIDAS com o motivo: não sai da lista de sementes e o critério não muda.
 */
const SEEDS = ['terra', 'mundo', '42', 'pangeia', 'gaia'] as const;
const FALHAS_CONHECIDAS: Partial<Record<(typeof SEEDS)[number], string>> = {};
const PAIRS = [['leao', 'zebra'], ['lobo', 'cervo'], ['onca', 'capivara'], ['loboArtico', 'rena'], ['tubarao', 'cardume'], ['aguia', 'cabra'], ['lobo', 'javali'], ['leao', 'antilope']] as const;

interface Accept { extinctWindow: number; present: number; still: string[]; cycles: string[]; totals: number[] }
function accept(seedText: string): Accept {
  const e = new Ecology(worldOf(seedText), null);
  const present = SPECIES.map((sp, s) => !sp.mythic && (e.totals[s] as number) >= 20);
  const series: number[][] = SPECIES.map(() => []);
  const extinctAt: number[] = [];
  // Região de cada par: o bloco onde o caçador mais vive, com os quatro vizinhos.
  const regions = PAIRS.map(([p]) => { const b = e.densest(ix(p)); return [b, ...[0, 1, 2, 3].map((d) => (e as unknown as { neighbors: Int32Array }).neighbors[b * 4 + d] as number)]; });
  const local: [number[], number[]][] = PAIRS.map(() => [[], []]);
  for (let tick = 0; tick < 1000 * TICKS; tick++) {
    const y = e.step(tick);
    if (!y) continue;
    for (const ev of y.events) if (ev.kind === 'extinta' && present[ev.species]) extinctAt.push(ev.year);
    for (let s = 0; s < SPECIES_COUNT; s++) (series[s] as number[]).push(e.totals[s] as number);
    PAIRS.forEach(([p, q], k) => {
      let a = 0, b = 0;
      for (const blk of regions[k] as number[]) { a += e.blockPopulation(ix(p), blk); b += e.blockPopulation(ix(q), blk); }
      (local[k] as [number[], number[]])[0].push(a); (local[k] as [number[], number[]])[1].push(b);
    });
  }
  let worst = 0;
  for (const y of extinctAt) worst = Math.max(worst, extinctAt.filter((q) => q >= y && q < y + 100).length);
  const stats = (a: number[]): { mean: number; sd: number } => { const mean = a.reduce((x, y) => x + y, 0) / a.length; return { mean, sd: Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length) }; };
  const still: string[] = [];
  SPECIES.forEach((sp, s) => {
    if (!present[s]) return;
    const { mean, sd } = stats((series[s] as number[]).slice(200));
    if (!(mean > 0) || sd / mean < 0.01) still.push(sp.id);
  });
  const cycles: string[] = [];
  PAIRS.forEach(([p, q], k) => {
    const P = (local[k] as [number[], number[]])[0].slice(200), Q = (local[k] as [number[], number[]])[1].slice(200), sp = stats(P), sq = stats(Q);
    if (!(sp.mean > 0.5) || !(sq.mean > 0.5) || sp.sd / sp.mean < 0.05) return;
    let best = -1;
    for (let lag = 1; lag <= 15; lag++) {
      let c = 0;
      for (let i = lag; i < P.length; i++) c += ((P[i] as number) - sp.mean) * ((Q[i - lag] as number) - sq.mean);
      best = Math.max(best, c / ((P.length - lag) * sp.sd * (sq.sd || 1)));
    }
    if (best > 0.2) cycles.push(`${p}/${q}`);
  });
  return { extinctWindow: worst, present: present.filter(Boolean).length, still, cycles, totals: Array.from(e.totals) };
}

describe('ecologia: aceite de 1.000 anos', () => {
  for (const seed of SEEDS) {
    const body = (): void => {
      const r = accept(seed);
      expect(r.present, 'espécies presentes').toBeGreaterThanOrEqual(15);
      expect(r.extinctWindow / r.present, 'extinção em massa').toBeLessThan(0.2);
      expect(r.still, 'populações paradas').toEqual([]);
      expect(r.cycles.length, `ciclos em ${r.cycles.join(', ')}`).toBeGreaterThanOrEqual(3);
    };
    if (FALHAS_CONHECIDAS[seed]) it.fails(`semente ${seed} (falha conhecida: ${FALHAS_CONHECIDAS[seed]})`, body, 120000);
    else it(`semente ${seed}`, body, 120000);
  }
  it('mesma semente, mesmo resultado em 1.000 anos', () => {
    expect(accept('42').totals).toEqual(accept('42').totals);
  }, 120000);
});

describe('ecologia: desastres, poderes e míticos', () => {
  it('fogo, lava e água matam na célula; quem foge vai para o bloco vizinho', () => {
    const e = new Ecology(worldOf('terra'), null);
    const s = ix('bisao'), b = bestBlock(e, s), before = e.blockPopulation(s, b);
    e.hit(e.centerCell(b), CellState.Lava);
    expect(e.blockPopulation(s, b)).toBeCloseTo(before * (1 - 1 / (BLOCK * BLOCK)), 3);
    const total = (): number => { let t = 0; for (let q = 0; q < e.blocks; q++) t += e.blockPopulation(s, q); return t; };
    const t0 = total(), n0 = e.blockPopulation(s, b);
    e.hit(e.centerCell(b), CellState.Burning);
    // No fogo morre uma parte e outra foge: o bloco perde mais do que o mundo.
    expect(n0 - e.blockPopulation(s, b)).toBeGreaterThan(t0 - total());
    expect(total()).toBeLessThan(t0);
    // Bicho do mar não morre de fogo em terra.
    const sea = ix('cardume'), seaTotal = e.totals[sea];
    e.hit(e.centerCell(b), CellState.Burning);
    let after = 0; for (let q = 0; q < e.blocks; q++) after += e.blockPopulation(sea, q);
    expect(after).toBeCloseTo(seaTotal as number, 0);
  });
  it('a seca tira até 30% do que a célula sustenta', () => {
    const w = worldOf('terra');
    const cover = new Float32Array(w.cellCount).fill(1), state = new Uint8Array(w.cellCount);
    const ground = { cover, state } as unknown as import('../../src/world/disasters/ground').Ground;
    const e = new Ecology(w, ground), s = ix('bisao'), b = bestBlock(e, s), k0 = e.cap[s * e.blocks + b] as number;
    const n = w.params.n, per = e.nb * e.nb, face = Math.floor(b / per), rest = b - face * per, bx = rest % e.nb, by = Math.floor(rest / e.nb);
    for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) state[face * n * n + (by * BLOCK + j) * n + bx * BLOCK + i] = CellState.Heat;
    e.refreshCaps(b);
    expect(e.cap[s * e.blocks + b]).toBeCloseTo(k0 * 0.7, 3);
  });
  it('deus põe, mata e muda características; a mudança vale para a espécie inteira', () => {
    const e = new Ecology(worldOf('terra'), null);
    const s = ix('elefante'), b = bestBlock(e, s), cell = e.centerCell(b), n0 = e.blockPopulation(s, b);
    expect(e.place(s, cell, 5)).toBe(5);
    expect(e.blockPopulation(s, b)).toBeCloseTo(n0 + 5, 4);
    // Bicho de terra não entra no mar.
    let sea = 0; for (let c = 0; c < worldOf('terra').cellCount; c++) if (worldOf('terra').isWater(c)) { sea = c; break; }
    expect(e.place(s, sea, 5)).toBe(0);
    expect(e.kill([cell], s)).toBeGreaterThan(0);
    expect(e.blockPopulation(s, b)).toBeLessThan(n0 + 5);
    const slow = new Ecology(worldOf('terra'), null), fast = new Ecology(worldOf('terra'), null);
    fast.setTrait(ix('lebre'), TRAITS.indexOf('fertilidade'), 2);
    slow.setTrait(ix('lebre'), TRAITS.indexOf('fertilidade'), 0.5);
    for (const q of [slow, fast]) for (let k = 0; k < q.blocks; k++) q.pop[ix('lebre') * q.blocks + k] = (q.pop[ix('lebre') * q.blocks + k] as number) * 0.1;
    run(slow, 4); run(fast, 4);
    expect(fast.totals[ix('lebre')]).toBeGreaterThan((slow.totals[ix('lebre')] as number) * 1.3);
  });
  it('a classe mítica nunca nasce sozinha; posta por deus, anda, come e não se reproduz', () => {
    const e = new Ecology(worldOf('terra'), null);
    run(e, 200);
    for (const id of ['dragao', 'kraken', 'baleiaBranca'] as const) expect(e.totals[ix(id)]).toBe(0);
    expect(e.mythics.length).toBe(0);
    const b = e.densest(ix('bisao')), bison0 = e.totals[ix('bisao')] as number;
    e.place(ix('dragao'), e.centerCell(b), 1);
    e.place(ix('dragao'), e.centerCell(b), 1);
    let fires = 0;
    for (let tick = 200 * TICKS; tick < 260 * TICKS; tick++) { const y = e.step(tick); if (y) fires += y.fires.length; }
    expect(e.mythics.length).toBe(2);
    expect(e.totals[ix('dragao')]).toBe(2);
    expect(e.totals[ix('bisao')]).toBeLessThan(bison0);
    expect(fires).toBeGreaterThan(0);
    // Morre pelo poder de deus.
    expect(e.kill(e.mythics.map((m) => m.cell), ix('dragao'))).toBeGreaterThanOrEqual(1);
  });
});
