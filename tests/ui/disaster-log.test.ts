import { describe, expect, it } from 'vitest';
import { DisasterLog, entryText, isToast, LOG_KEEP } from '../../src/ui/disaster-log';
import { DisasterKind, type DisasterEvent } from '../../src/world/disasters/types';

const ev = (id: number, over: Partial<DisasterEvent> = {}): DisasterEvent => ({
  id,
  kind: DisasterKind.Quake,
  tick: id * 12,
  point: [0, 0, 1],
  magnitude: 6,
  notable: false,
  manual: false,
  label: `Terremoto ${id}`,
  radius: 0.1,
  ...over,
});

describe('avisos e lista de desastres (T12)', () => {
  it('aviso só para desastre grande e natural', () => {
    expect(isToast(ev(1, { notable: true }))).toBe(true);
    expect(isToast(ev(2))).toBe(false);
    expect(isToast(ev(3, { notable: true, manual: true }))).toBe(false);
  });

  it('a lista guarda todos, os mais recentes primeiro, até LOG_KEEP', () => {
    const log = new DisasterLog();
    log.add([ev(1), ev(2)]);
    log.add([ev(3)]);
    expect(log.entries.map((e) => e.id)).toEqual([3, 2, 1]);
    log.add(Array.from({ length: LOG_KEEP + 10 }, (_, k) => ev(10 + k)));
    expect(log.entries).toHaveLength(LOG_KEEP);
    expect(log.entries[0]!.id).toBe(10 + LOG_KEEP + 9);
  });

  it('texto da linha com o ano e "provocado" quando foi o jogador', () => {
    const log = new DisasterLog();
    const [e] = log.add([ev(100, { tick: 12 * 1233, manual: true, label: 'Erupção IEV 5' })]);
    expect(entryText(e!)).toBe('Ano 1.234 · Erupção IEV 5 (provocado)');
  });
});
