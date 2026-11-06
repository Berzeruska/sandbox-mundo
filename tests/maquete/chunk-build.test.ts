import { describe, expect, it } from 'vitest';
import { VERTEX_BYTES } from '../../src/maquete/chunk-build';
import { buildReplica } from '../../src/maquete/replica-scene';

describe('malha da maquete', () => {
  it('mesma cena, mesma malha (determinismo)', () => {
    const a = buildReplica(), b = buildReplica();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(new Uint8Array(a[i]!.terrain)).toEqual(new Uint8Array(b[i]!.terrain));
      expect(new Uint8Array(a[i]!.props)).toEqual(new Uint8Array(b[i]!.props));
    }
  }, 40000);
  it('a réplica tem chão, água, plantas e borda, em triângulos inteiros', () => {
    const chunks = buildReplica();
    let water = 0;
    for (const c of chunks) {
      expect(c.terrain.byteLength).toBeGreaterThan(0);
      expect(c.props.byteLength).toBeGreaterThan(0);
      expect(c.terrain.byteLength % (VERTEX_BYTES * 3)).toBe(0);
      expect(c.props.byteLength % (VERTEX_BYTES * 3)).toBe(0);
      expect(c.skirtRanges.length).toBe(4);
      water += c.water.byteLength;
    }
    expect(water).toBeGreaterThan(0);
  }, 40000);
});
