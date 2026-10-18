import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { BIOME_BITS, NO_LAYERS } from '../../src/render/colors';
import { GeologyEngine, worldArrays, type GeologyEvent } from '../../src/sim/geology';
import { CubeSphere } from '../../src/world/cubesphere';
import { createWorld } from '../../src/world/create';

/** FNV-1a de 32 bits sobre os bytes (impressão digital simples, sem dependência). */
function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ (bytes[i] as number), 0x01000193);
  return h >>> 0;
}

const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/**
 * Guarda o resultado exato do motor da geologia (recomposição, clima, cores, textura das placas).
 * Otimização de desempenho não pode mudar o mundo: se este teste falhar sem uma mudança de regra
 * de propósito, a otimização mudou o resultado. Valores conferidos contra o código de antes da
 * limpeza de lixo de memória (2026-10-16), com 300 recomposições em N = 64 e 14 em N = 128. Valor
 * novo na T6 (2026-10-17): entraram as jazidas e o tom delas nas cores; sem jazidas e sem cores, o
 * valor do código de antes e do novo é o mesmo (c4bd0869). Valor novo na T7: a erosão passa a depender
 * da chuva e o clima mudou (gelo, umidade, ciclo glacial), de propósito. Valor novo no teste da 50f0dca:
 * plataforma continental larga, jazidas maiores, formação pelo relógio do jogo e cor do gelo presa
 * em 0–255. Valor novo na R1 (2026-10-18): polos novos (borda do gelo do mar em lobos e placas soltas,
 * cor pela espessura), de propósito. Valor novo na RL (2026-10-18): relevo em degraus nas cores, de
 * propósito (a R2, logo antes, não mudou o valor: o chão dos desastres não entra nas cores do motor).
 */
describe('motor da geologia: mesmo resultado', () => {
  it('impressão digital depois de 40 recomposições (terra, N = 64)', () => {
    const grid = new CubeSphere(64);
    const world = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: 64, seaLevel: 0, landFraction: 0.3 }, grid);
    let h = 0x811c9dc5;
    let results = 0;
    const consumed: number[] = [];
    const emit = (e: GeologyEvent) => {
      if (e.type !== 'result') return;
      results++;
      const arrays = engine.buffers.arrays as Record<string, ArrayBufferView>;
      for (const k of Object.keys(arrays).sort()) h = fnv(h, bytesOf(arrays[k] as ArrayBufferView));
      // Só o bioma do canal alfa: os bits dos cantos (2026-10-17) são do desenho e têm teste próprio.
      h = fnv(h, engine.colors.map((x, i) => (i % 4 === 3 ? x & ((1 << BIOME_BITS) - 1) : x)));
      h = fnv(h, bytesOf(engine.cellRef));
      h = fnv(h, e.result.plateCells);
      consumed.push(e.result.index);
    };
    const engine: GeologyEngine = new GeologyEngine({ world: 1, params: world.params, plates: world.plates, arrays: worldArrays(world), rate: 1, layers: NO_LAYERS, climateControl: 0 }, grid, emit, () => 0);
    let tick = 0;
    while (results < 40) {
      tick += 20;
      engine.receive({ type: 'advance', world: 1, tick });
      for (const index of consumed.splice(0)) engine.receive({ type: 'consumed', world: 1, index });
    }
    expect(h.toString(16)).toBe('2df22e7b');
  });
});
