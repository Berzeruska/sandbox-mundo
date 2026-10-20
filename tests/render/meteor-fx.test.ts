import { describe, expect, it } from 'vitest';
import { meteorHead, METEOR_HEAD } from '../../src/render/disaster-fx';
import { CRATER_RADIUS } from '../../src/world/disasters/meteor';

// F5 (teste da `58f53e7`): "meteoros pequeno, médio e grande parecem do mesmo tamanho". Pelo desenho
// (C12 e E12): crateras diferentes por tamanho e a bola com ~1/3 do raio da cratera na tela; e cada
// tamanho tem de continuar maior que o anterior em qualquer zoom.
describe('tamanho do meteoro na tela (E12, F5)', () => {
  // Pixels por célula: globo inteiro na tela (~3 px), meio (~5–10) e de perto (até ~40).
  const zooms = [1.5, 3, 5, 10, 20, 40];

  it('cada tamanho é maior que o anterior em qualquer zoom', () => {
    for (const cellPx of zooms) {
      const heads = [1, 2, 3, 4].map((s) => meteorHead(s, (CRATER_RADIUS[s] as number) * cellPx, 1));
      for (let k = 1; k < heads.length; k++) expect(heads[k]!, `zoom ${cellPx} px/célula`).toBeGreaterThan(heads[k - 1]! * 1.2);
    }
  });

  it('quando a cratera aparece grande, a bola tem ~1/3 do raio dela', () => {
    for (const s of [1, 2, 3, 4]) {
      const crater = (CRATER_RADIUS[s] as number) * 40;
      expect(meteorHead(s, crater, 1)).toBeCloseTo(METEOR_HEAD * crater, 5);
    }
  });
});
