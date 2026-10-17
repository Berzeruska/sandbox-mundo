import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { CELL_CHUNK, SharedCellPool, type CellPool, type CellsRequest } from '../../src/world/cell-pool';
import { createWorld } from '../../src/world/create';
import { CubeSphere } from '../../src/world/cubesphere';
import { runCellJob } from '../../src/world/generation';

/**
 * Geração dividida entre o relógio e o ajudante 2 (correção da geração, 2026-10-16): quem calcula
 * cada pedaço não muda nada no mundo.
 */
const N = 64;
const grid = new CubeSphere(N);
const params = { seedText: 'pedaços', seed: seedFrom('pedaços'), n: N, seaLevel: 0, landFraction: 0.3 };

function snapshot(pool?: CellPool) {
  const w = createWorld(params, grid, undefined, pool);
  return { elevation: Array.from(w.elevation), plate: Array.from(w.plate), temp: Array.from(w.tempNoise), rain: Array.from(w.rainNoise), biome: Array.from(w.biome) };
}

const alone = snapshot();
const chunks = Math.ceil(grid.cellCount / CELL_CHUNK);

/** O ajudante pega `count` pedaços e termina só os que `finishes` deixar. */
function helperTakes(count: number, finishes: boolean) {
  return (msg: CellsRequest) => {
    for (let k = 0; k < count; k++) {
      const i = Atomics.add(msg.control, 0, 1);
      if (i >= chunks || !finishes) continue;
      runCellJob(msg.job, i * CELL_CHUNK, Math.min(msg.total, (i + 1) * CELL_CHUNK));
      Atomics.store(msg.control, 2 + i, 1);
      Atomics.add(msg.control, 1, 1);
    }
  };
}

describe('geração dividida em pedaços', () => {
  it('pedaços em qualquer ordem dão o mesmo mundo', () => {
    const reversed: CellPool = {
      helperShare: 0,
      run(_job, total, local) {
        for (let from = Math.floor((total - 1) / 1000) * 1000; from >= 0; from -= 1000) local(from, Math.min(total, from + 1000));
      },
    };
    expect(snapshot(reversed)).toEqual(alone);
  });

  it('com o ajudante fazendo parte dos pedaços, o mundo é o mesmo', () => {
    expect(chunks).toBeGreaterThan(4);
    const pool = new SharedCellPool(helperTakes(3, true), () => 0);
    expect(snapshot(pool)).toEqual(alone);
    expect(pool.helperShare).toBeCloseTo(3 / chunks);
  });

  it('se o ajudante pega pedaços e não termina, o relógio refaz depois do prazo', () => {
    let now = 0;
    const pool = new SharedCellPool(helperTakes(2, false), () => (now += 1000), () => undefined, 5000);
    expect(snapshot(pool)).toEqual(alone);
  });
});
