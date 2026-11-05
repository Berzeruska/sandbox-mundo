import { describe, expect, it } from 'vitest';
import { LEGEND_ALL, legendMask, selectGroup, selectType } from '../../src/ui/resource-legend';
import { ALL_RESOURCES, groupMask, Resource } from '../../src/world/resources';

describe('legenda da camada "Ver recursos" (filtro)', () => {
  it('"Todos" mostra todos os tipos', () => {
    expect(legendMask(LEGEND_ALL)).toBe(ALL_RESOURCES);
  });

  it('grupo mostra só os tipos dele; tocar de novo volta a "Todos"', () => {
    const s = selectGroup(LEGEND_ALL, 'energia');
    expect(legendMask(s)).toBe(groupMask('energia'));
    expect((legendMask(s) >>> Resource.Oil) & 1).toBe(1);
    expect((legendMask(s) >>> Resource.Iron) & 1).toBe(0);
    expect(selectGroup(s, 'energia')).toEqual(LEGEND_ALL);
  });

  it('tipo mostra só ele; tocar de novo volta ao grupo', () => {
    const s = selectType(selectGroup(LEGEND_ALL, 'metais'), Resource.Niobium);
    expect(legendMask(s)).toBe(1 << Resource.Niobium);
    const back = selectType(s, Resource.Niobium);
    expect(legendMask(back)).toBe(groupMask('metais'));
  });

  it('os 4 grupos juntos são todos os tipos', () => {
    expect((groupMask('metais') | groupMask('energia') | groupMask('agricultura') | groupMask('industria')) >>> 0).toBe(ALL_RESOURCES);
  });
});
