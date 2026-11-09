import { describe, expect, it } from 'vitest';
import { ANIMALS, animalModel, animalRig, FAUNA, MYTHIC, POSES, SWIMMERS } from '../../src/maquete/animals';
import { MODEL_FLOATS } from '../../src/maquete/models';

describe('modelos dos animais', () => {
  it('toda espécie tem todas as poses, em triângulos inteiros e sem número inválido', () => {
    for (const a of ANIMALS) for (const pose of POSES) {
      const m = animalModel(a, pose);
      expect(m.length, `${a} ${pose}`).toBeGreaterThan(0);
      expect(m.length % (MODEL_FLOATS * 3)).toBe(0);
      for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i] as number)) throw new Error(`${a} ${pose}: número inválido em ${i}`);
    }
  });
  it('quem anda fica de pé no chão; o morto fica deitado, mais baixo', () => {
    for (const a of ANIMALS) {
      if (SWIMMERS.has(a) || a === 'aguia') continue;
      const span = (pose: (typeof POSES)[number]): [number, number] => {
        const m = animalModel(a, pose);
        let lo = Infinity, hi = -Infinity;
        for (let o = 1; o < m.length; o += MODEL_FLOATS) { lo = Math.min(lo, m[o] as number); hi = Math.max(hi, m[o] as number); }
        return [lo, hi];
      };
      const [lo, hi] = span('idle'), [dlo, dhi] = span('dead');
      expect(lo, a).toBeGreaterThan(-0.12);
      expect(lo, a).toBeLessThan(0.1);
      expect(dlo, a).toBeGreaterThan(-0.05);
      // O jacaré já é rasteiro: deitado de lado não fica mais baixo.
      if (a !== 'jacare') expect(dhi, a).toBeLessThan(hi);
    }
  });
  it('os quadrúpedes têm onde dobrar o pescoço e balançar a perna', () => {
    for (const a of ['cervo', 'zebra', 'elefante', 'urso', 'lebre', 'dragao'] as const) {
      const r = animalRig(a);
      expect(r.top).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThan(0);
    }
  });
  it('a classe mítica não nasce sozinha em bioma nenhum', () => {
    for (const list of Object.values(FAUNA)) for (const entry of list ?? []) expect(MYTHIC.has(entry[0])).toBe(false);
    expect([...MYTHIC].sort()).toEqual(['baleiaBranca', 'dragao', 'kraken']);
  });
});
