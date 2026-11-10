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

describe('indivíduos pelos números (E5)', () => {
  it('o pedaço mostra a população do bloco: sem ninguém, ninguém; a fração vira um a mais em parte dos blocos; há teto', async () => {
    const { shownCount } = await import('../../src/render/maquete-animals');
    expect(shownCount(0, 7, 3, false)).toBe(0);
    expect(shownCount(5, 7, 3, false)).toBe(5);
    let extra = 0;
    for (let b = 0; b < 400; b++) { const n = shownCount(2.5, b, 3, false); expect(n === 2 || n === 3).toBe(true); if (n === 3) extra++; }
    expect(extra).toBeGreaterThan(120);
    expect(extra).toBeLessThan(280);
    expect(shownCount(900, 1, 3, false)).toBeLessThanOrEqual(18);
    // Um modelo de cardume já são nove peixes.
    expect(shownCount(27, 2, ANIMALS.indexOf('cardume'), true)).toBeLessThanOrEqual(4);
  });
});
