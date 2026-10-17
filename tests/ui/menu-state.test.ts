import { describe, expect, it } from 'vitest';
import { Tool } from '../../src/input/tools';
import {
  activeBrush,
  CATEGORIES,
  categoryOfActive,
  closeMenu,
  INITIAL_MENU,
  inputModeOf,
  ITEMS,
  itemsOf,
  openMenu,
  selectCategory,
  selectItem,
  SPEED_CARD,
  toggleMenu,
} from '../../src/ui/menu-state';

describe('menu de ferramentas: conteúdo', () => {
  it('tem as 6 categorias combinadas, nessa ordem', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['Tempo', 'Relevo', 'Desastres', 'Geologia', 'Clima', 'Mundo']);
  });

  it('cada categoria tem itens e os ids são únicos', () => {
    for (const c of CATEGORIES) expect(itemsOf(c.id).length).toBeGreaterThan(0);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('Relevo tem mover + os 5 pincéis; Tempo tem pausa + 5 velocidades', () => {
    expect(itemsOf('relevo').map((i) => i.label)).toEqual(['Mover', 'Elevar', 'Rebaixar', 'Água', 'Gelo', 'Derreter']);
    expect(itemsOf('tempo').map((i) => i.speed)).toEqual([0, 1, 2, 5, 20, 'max']);
  });

  it('Desastres ainda "em breve"; Clima tem "Temperatura" e "Ver biomas"; Geologia tem "Ver placas", "Ver recursos" e "Velocidade"; Mundo tem Novo mundo e Dados', () => {
    expect(itemsOf('desastres').every((i) => !i.available)).toBe(true);
    expect(itemsOf('clima').map((i) => [i.label, i.available])).toEqual([['Temperatura', true], ['Ver biomas', true]]);
    expect(itemsOf('geologia').map((i) => [i.label, i.available])).toEqual([['Ver placas', true], ['Ver recursos', true], ['Velocidade', true]]);
    expect(itemsOf('mundo').map((i) => i.label)).toEqual(['Novo mundo', 'Dados']);
  });
});

describe('menu de ferramentas: comportamento', () => {
  it('começa fechado, com Mover ativo (um dedo gira)', () => {
    expect(INITIAL_MENU.open).toBe(false);
    expect(inputModeOf(INITIAL_MENU)).toBe('move');
  });

  it('abrir sem categoria vai para a categoria da ferramenta ativa (tocar no cartão)', () => {
    const s = { ...INITIAL_MENU, active: 'water', category: 'tempo' as const };
    expect(openMenu(s)).toMatchObject({ open: true, category: 'relevo' });
    expect(openMenu({ ...s, active: SPEED_CARD })).toMatchObject({ category: 'tempo' });
  });

  it('trocar de categoria não muda a ferramenta ativa', () => {
    const s = selectCategory(openMenu(INITIAL_MENU), 'mundo');
    expect(s).toMatchObject({ open: true, category: 'mundo', active: 'move' });
  });

  it('escolher uma ferramenta fecha o menu, ativa ela e liga a pintura', () => {
    const { state, effect } = selectItem(openMenu(INITIAL_MENU), 'raise');
    expect(state).toMatchObject({ open: false, active: 'raise' });
    expect(effect).toEqual({ type: 'none' });
    expect(activeBrush(state)).toBe(Tool.Raise);
    expect(inputModeOf(state)).toBe('paint');
  });

  it('escolher velocidade aplica a velocidade e deixa o seletor de tempo na tela', () => {
    const { state, effect } = selectItem(openMenu(INITIAL_MENU, 'tempo'), 'speed20');
    expect(effect).toEqual({ type: 'speed', speed: 20 });
    expect(state).toMatchObject({ open: false, active: SPEED_CARD });
    expect(categoryOfActive(state)).toBe('tempo');
    expect(inputModeOf(state)).toBe('move');
  });

  it('ações (novo mundo, dados) fecham o menu sem trocar a ferramenta ativa', () => {
    const before = { ...INITIAL_MENU, active: 'ice', open: true, category: 'mundo' as const };
    const { state, effect } = selectItem(before, 'newWorld');
    expect(effect).toEqual({ type: 'action', action: 'newWorld' });
    expect(state).toMatchObject({ open: false, active: 'ice' });
  });

  it('itens "em breve" não fazem nada', () => {
    const s = openMenu(INITIAL_MENU, 'desastres');
    expect(selectItem(s, 'volcano')).toEqual({ state: s, effect: { type: 'none' } });
  });

  it('alternar abre e fecha', () => {
    expect(toggleMenu(INITIAL_MENU).open).toBe(true);
    expect(toggleMenu(toggleMenu(INITIAL_MENU)).open).toBe(false);
    expect(closeMenu(openMenu(INITIAL_MENU)).open).toBe(false);
  });
});

describe('interruptores (camadas)', () => {
  it('"Ver placas" liga e desliga, fecha o menu e não troca a ferramenta ativa', () => {
    const s0 = { ...INITIAL_MENU, active: 'raise', open: true, category: 'geologia' as const };
    const a = selectItem(s0, 'platesLayer');
    expect(a.effect).toEqual({ type: 'toggle', id: 'platesLayer', on: true });
    expect(a.state).toMatchObject({ open: false, active: 'raise', toggles: ['platesLayer'] });
    const b = selectItem({ ...a.state, open: true }, 'platesLayer');
    expect(b.effect).toEqual({ type: 'toggle', id: 'platesLayer', on: false });
    expect(b.state.toggles).toEqual([]);
  });
});

it('Velocidade das placas não pinta: um dedo continua girando o globo', () => {
  const { state } = selectItem(openMenu(INITIAL_MENU, 'geologia'), 'plateSpeed');
  expect(state.active).toBe('plateSpeed');
  expect(inputModeOf(state)).toBe('move');
});
