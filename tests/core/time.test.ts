import { describe, expect, it } from 'vitest';
import { Clock, formatDate, MAX_TICKS_PER_FRAME, speedLabel } from '../../src/core/time';

const frames = (clock: Clock, seconds: number, fps = 60) => {
  let ticks = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) ticks += clock.advance(1 / fps);
  return ticks;
};

describe('relógio', () => {
  it('1× avança 1 ano (12 passos) por segundo, independente do fps', () => {
    for (const fps of [30, 60, 144]) {
      const c = new Clock();
      expect(frames(c, 1, fps)).toBe(12);
      expect(c.year()).toBe(2);
      expect(c.month()).toBe(1);
    }
  });

  it('velocidades multiplicam os passos', () => {
    const c = new Clock();
    c.speed = 20;
    expect(frames(c, 0.5)).toBe(120);
  });

  it('pausado não avança', () => {
    const c = new Clock();
    c.speed = 0;
    expect(frames(c, 3)).toBe(0);
    expect(c.tick).toBe(0);
  });

  it('chama o passo da simulação em ordem', () => {
    const c = new Clock();
    const seen: number[] = [];
    c.advance(0.25, (t) => seen.push(t));
    expect(seen).toEqual([1, 2, 3]);
  });

  it('máximo respeita o teto de passos e o orçamento de tempo', () => {
    const c = new Clock();
    c.speed = 'max';
    expect(c.advance(1 / 60, undefined, () => 0)).toBe(MAX_TICKS_PER_FRAME);
    let fake = 0;
    // Cada passo "custa" 1 ms: cabem 8 no orçamento de 8 ms.
    expect(c.advance(1 / 60, () => (fake += 1), () => fake)).toBe(8);
  });

  it('engasgo longo não vira avalanche de passos', () => {
    const c = new Clock();
    expect(c.advance(10)).toBe(3); // limitado a 0,25 s
  });

  it('formata data e rótulos', () => {
    const c = new Clock();
    c.tick = 12 * 1499 + 2;
    expect(formatDate(c)).toBe('Ano 1.500 · mar');
    expect(speedLabel(0)).toBe('⏸');
    expect(speedLabel(5)).toBe('5×');
    expect(speedLabel('max')).toBe('Máx');
  });
});

describe('ritmo da maquete (opção 5)', () => {
  it('em 1×, o ritmo de 1/12 dá um passo (um mês) por segundo; nas outras velocidades nada muda', async () => {
    const { Clock, MAQUETE_PACE } = await import('../../src/core/time');
    const run = (speed: 1 | 5, pace: number): number => {
      const c = new Clock();
      c.speed = speed; c.pace = pace;
      let n = 0;
      for (let i = 0; i < 600; i++) n += c.advance(0.1);
      return n;
    };
    expect(run(1, 1)).toBe(720);
    // 60 s a um passo por segundo; a soma de frações em ponto flutuante pode deixar o último passo para o quadro seguinte.
    expect(Math.abs(run(1, MAQUETE_PACE) - 60)).toBeLessThanOrEqual(1);
    expect(run(5, MAQUETE_PACE)).toBe(run(5, 1));
  });
});
