import { describe, expect, it } from 'vitest';
import { ClimateFade, FADE_MS, mixOf, NO_FADE, STAMP_MS } from '../../src/render/climate-fade';

const N = 4;
const cell = (face: number, x: number, y: number) => face * N * N + y * N + x;

/** Cores de um mundo pequeno: todas cinza 100. */
function colorsOf(): Uint8Array {
  const c = new Uint8Array(N * N * 6 * 4);
  for (let k = 0; k < c.length; k += 4) c.set([100, 100, 100, 7], k);
  return c;
}

/** Remendo de um retângulo inteiro com uma cor. */
function patch(face: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  const data = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1) * 4);
  for (let k = 0; k < data.length; k += 4) data.set([...rgb, 7], k);
  return { face, x0, y0, x1, y1, data };
}

/** O que o shader mostra numa célula (mesma conta do `climateMix`). */
function shown(f: ClimateFade, colors: Uint8Array, c: number, now: number): number {
  const t = mixOf(f.old[c * 4 + 3]!, ClimateFade.stamp(now));
  return f.old[c * 4]! + (colors[c * 4]! - f.old[c * 4]!) * t;
}

describe('troca suave das cores do clima (B4)', () => {
  it('a célula que muda vai da cor antiga para a nova em FADE_MS, sem pular', () => {
    const colors = colorsOf();
    const f = new ClimateFade(N);
    const p = patch(2, 1, 1, 2, 1, [200, 200, 200]);
    const rects = f.begin(colors, [p], 1000);
    expect(rects).toHaveLength(1);
    colors.set([200, 200, 200, 7], cell(2, 1, 1) * 4);
    colors.set([200, 200, 200, 7], cell(2, 2, 1) * 4);
    expect(f.active()).toBe(true);
    const c = cell(2, 1, 1);
    expect(shown(f, colors, c, 1000)).toBeCloseTo(100, 0);
    // Na metade do tempo, perto da metade do caminho (a hora anda em degraus de STAMP_MS).
    expect(Math.abs(shown(f, colors, c, 1000 + FADE_MS / 2) - 150)).toBeLessThan(10);
    expect(shown(f, colors, c, 1000 + FADE_MS + STAMP_MS)).toBeCloseTo(200, 0);
    // Célula que não mudou continua sem troca.
    expect(f.old[cell(2, 0, 0) * 4 + 3]).toBe(NO_FADE);
  });

  it('cor nova no meio de uma troca parte do que está na tela (sem voltar para a antiga)', () => {
    const colors = colorsOf();
    const f = new ClimateFade(N);
    const c = cell(0, 0, 0);
    f.begin(colors, [patch(0, 0, 0, 0, 0, [200, 200, 200])], 0);
    colors.set([200, 200, 200, 7], c * 4);
    const t = FADE_MS / 2;
    const before = shown(f, colors, c, t);
    f.begin(colors, [patch(0, 0, 0, 0, 0, [50, 50, 50])], t);
    colors.set([50, 50, 50, 7], c * 4);
    expect(Math.abs(shown(f, colors, c, t) - before)).toBeLessThan(1);
    expect(shown(f, colors, c, t + FADE_MS + STAMP_MS)).toBeCloseTo(50, 0);
  });

  it('troca terminada vira "sem troca" (a hora do alfa dá a volta e não pode reacender)', () => {
    const colors = colorsOf();
    const f = new ClimateFade(N);
    const c = cell(5, 3, 3);
    f.begin(colors, [patch(5, 3, 3, 3, 3, [10, 20, 30])], 0);
    colors.set([10, 20, 30, 7], c * 4);
    expect(f.complete(FADE_MS / 2)).toHaveLength(0);
    expect(f.complete(FADE_MS * 2)).toHaveLength(1);
    expect(f.old[c * 4 + 3]).toBe(NO_FADE);
    expect(f.active()).toBe(false);
    // 8 s depois (a hora deu a volta) a célula mostra só a cor atual.
    expect(shown(f, colors, c, 8000)).toBe(10);
  });

  it('a troca antiga não apaga a mais nova da mesma célula', () => {
    const colors = colorsOf();
    const f = new ClimateFade(N);
    const c = cell(1, 2, 2);
    f.begin(colors, [patch(1, 2, 2, 2, 2, [200, 200, 200])], 0);
    colors.set([200, 200, 200, 7], c * 4);
    f.begin(colors, [patch(1, 2, 2, 2, 2, [90, 90, 90])], FADE_MS * 0.9);
    colors.set([90, 90, 90, 7], c * 4);
    f.complete(FADE_MS * 1.3);
    // A primeira acabou, a segunda ainda anda.
    expect(f.old[c * 4 + 3]).not.toBe(NO_FADE);
    expect(f.active()).toBe(true);
  });
});
