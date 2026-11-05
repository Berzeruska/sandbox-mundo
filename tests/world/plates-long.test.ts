import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { createWorld } from '../../src/world/create';
import type { WorldState } from '../../src/world/state';
import { FRAGMENT_SHARE, Tectonics, WELD_AFTER } from '../../src/world/tectonics';

/**
 * Teste longo das placas (pedido do usuário): 5 minutos de jogo a 20× com o controle "Placas" em
 * 100%. A cada recomposição: nenhum pedaço pequeno solto, nenhum par de continentes colidindo sem
 * parar e nada oscilando. N = 128 para caber no CI (a regra não depende da resolução).
 */

const TICKS_PER_MINUTE = 60 * 240; // 20× = 240 passos por segundo
const N = 128;

/** Tamanho dos pedaços de placa que não são o corpo principal dela. */
function loosePieces(w: WorldState): number[] {
  const n = w.cellCount;
  const nb = w.grid.neighbors;
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const owner: number[] = [];
  for (let c = 0; c < n; c++) {
    if (comp[c] !== -1) continue;
    const id = sizes.length;
    const p = w.plate[c]!;
    const stack = [c];
    comp[c] = id;
    let size = 0;
    while (stack.length) {
      const x = stack.pop()!;
      size++;
      for (let d = 0; d < 4; d++) {
        const y = nb[x * 4 + d]!;
        if (comp[y] === -1 && w.plate[y] === p) {
          comp[y] = id;
          stack.push(y);
        }
      }
    }
    sizes.push(size);
    owner.push(p);
  }
  const main = new Map<number, number>();
  sizes.forEach((s, i) => {
    const m = main.get(owner[i]!);
    if (m === undefined || s > sizes[m]!) main.set(owner[i]!, i);
  });
  return sizes.filter((_, i) => main.get(owner[i]!) !== i);
}

describe('placas em 5 minutos a 20× com o controle no máximo', () => {
  it.each(['terra', 'mundo', '42'])('semente %s: sem pedaços soltos, sem colisão sem fim, sem oscilação', (seedText) => {
    const w = createWorld({ seedText, seed: seedFrom(seedText), n: N, seaLevel: 0, landFraction: 0.3 });
    const t = new Tectonics(w);
    const limit = FRAGMENT_SHARE * w.cellCount;
    let prev2: Uint8Array | null = null;
    let prev: Uint8Array | null = null;
    let worstLoose = 0;
    let worstFlips = 0;
    // Depois de uma troca de movimento (polo novo, solda, ruptura) ou de uma acreção (placa pequena
    // absorvida inteira numa colisão, G3), as células que a placa tinha acabado de tomar voltam para
    // a outra: é um evento único, não a oscilação de placas se comendo alternadamente. Essas
    // recomposições têm um teto próprio.
    let worstAfterChange = 0;
    const changes: number[] = [];
    for (let k = 0; k < 5 * TICKS_PER_MINUTE; k++) {
      if (!t.step(1)) continue;
      // Pedaço pequeno solto: nenhum, em nenhuma recomposição.
      worstLoose = Math.max(worstLoose, loosePieces(w).filter((s) => s < limit).length);
      // Oscilação: células que voltam à dona de duas recomposições atrás.
      const cur = Uint8Array.from(w.plate);
      changes.push(t.motionChanges + t.fragmentsAbsorbed);
      if (prev && prev2) {
        let flips = 0;
        for (let c = 0; c < cur.length; c++) if (cur[c] === prev2[c] && cur[c] !== prev[c]) flips++;
        const changed = changes.length >= 3 && changes[changes.length - 1] !== changes[changes.length - 3];
        if (changed) worstAfterChange = Math.max(worstAfterChange, flips);
        else worstFlips = Math.max(worstFlips, flips);
      }
      prev2 = prev;
      prev = cur;
    }
    // As placas andaram de verdade (com a plataforma larga, 2026-10-17, a "42" fez 29).
    expect(t.recompositions).toBeGreaterThan(25);
    expect(worstLoose).toBe(0);
    // Colisão continental entre duas placas dura no máximo até a solda.
    expect(t.longestCollision).toBeLessThanOrEqual(WELD_AFTER);
    expect(t.welds).toBeGreaterThan(0);
    // Só o arredondamento de 1 célula na linha das fronteiras (antes: ~0,15% por recomposição, com
    // placas se comendo alternadamente).
    expect(worstFlips / w.cellCount).toBeLessThan(0.0006);
    expect(worstAfterChange / w.cellCount).toBeLessThan(0.005);
    // A crosta guardada não cresce sem limite (dorsais e cicatrizes de arredondamento entram, a
    // subducção tira; amostras mortas são compactadas).
    expect(t.sampleCount).toBeLessThan(1.3 * w.cellCount);
    // A terra não some nem se multiplica.
    expect(w.landFraction()).toBeGreaterThan(0.22);
    expect(w.landFraction()).toBeLessThan(0.36);
  }, 300_000);
});
