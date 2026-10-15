import { describe, expect, it } from 'vitest';
import { emptyWork, FrameRecorder, formatReport, workDelta } from '../../src/ui/benchmark';

/** Quadros sintéticos: `gaps` são os intervalos (ms) a partir de t = 1000. */
function record(gaps: number[], work = 2): FrameRecorder {
  const r = new FrameRecorder();
  let t = 1000;
  r.frame(t, work);
  for (const g of gaps) {
    t += g;
    r.frame(t, work);
  }
  return r;
}

describe('medir desempenho: estatística dos quadros', () => {
  it('ritmo constante de 60 Hz: média e mínimo 60, pior quadro 16,7 ms', () => {
    const s = record(Array(600).fill(1000 / 60)).summary();
    expect(s.frames).toBe(600);
    expect(s.durationMs).toBeCloseTo(10_000, 6);
    expect(s.fpsAvg).toBeCloseTo(60, 6);
    expect(s.fpsMin).toBeCloseTo(60, 3);
    expect(s.worstFrameMs).toBeCloseTo(16.67, 1);
    expect(s.slowFrames).toBe(0);
  });

  it('um engasgo de 200 ms aparece no pior quadro e derruba o mínimo, quase não mexe na média', () => {
    const gaps = [...Array(300).fill(10), 200, ...Array(300).fill(10)];
    const s = record(gaps).summary();
    expect(s.worstFrameMs).toBe(200);
    expect(s.slowFrames).toBe(1);
    expect(s.fpsAvg).toBeGreaterThan(95);
    // A pior janela de 1 s contém o engasgo: 80 quadros de 10 ms + o de 200 ms.
    expect(s.fpsMin).toBeLessThan(83);
    expect(s.fpsMin).toBeGreaterThan(79);
  });

  it('trecho mais lento no meio: o mínimo é o ritmo do trecho lento', () => {
    const gaps = [...Array(200).fill(10), ...Array(100).fill(40), ...Array(200).fill(10)];
    const s = record(gaps).summary();
    expect(s.fpsMin).toBeCloseTo(25, 0);
  });

  it('trabalho por quadro: média e pior', () => {
    const r = new FrameRecorder();
    [3, 5, 1, 9].forEach((w, i) => r.frame(i * 16, w));
    const s = r.summary();
    // O primeiro quadro é só a referência de tempo.
    expect(s.workAvgMs).toBeCloseTo(5, 9);
    expect(s.workMaxMs).toBe(9);
  });

  it('sem quadros suficientes não quebra', () => {
    expect(new FrameRecorder().summary().fpsAvg).toBe(0);
    expect(record([]).summary().frames).toBe(0);
  });
});

describe('medir desempenho: worker e relatório', () => {
  it('diferença de contadores mostra só o trecho medido', () => {
    const a = { ...emptyWork(), ms: 100, ticks: 1000, recompositions: 2, plates: 50, worstGeology: 80 };
    const b = { ...a, ms: 400, ticks: 3400, recompositions: 5, plates: 140, worstGeology: 120 };
    const d = workDelta(a, b);
    expect(d).toMatchObject({ ms: 300, ticks: 2400, recompositions: 3, plates: 90, worstGeology: 120 });
  });

  it('relatório traz cenários, worker, geração e a GPU', () => {
    const frames = record(Array(120).fill(1000 / 60)).summary();
    const text = formatReport(
      { version: 'abc123', date: 'hoje', gpu: 'Mali-G52 MC2 (ARM)', drawing: 'completo', cores: 8, screen: 'tela 720×1600', userAgent: 'UA' },
      [
        { name: 'pausado, parado', frames, work: emptyWork(), receiveAvgMs: 0, receiveMaxMs: 0 },
        {
          name: 'tempo 20×, placas 100%',
          frames,
          work: { ...emptyWork(), ms: 500, ticks: 480, recompositions: 2, plates: 100, climate: 60, colors: 30, send: 10, worstGeology: 120, clockMessages: 120 },
          receiveAvgMs: 4,
          receiveMaxMs: 6,
        },
      ],
      { totalMs: 4000, workerMs: 3500, stagesMs: { grade: 300, terreno: 2000 }, receiveMs: 120 },
    );
    expect(text).toContain('Mali-G52');
    expect(text).toContain('pausado, parado');
    expect(text).toContain('worker parado');
    expect(text).toContain('2 recomposições: média 100 ms (placas 50 · clima 30 · cores 15 · envio 5) · pior 120 ms');
    expect(text).toContain('240 passos/s');
    expect(text).toContain('geração: 4000 ms');
    expect(text).toContain('terreno 2000');
  });
});
