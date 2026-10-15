import type { InputMode } from '../input/pointer';
import { Tool } from '../input/tools';
import type { Speed } from '../core/time';

/**
 * Estado do menu de ferramentas por categorias (lógica pura, sem DOM).
 * Na tela fica só a ferramenta ativa; o menu abre por categoria para escolher outra.
 */

export type CategoryId = 'tempo' | 'relevo' | 'desastres' | 'geologia' | 'clima' | 'mundo';

export const CATEGORIES: readonly { id: CategoryId; label: string; icon: string }[] = [
  { id: 'tempo', label: 'Tempo', icon: '⏱️' },
  { id: 'relevo', label: 'Relevo', icon: '⛰️' },
  { id: 'desastres', label: 'Desastres', icon: '🌋' },
  { id: 'geologia', label: 'Geologia', icon: '🌍' },
  { id: 'clima', label: 'Clima', icon: '🌡️' },
  { id: 'mundo', label: 'Mundo', icon: '🪐' },
];

/**
 * O que um item do menu faz:
 * - `speed`: muda a velocidade e deixa o seletor de velocidade na tela;
 * - `tool`: vira a ferramenta ativa (fica na tela);
 * - `action`: faz algo uma vez (novo mundo, painel de dados) sem trocar a ferramenta ativa;
 * - `toggle`: liga/desliga algo (camadas como "Ver placas") sem trocar a ferramenta ativa.
 */
export type ItemKind = 'speed' | 'tool' | 'action' | 'toggle';

export interface MenuItem {
  id: string;
  category: CategoryId;
  label: string;
  icon: string;
  kind: ItemKind;
  /** Falso = aparece apagado com "em breve" (chega numa tarefa futura do M2). */
  available: boolean;
  /** Para `speed`: a velocidade. */
  speed?: Speed;
  /** Para ferramentas de relevo que pintam: o pincel. */
  brush?: Tool;
}

export const ITEMS: readonly MenuItem[] = [
  { id: 'pause', category: 'tempo', label: 'Pausa', icon: '⏸', kind: 'speed', available: true, speed: 0 },
  { id: 'speed1', category: 'tempo', label: '1×', icon: '▶', kind: 'speed', available: true, speed: 1 },
  { id: 'speed2', category: 'tempo', label: '2×', icon: '⏩', kind: 'speed', available: true, speed: 2 },
  { id: 'speed5', category: 'tempo', label: '5×', icon: '⏩', kind: 'speed', available: true, speed: 5 },
  { id: 'speed20', category: 'tempo', label: '20×', icon: '⏭', kind: 'speed', available: true, speed: 20 },
  { id: 'speedMax', category: 'tempo', label: 'Máx', icon: '🚀', kind: 'speed', available: true, speed: 'max' },

  { id: 'move', category: 'relevo', label: 'Mover', icon: '✋', kind: 'tool', available: true },
  { id: 'raise', category: 'relevo', label: 'Elevar', icon: '⛰️', kind: 'tool', available: true, brush: Tool.Raise },
  { id: 'lower', category: 'relevo', label: 'Rebaixar', icon: '⛏️', kind: 'tool', available: true, brush: Tool.Lower },
  { id: 'water', category: 'relevo', label: 'Água', icon: '💧', kind: 'tool', available: true, brush: Tool.Water },
  { id: 'ice', category: 'relevo', label: 'Gelo', icon: '❄️', kind: 'tool', available: true, brush: Tool.Ice },
  { id: 'melt', category: 'relevo', label: 'Derreter', icon: '🔥', kind: 'tool', available: true, brush: Tool.EraseIce },

  { id: 'quake', category: 'desastres', label: 'Terremoto', icon: '💥', kind: 'tool', available: false },
  { id: 'volcano', category: 'desastres', label: 'Vulcão', icon: '🌋', kind: 'tool', available: false },
  { id: 'tsunami', category: 'desastres', label: 'Tsunami', icon: '🌊', kind: 'tool', available: false },
  { id: 'drought', category: 'desastres', label: 'Seca', icon: '🏜️', kind: 'tool', available: false },
  { id: 'flood', category: 'desastres', label: 'Enchente', icon: '🌧️', kind: 'tool', available: false },
  { id: 'hurricane', category: 'desastres', label: 'Furacão', icon: '🌀', kind: 'tool', available: false },
  { id: 'fire', category: 'desastres', label: 'Incêndio', icon: '🔥', kind: 'tool', available: false },

  { id: 'platesLayer', category: 'geologia', label: 'Ver placas', icon: '🧩', kind: 'toggle', available: true },
  { id: 'plateSpeed', category: 'geologia', label: 'Velocidade', icon: '⏩', kind: 'tool', available: true },

  { id: 'temperature', category: 'clima', label: 'Temperatura', icon: '🌡️', kind: 'tool', available: false },

  { id: 'newWorld', category: 'mundo', label: 'Novo mundo', icon: '🌍', kind: 'action', available: true },
  { id: 'debug', category: 'mundo', label: 'Dados', icon: '🐞', kind: 'action', available: true },
];

/** Item que fica na tela quando o jogador escolhe uma velocidade (o seletor de tempo). */
export const SPEED_CARD = 'speed';

export function itemById(id: string): MenuItem | undefined {
  return ITEMS.find((i) => i.id === id);
}

export function itemsOf(category: CategoryId): MenuItem[] {
  return ITEMS.filter((i) => i.category === category);
}

export interface MenuState {
  open: boolean;
  /** Categoria mostrada no menu. */
  category: CategoryId;
  /** O que está na tela: o id de uma ferramenta, ou SPEED_CARD (seletor de velocidade). */
  active: string;
  /** Interruptores ligados (ids de itens `toggle`). */
  toggles: readonly string[];
}

export type MenuEffect =
  | { type: 'none' }
  | { type: 'speed'; speed: Speed }
  | { type: 'action'; action: string }
  | { type: 'toggle'; id: string; on: boolean };

export const INITIAL_MENU: MenuState = { open: false, category: 'relevo', active: 'move', toggles: [] };

/** Categoria do que está ativo na tela (para abrir o menu "no lugar certo"). */
export function categoryOfActive(state: MenuState): CategoryId {
  if (state.active === SPEED_CARD) return 'tempo';
  return itemById(state.active)?.category ?? 'relevo';
}

/** Abre o menu; sem categoria, abre na categoria da ferramenta ativa. */
export function openMenu(state: MenuState, category?: CategoryId): MenuState {
  return { ...state, open: true, category: category ?? categoryOfActive(state) };
}

export function closeMenu(state: MenuState): MenuState {
  return { ...state, open: false };
}

export function toggleMenu(state: MenuState): MenuState {
  return state.open ? closeMenu(state) : openMenu(state);
}

export function selectCategory(state: MenuState, category: CategoryId): MenuState {
  return { ...state, category };
}

/** Toque num item do menu: muda o estado e diz o que o jogo deve fazer. */
export function selectItem(state: MenuState, id: string): { state: MenuState; effect: MenuEffect } {
  const item = itemById(id);
  if (!item || !item.available) return { state, effect: { type: 'none' } };
  if (item.kind === 'speed') {
    return { state: { ...state, open: false, active: SPEED_CARD }, effect: { type: 'speed', speed: item.speed ?? 1 } };
  }
  if (item.kind === 'action') {
    return { state: { ...state, open: false }, effect: { type: 'action', action: item.id } };
  }
  if (item.kind === 'toggle') {
    const on = !state.toggles.includes(item.id);
    const toggles = on ? [...state.toggles, item.id] : state.toggles.filter((t) => t !== item.id);
    return { state: { ...state, open: false, toggles }, effect: { type: 'toggle', id: item.id, on } };
  }
  return { state: { ...state, open: false, active: item.id }, effect: { type: 'none' } };
}

export function isOn(state: MenuState, id: string): boolean {
  return state.toggles.includes(id);
}

/** Pincel da ferramenta ativa, ou null (mover, seletor de tempo...). */
export function activeBrush(state: MenuState): Tool | null {
  return itemById(state.active)?.brush ?? null;
}

/** Ferramenta de pintura ativa = um dedo pinta; senão, um dedo gira o globo. */
export function inputModeOf(state: MenuState): InputMode {
  return activeBrush(state) === null ? 'move' : 'paint';
}
