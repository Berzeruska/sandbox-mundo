import { describe, expect, it } from 'vitest';
import { DATE_STALL_MS, FRAME_STALL_MS, STALL_KEEP, StallLog } from '../../src/ui/stalls';

const ctx = '20× · placas 100%';
const time = (wall: number) => String(wall);

/** Quadros a cada 11 ms (90 Hz) de `from` até `to`. */
function frames(log: StallLog, from: number, to: number, work = 2): void {
  for (let t = from; t <= to; t += 11) {
    log.frame(t, t, ctx);
    log.frameWork(work);
  }
}

describe('registro de travadas', () => {
  it('quadros normais e data andando 10×/s: nenhuma travada', () => {
    const log = new StallLog();
    frames(log, 0, 3000);
    for (let t = 0; t <= 3000; t += 100) log.clock(t, t, true, 0, 0, ctx);
    expect(log.counts).toEqual({ tela: 0, data: 0 });
  });

  it('quadro longo enquanto a tela aplica uma recomposição: travada da tela com a causa', () => {
    const log = new StallLog();
    frames(log, 0, 100);
    log.noteRecomposition(220, 150);
    log.frame(250, 250, ctx);
    expect(log.counts.tela).toBe(1);
    expect(log.entries[0]?.ms).toBeGreaterThan(FRAME_STALL_MS);
    expect(log.entries[0]?.cause).toContain('recomposição');
  });

  it('quadro longo sem nada do jogo: fora do jogo', () => {
    const log = new StallLog();
    frames(log, 0, 100);
    log.frame(400, 400, ctx);
    expect(log.entries[0]?.cause).toContain('fora do jogo');
  });

  it('desenho lento: a causa é o desenho', () => {
    const log = new StallLog();
    frames(log, 0, 100);
    log.frameWork(130);
    log.frame(250, 250, ctx);
    expect(log.entries[0]?.cause).toContain('desenho');
  });

  it('data parada esperando o ajudante, e a data parada quando a tela travou junto', () => {
    const log = new StallLog();
    log.clock(0, 0, true, 0, 0, ctx);
    log.clock(100, 100, true, 0, 0, ctx);
    log.clock(100 + DATE_STALL_MS + 200, 600, true, 450, 0, ctx);
    expect(log.entries[0]).toMatchObject({ kind: 'data', cause: 'relógio esperou o ajudante 450 ms' });
    // A tela inteira parou 800 ms: a data também.
    frames(log, 700, 800);
    log.frame(1600, 1600, ctx);
    log.clock(1610, 1610, true, 450, 0, ctx);
    expect(log.entries.at(-1)).toMatchObject({ kind: 'data', cause: 'a tela travou junto (ver "tela")' });
  });

  it('pausado não conta como data parada, e o registro guarda só as últimas', () => {
    const log = new StallLog();
    log.clock(0, 0, true, 0, 0, ctx);
    log.clock(5000, 5000, false, 0, 0, ctx);
    log.clock(9000, 9000, true, 0, 0, ctx);
    expect(log.counts.data).toBe(0);
    for (let k = 0; k < STALL_KEEP + 5; k++) {
      log.restart();
      log.frame(k * 1000, k * 1000, ctx);
      log.frame(k * 1000 + 300, k * 1000 + 300, ctx);
    }
    expect(log.counts.tela).toBe(STALL_KEEP + 5);
    expect(log.entries).toHaveLength(STALL_KEEP);
    const lines = log.lines(3, time);
    expect(lines[0]).toBe(`travadas ${STALL_KEEP + 5} da tela · 0 da data`);
    expect(lines).toHaveLength(4);
  });
});
