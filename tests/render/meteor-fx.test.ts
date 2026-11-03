import { describe, expect, it } from 'vitest';
import type { Camera } from '../../src/render/camera';
import { DisasterFx, METEOR_AFTER_MS, meteorEntry, METEOR_ENTRY_MS, meteorHead, METEOR_HEAD } from '../../src/render/disaster-fx';
import { CRATER_RADIUS, ENTRY_TICKS } from '../../src/world/disasters/meteor';
import { DisasterKind, type DisasterEvent } from '../../src/world/disasters/types';

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

// B1 (teste da `d7479ae2`): "o meteoro não faz cratera nem muda a temperatura". A simulação bate o
// meteoro ENTRY_TICKS passos depois de ele entrar; a animação batia sempre em 1 s de tempo real. Pelo
// desenho (C12), a bola bate quando o meteoro bate: pausado ela não pode chegar ao chão.
describe('a bola do meteoro bate junto com o impacto do jogo (B1)', () => {
  it('pausado, a bola nunca chega ao chão', () => {
    for (const ms of [0, 500, 1000, 5000, 60_000]) expect(meteorEntry(ms, 0)).toBeLessThan(1);
  });

  it('em 1× chega em ~1 s, quando o jogo chega ao impacto', () => {
    const ticksAt = (ms: number) => Math.floor((ms / 1000) * ENTRY_TICKS);
    expect(meteorEntry(500, ticksAt(500))).toBeLessThan(1);
    expect(meteorEntry(METEOR_ENTRY_MS, ENTRY_TICKS)).toBe(1);
  });

  it('em 20× não bate antes de 1 s (senão nem seria vista)', () => {
    expect(meteorEntry(100, ENTRY_TICKS * 2)).toBeLessThan(1);
    expect(meteorEntry(METEOR_ENTRY_MS, ENTRY_TICKS * 20)).toBe(1);
  });

  it('o clarão só vem depois da batida no jogo: pausar no meio deixa a bola parada', () => {
    const fx = new DisasterFx();
    const e = { id: 1, kind: DisasterKind.Meteor, tick: 100, point: [0, 0, 1], magnitude: 2, notable: true, manual: true, label: '', radius: 0.01 } as DisasterEvent;
    fx.add(e, 0);
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop: () => undefined }) }) as unknown as CanvasRenderingContext2D;
    const camera = { worldToScreen: () => ({ x: 0, y: 0, visible: true }), cellAngle: 0.01, cellPixels: () => 4 } as unknown as Camera;
    // Pausado no passo 105 por 10 s: a animação continua (esperando).
    for (let ms = 0; ms <= 10_000; ms += 500) fx.draw(ctx, camera, ms, 105, 1);
    expect(fx.active).toBe(true);
    // O tempo volta: bate, brilha e acaba.
    fx.draw(ctx, camera, 10_500, 112, 1);
    fx.draw(ctx, camera, 10_500 + METEOR_AFTER_MS / 2, 112, 1);
    expect(fx.active).toBe(true);
    fx.draw(ctx, camera, 10_500 + METEOR_AFTER_MS + 100, 112, 1);
    expect(fx.active).toBe(false);
  });
});
