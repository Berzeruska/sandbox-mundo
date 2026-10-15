import { describe, expect, it } from 'vitest';
import { PAINT_DELAY_MS, PaintGate } from '../../src/input/paint-gate';

// Tempos sintéticos em ms: nada aqui depende do relógio real.
describe('PaintGate (quando um toque vira pincelada)', () => {
  it('segundo dedo antes da espera = pinça: nada é pintado', () => {
    const g = new PaintGate();
    g.start(1000);
    expect(g.frame(1016)).toBe('none');
    g.cancel(); // segundo dedo em 1030 ms
    expect(g.frame(1100)).toBe('none');
    expect(g.frame(2000)).toBe('none');
    expect(g.end()).toBe(false);
  });

  it('segurar além da espera pinta: primeiro "first", depois "continue"', () => {
    const g = new PaintGate();
    g.start(0);
    expect(g.frame(PAINT_DELAY_MS - 1)).toBe('none');
    expect(g.frame(PAINT_DELAY_MS)).toBe('first');
    expect(g.frame(PAINT_DELAY_MS + 16)).toBe('continue');
    expect(g.end()).toBe(false); // já pintou, não aplica de novo ao soltar
  });

  it('toque rápido (soltou antes da espera) ainda pinta uma vez', () => {
    const g = new PaintGate();
    g.start(0);
    expect(g.frame(30)).toBe('none');
    expect(g.end()).toBe(true);
    expect(g.frame(200)).toBe('none');
  });

  it('pinça depois de já estar pintando para a pincelada', () => {
    const g = new PaintGate();
    g.start(0);
    expect(g.frame(100)).toBe('first');
    g.cancel();
    expect(g.frame(120)).toBe('none');
    expect(g.painting).toBe(false);
  });

  it('um novo toque recomeça a espera', () => {
    const g = new PaintGate();
    g.start(0);
    g.frame(100);
    g.end();
    g.start(500);
    expect(g.frame(550)).toBe('none');
    expect(g.frame(580)).toBe('first');
  });
});
