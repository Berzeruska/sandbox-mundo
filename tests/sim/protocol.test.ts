import { describe, expect, it } from 'vitest';
import { applyPatch, makePatches, sharedMemoryLabel, transferables } from '../../src/sim/protocol';

describe('protocolo do worker: remendos de cor', () => {
  const n = 8;
  const source = Uint8Array.from({ length: 6 * n * n * 4 }, (_, k) => (k * 7) % 256);

  it('empacotar e aplicar devolve exatamente as mesmas cores (ida e volta)', () => {
    const rects = [
      { face: 0, x0: 0, y0: 0, x1: 7, y1: 7 },
      { face: 3, x0: 2, y0: 5, x1: 6, y1: 7 },
      { face: 5, x0: 4, y0: 1, x1: 4, y1: 1 },
    ];
    const target = new Uint8Array(source.length);
    for (const p of makePatches(source, n, rects)) applyPatch(target, n, p);
    for (const r of rects) {
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const o = ((r.face * n + y) * n + x) * 4;
          expect([...target.subarray(o, o + 4)]).toEqual([...source.subarray(o, o + 4)]);
        }
      }
    }
  });

  it('fora dos retângulos nada muda', () => {
    const target = new Uint8Array(source.length);
    for (const p of makePatches(source, n, [{ face: 1, x0: 1, y0: 1, x1: 2, y1: 2 }])) applyPatch(target, n, p);
    let changed = 0;
    for (let i = 0; i < target.length; i++) if (target[i] !== 0) changed++;
    expect(changed).toBeLessThanOrEqual(4 * 4);
  });

  it('cada remendo tem buffer próprio, para ser transferido sem cópia', () => {
    const patches = makePatches(source, n, [
      { face: 0, x0: 0, y0: 0, x1: 1, y1: 1 },
      { face: 1, x0: 0, y0: 0, x1: 1, y1: 1 },
    ]);
    const buffers = transferables({ type: 'patch', patches, brushMs: 0 });
    expect(buffers.length).toBe(2);
    expect(buffers[0]).not.toBe(buffers[1]);
    expect(buffers[0]).not.toBe(source.buffer);
  });
});

describe('teste de memória compartilhada (correção 2)', () => {
  it('diz "sim" só com página isolada, SharedArrayBuffer e o valor lido de volta', () => {
    expect(sharedMemoryLabel(true, true, true)).toBe('sim');
    expect(sharedMemoryLabel(true, true, null)).toBe('testando…');
    expect(sharedMemoryLabel(true, true, false)).toMatch(/^não/);
    expect(sharedMemoryLabel(false, true, null)).toBe('não (página sem isolamento)');
    expect(sharedMemoryLabel(true, false, null)).toBe('não (navegador sem SharedArrayBuffer)');
  });
});
