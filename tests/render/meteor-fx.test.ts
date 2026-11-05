import { describe, expect, it } from 'vitest';
import type { Camera } from '../../src/render/camera';
import { DisasterFx, METEOR_AFTER_MS, meteorEntry, METEOR_ENTRY_MS, meteorFall, meteorHead, METEOR_HEAD } from '../../src/render/disaster-fx';
import { BASE_TICKS_PER_SECOND } from '../../src/core/time';
import { CLOCK_POST_MS } from '../../src/sim/core';
import { CRATER_RADIUS } from '../../src/world/disasters/meteor';
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

// B1 (teste da `d7479ae2`): pausada, a bola não pode chegar ao chão. Teste da `3238cd7b`: em 20× e no Máx a
// cratera vinha ~1 s antes da rocha. Pelo desenho: a rocha toca o chão junto com o impacto, em qualquer velocidade.
describe('a rocha cai junto com o impacto do jogo', () => {
  /** Quadros de 60 Hz até `ms`; `ticksLeft(ms)`: passos até o impacto; devolve a entrada em cada quadro. */
  function fall(ms: number, tps: number, ticksLeft: (ms: number) => number): number[] {
    const out: number[] = [];
    let entry = 0;
    for (let t = 1000 / 60; t <= ms; t += 1000 / 60) {
      entry = meteorEntry(entry, 1000 / 60, ticksLeft(t), tps);
      out.push(entry);
    }
    return out;
  }
  const fallTicks = (tps: number) => tps * (METEOR_ENTRY_MS / 1000);

  it('pausado, a rocha aparece no céu e fica', () => {
    const frames = fall(60_000, 0, () => 12);
    expect(frames.at(-1)).toBeGreaterThan(0);
    expect(frames.at(-1)).toBeLessThan(0.2);
  });

  it('pausado no meio da queda, para onde está', () => {
    expect(meteorEntry(0.6, 16, 5, 0)).toBe(0.6);
  });

  for (const speed of [1, 2, 5, 20]) {
    it(`em ${speed}× chega ao chão em ~1 s, com passo igual em todo quadro`, () => {
      const tps = BASE_TICKS_PER_SECOND * speed;
      // O passo só chega a cada 100 ms; entre uma mensagem e outra a tela estima, com até um passo de erro.
      const left = (ms: number) => fallTicks(tps) - Math.floor(Math.floor(ms / CLOCK_POST_MS) * CLOCK_POST_MS * tps / 1000) - (tps * (ms % CLOCK_POST_MS)) / 1000;
      const frames = fall(METEOR_ENTRY_MS * 0.9, tps, left);
      const step = (frames[20] as number) - (frames[19] as number);
      for (let k = 1; k < frames.length; k++) expect((frames[k] as number) - (frames[k - 1] as number)).toBeCloseTo(step, 2);
      // A 90% do tempo a rocha está perto de 90% do caminho: nem cedo nem tarde.
      expect(frames.at(-1)).toBeGreaterThan(0.86);
      expect(frames.at(-1)).toBeLessThan(0.96);
      expect(fall(METEOR_ENTRY_MS, tps, left).at(-1)).toBeGreaterThan(0.95);
    });
  }

  it('no Máx, com o ritmo variando, a rocha chega ao chão quando os passos acabam', () => {
    // 1.560 passos/s de média, com o ritmo oscilando entre ~1.000 e ~2.100, mas a tela só vê a média.
    let ticks = 1560;
    let entry = 0;
    let t = 0;
    while (ticks > 0) {
      t += 1000 / 60;
      ticks -= (1560 + 550 * Math.sin(t / 90)) / 60;
      entry = meteorEntry(entry, 1000 / 60, ticks, 1560);
    }
    expect(t).toBeGreaterThan(700);
    expect(entry).toBeGreaterThan(0.97);
  });

  it('acelerar no meio da queda adianta a rocha; frear faz ela esperar no ar', () => {
    const fast = meteorEntry(0.3, 1000 / 60, 40, 240);
    expect(fast).toBeGreaterThan(0.3 + (1000 / 60) / METEOR_ENTRY_MS);
    const slow = meteorEntry(0.3, 1000 / 60, 200, 12);
    expect(slow - 0.3).toBeLessThan(0.001);
  });

  it('nunca anda para trás', () => {
    expect(meteorEntry(0.5, 16, 1000, 12)).toBeGreaterThanOrEqual(0.5);
  });

  it('a chuva de outros desastres não tira a rocha da tela', () => {
    const fx = new DisasterFx();
    const point = [0, 0, 1] as DisasterEvent['point'];
    const rock = { id: 1, kind: DisasterKind.Meteor, tick: 0, impactTick: 12, point, magnitude: 2, notable: true, manual: false, label: '', radius: 0.01 } as DisasterEvent;
    fx.add(rock, 0);
    for (let id = 2; id < 200; id++) fx.add({ ...rock, id, kind: DisasterKind.Lightning }, 0);
    expect(fx.land(1, 10)).toBe(rock);
  });

  it('o clarão só vem com o impacto: sem ele a rocha nunca toca o chão, mesmo com os passos já vencidos', () => {
    const fx = new DisasterFx();
    const e = { id: 1, kind: DisasterKind.Meteor, tick: 100, impactTick: 112, point: [0, 0, 1], magnitude: 2, notable: true, manual: true, label: '', radius: 0.01 } as DisasterEvent;
    fx.add(e, 0);
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop: () => undefined }) }) as unknown as CanvasRenderingContext2D;
    const camera = { worldToScreen: () => ({ x: 0, y: 0, visible: true }), cellAngle: 0.01, cellPixels: () => 4 } as unknown as Camera;
    // Pausado no passo 105 por 10 s: a animação continua (esperando).
    for (let ms = 0; ms <= 10_000; ms += 500) fx.draw(ctx, camera, ms, 105, 0, 1);
    expect(fx.active).toBe(true);
    expect(fx.land(99, 10_000)).toBeUndefined();
    // O tempo volta, os passos vencem e o impacto não chegou: continua caindo, não some.
    for (let ms = 10_000; ms <= 30_000; ms += 500) fx.draw(ctx, camera, ms, 120, 12, 1);
    expect(fx.active).toBe(true);
    // O impacto chega: bate, brilha e acaba.
    expect(fx.land(1, 30_000)).toBe(e);
    fx.draw(ctx, camera, 30_000 + METEOR_AFTER_MS / 2, 120, 12, 1);
    expect(fx.active).toBe(true);
    fx.draw(ctx, camera, 30_000 + METEOR_AFTER_MS + 100, 120, 12, 1);
    expect(fx.active).toBe(false);
  });
});

// B1 (teste da `9b5ba0d4`): "às vezes o meteoro nem aparece". De perto, ou tocando perto da borda, a rocha
// nascia fora da tela e, pausada, ficava lá. Pelo desenho: a rocha sempre começa dentro da tela.
describe('a rocha do meteoro aparece em qualquer condição', () => {
  const [W, H] = [1920, 1080];

  it('qualquer tamanho, zoom e ponto da tela: o começo da queda fica dentro da tela', () => {
    for (const s of [1, 2, 3, 4]) {
      for (const cellPx of [1.5, 3, 10, 40, 64]) {
        const head = meteorHead(s, (CRATER_RADIUS[s] as number) * cellPx, 1);
        for (const [x, y] of [[960, 540], [40, 40], [1880, 40], [40, 1040], [1880, 1040], [960, 10]] as const) {
          for (const dx of [-0.9, -0.55, 0.55, 0.9]) {
            const len = meteorFall(x, y, head, dx, -1, W, H);
            const sx = x + dx * len;
            const sy = y - len;
            expect(sx).toBeGreaterThanOrEqual(Math.min(x, 0));
            expect(sx).toBeLessThanOrEqual(Math.max(x, W));
            expect(sy).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('de longe, com espaço, a rocha percorre pelo menos 16 vezes o raio dela', () => {
    const head = meteorHead(1, 3, 1);
    expect(meteorFall(960, 540, head, 0.6, -1, W, H)).toBeCloseTo(head * 16, 5);
  });

  it('de longe, até a menor rocha tem tamanho para ser vista (pelo menos 3 px de raio)', () => {
    expect(meteorHead(1, (CRATER_RADIUS[1] as number) * 1.5, 1)).toBeGreaterThanOrEqual(3);
  });
});
