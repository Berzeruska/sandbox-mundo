import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';

/**
 * Polos (proposta aprovada no teste da b3297292): o gelo do mar não é mais um disco liso. A borda tem
 * lobos grandes e se parte em placas soltas de poucas células.
 */
describe('gelo do mar nos polos', () => {
  const w = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: 128, seaLevel: 0, landFraction: 0.3 });
  const { neighbors, positions } = w.grid;
  const seaIce = (i: number) => !!w.ice[i] && w.isWater(i);

  it('tem gelo marinho e placas soltas na borda (pedaços separados do bloco principal)', () => {
    const seen = new Uint8Array(w.cellCount);
    const sizes: number[] = [];
    for (let i = 0; i < w.cellCount; i++) {
      if (seen[i] || !seaIce(i)) continue;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop() as number;
        size++;
        for (let d = 0; d < 4; d++) {
          const j = neighbors[c * 4 + d] as number;
          if (!seen[j] && seaIce(j)) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      sizes.push(size);
    }
    sizes.sort((a, b) => b - a);
    expect(sizes[0]).toBeGreaterThan(100);
    // Placas soltas: vários pedaços pequenos (até 12 células) fora dos blocos grandes.
    expect(sizes.filter((s) => s <= 12).length).toBeGreaterThanOrEqual(5);
  });

  it('a borda não é um círculo: a latitude da borda varia de um lado para o outro do polo', () => {
    // Para cada fatia de longitude no hemisfério norte, a latitude mais baixa com gelo no mar.
    const edge = new Array<number>(24).fill(90);
    for (let i = 0; i < w.cellCount; i++) {
      const y = positions[i * 3 + 1] as number;
      if (y <= 0 || !seaIce(i)) continue;
      const lat = (Math.asin(y) * 180) / Math.PI;
      const lon = Math.atan2(positions[i * 3] as number, positions[i * 3 + 2] as number);
      const k = Math.min(23, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * 24));
      edge[k] = Math.min(edge[k] as number, lat);
    }
    const lats = edge.filter((v) => v < 90);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(5);
  });
});
