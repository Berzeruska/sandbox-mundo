import { describe, expect, it } from 'vitest';
import { entryText, isToast, toEntry } from '../../src/ui/disaster-log';
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

describe('avisos de desastres (T12, R2)', () => {
  it('aviso só para desastre grande e natural', () => {
    expect(isToast(ev(1, { notable: true }))).toBe(true);
    expect(isToast(ev(2))).toBe(false);
    expect(isToast(ev(3, { notable: true, manual: true }))).toBe(false);
  });

  it('texto da linha com o ano e "provocado" quando foi o jogador', () => {
    expect(entryText(toEntry(ev(100, { tick: 12 * 1233, manual: true, label: 'Erupção IEV 5' })))).toBe('Ano 1.234 · Erupção IEV 5 (provocado)');
  });
});
