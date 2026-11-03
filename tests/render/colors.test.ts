import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { BIOME_BITS, buildColors, hillshade, shadeWeightsFor, TERRACE_METERS, terraceShade, withRing } from '../../src/render/colors';
import { BIOME_COUNT } from '../../src/world/biomes';
import { latLonToPoint } from '../../src/world/cubesphere';
import { createWorld } from '../../src/world/create';
import { applyClimateOffset } from '../../src/world/climate';

describe('cores das células', () => {
  const w = createWorld({ seedText: '1', seed: 1, n: 16, seaLevel: 0, landFraction: 0.3 });
  const out = new Uint8Array(w.cellCount * 4);
  buildColors(w, out);

  it('o canal alfa leva o código do bioma (para o shader)', () => {
    for (let i = 0; i < w.cellCount; i++) expect(out[i * 4 + 3]! & ((1 << BIOME_BITS) - 1)).toBe(w.biome[i]);
  });

  it('os biomas cabem nos bits reservados (bioma novo acima de 16 exige mudar o canal alfa)', () => {
    expect(BIOME_COUNT).toBeLessThanOrEqual(1 << BIOME_BITS);
  });

  it('bit de cada canto: as 3 células na direção dele estão na face e têm o mesmo bioma', () => {
    const n = w.grid.n;
    let set = 0;
    for (let i = 0; i < w.cellCount; i++) {
      const x = i % n;
      const y = Math.floor(i / n) % n;
      for (let corner = 0; corner < 4; corner++) {
        const dx = corner & 1 ? 1 : -1;
        const dy = corner & 2 ? 1 : -1;
        const inFace = x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < n;
        const same = inFace && [i + dx, i + dy * n, i + dy * n + dx].every((j) => w.biome[j] === w.biome[i]);
        const bit = (out[i * 4 + 3]! >> (BIOME_BITS + corner)) & 1;
        expect(bit).toBe(same ? 1 : 0);
        set += bit;
      }
    }
    expect(set).toBeGreaterThan(0);
  });

  it('repintar uma região com o anel em volta dá o mesmo que repintar tudo', () => {
    const v = createWorld({ seedText: '2', seed: 2, n: 16, seaLevel: 0, landFraction: 0.3 });
    const partial = new Uint8Array(v.cellCount * 4);
    buildColors(v, partial);
    // Muda o bioma de um bloco de células no meio de uma face (como uma pincelada).
    const n = v.grid.n;
    const region: number[] = [];
    for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) region.push(2 * n * n + y * n + x);
    for (const c of region) v.biome[c] = (v.biome[c]! + 3) % BIOME_COUNT;
    buildColors(v, partial, withRing(v.grid, region));
    const full = new Uint8Array(v.cellCount * 4);
    buildColors(v, full);
    expect(partial).toEqual(full);
  });

  it('oceano é azulado', () => {
    const water = [...Array(w.cellCount).keys()].find((i) => w.isWater(i) && !w.ice[i])!;
    expect(out[water * 4 + 2]).toBeGreaterThan(out[water * 4]!);
  });

  it('mesmo bioma e mesma altura dão a mesma cor (sem variação por célula, que desenhava a grade)', () => {
    const a = [...Array(w.cellCount).keys()].filter((i) => w.isWater(i) && !w.ice[i] && w.elevation[i] === w.elevation[0]);
    for (const i of a) expect([...out.subarray(i * 4, i * 4 + 3)]).toEqual([...out.subarray(a[0]! * 4, a[0]! * 4 + 3)]);
  });
});

describe('cores do gelo', () => {
  it('gelo claro nunca dá a volta no byte (pontos rosa e azuis no gelo, teste da 50f0dca)', () => {
    const w = createWorld({ seedText: 'terra', seed: 99, n: 64, seaLevel: 0, landFraction: 0.3 });
    applyClimateOffset(w, -8);
    const out = new Uint8Array(w.cellCount * 4);
    buildColors(w, out);
    let ice = 0;
    for (let i = 0; i < w.cellCount; i++) {
      if (!w.ice[i]) continue;
      ice++;
      expect(Math.min(out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!)).toBeGreaterThan(110);
    }
    expect(ice).toBeGreaterThan(100);
  });
});

describe('sombreado de relevo', () => {
  const make = () => {
    const w = createWorld({ seedText: '1', seed: 1, n: 32, seaLevel: 0, landFraction: 0.3 });
    w.elevation.fill(500);
    return w;
  };
  const g = make().grid;
  const p = latLonToPoint(0.3, 0.4);
  const center = g.pointToCell(p[0], p[1], p[2]);

  it('terra plana não tem sombra', () => {
    expect(hillshade(make(), center)).toBeCloseTo(1, 9);
  });

  it('encosta virada para o noroeste é mais clara que a virada para o sudeste', () => {
    // Morro: altura cai com a distância de um pico.
    const w = make();
    for (let i = 0; i < w.cellCount; i++) {
      const dot = g.positions[i * 3]! * p[0] + g.positions[i * 3 + 1]! * p[1] + g.positions[i * 3 + 2]! * p[2];
      w.elevation[i] = 500 + 3000 * Math.max(0, 1 - Math.acos(Math.min(1, dot)) / (g.cellAngle * 8));
    }
    const nw = g.pointToCell(...latLonToPoint(0.3 + g.cellAngle * 3, 0.4 - g.cellAngle * 3));
    const se = g.pointToCell(...latLonToPoint(0.3 - g.cellAngle * 3, 0.4 + g.cellAngle * 3));
    expect(hillshade(w, nw)).toBeGreaterThan(1.05);
    expect(hillshade(w, se)).toBeLessThan(0.95);
  });
});

describe('relevo em degraus (RL)', () => {
  /** Mundo pequeno todo plano em terra, com um degrau no meio de uma face. */
  const flat = () => {
    const w = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: 16, seaLevel: 0, landFraction: 0.3 });
    w.elevation.fill(400);
    return w;
  };

  it('terra plana não muda; mar não ganha degraus', () => {
    const w = flat();
    for (let c = 0; c < w.cellCount; c += 37) expect(terraceShade(w, c)).toBe(0);
  });

  it('vizinha mais alta do lado da luz faz sombra; mais baixa deixa a borda clara', () => {
    const w = flat();
    const c = 16 * 8 + 8;
    const weights = shadeWeightsFor(w.grid);
    const toLight = [0, 1, 2, 3].find((d) => weights[c * 4 + d]! > 0)!;
    const j = w.grid.neighbors[c * 4 + toLight]!;
    w.elevation[j] = 400 + TERRACE_METERS;
    expect(terraceShade(w, c)).toBeLessThan(0);
    w.elevation[j] = 400 - TERRACE_METERS;
    expect(terraceShade(w, c)).toBeGreaterThan(0);
    // Do lado oposto à luz não muda nada.
    const away = [0, 1, 2, 3].find((d) => weights[c * 4 + d]! < 0)!;
    w.elevation[j] = 400;
    w.elevation[w.grid.neighbors[c * 4 + away]!] = 400 + TERRACE_METERS;
    expect(terraceShade(w, c)).toBe(0);
  });
});
