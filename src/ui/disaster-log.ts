import { TICKS_PER_YEAR } from '../core/time';
import type { Vec3 } from '../world/cubesphere';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';

/**
 * Avisos de desastre (T12; R2: sem a lista, avisos no canto inferior esquerdo). Só os desastres grandes
 * e naturais viram aviso. A crônica permanente é do M5.
 */

/** Quanto tempo um aviso fica na tela (ms) e quantos ao mesmo tempo. */
export const TOAST_MS = 6000;
export const MAX_TOASTS = 3;

export const DISASTER_ICONS: Record<number, string> = {
  [DisasterKind.Quake]: '💥',
  [DisasterKind.Tsunami]: '🌊',
  [DisasterKind.Volcano]: '🌋',
  [DisasterKind.Drought]: '🏜️',
  [DisasterKind.Flood]: '🌧️',
  [DisasterKind.Hurricane]: '🌀',
  [DisasterKind.Fire]: '🔥',
  [DisasterKind.Lightning]: '⚡',
  [DisasterKind.Meteor]: '☄️',
  [DisasterKind.Sandstorm]: '🌪️',
};

export interface LogEntry {
  id: number;
  kind: DisasterKind;
  year: number;
  label: string;
  point: Vec3;
  notable: boolean;
  manual: boolean;
  /** Aviso que não é de desastre (vida, M3): ícone próprio. */
  icon?: string;
}

/** Vira aviso: grande e natural (o que o jogador provocou ele já está vendo). */
export function isToast(e: DisasterEvent): boolean {
  return e.notable && !e.manual;
}

export function toEntry(e: DisasterEvent): LogEntry {
  return { id: e.id, kind: e.kind, year: 1 + Math.floor(e.tick / TICKS_PER_YEAR), label: e.label, point: e.point, notable: e.notable, manual: e.manual };
}

/** Avisos da vida (`docs/04-ecologia.md`): espécie em risco, último indivíduo (tocar leva a câmera até ele), extinção e recuperação. */
export const LIFE_ICONS: Record<string, string> = { risco: '⚠️', ultimo: '🕯️', extinta: '✝️', recuperada: '🌱' };
export function lifeEntry(kind: 'risco' | 'ultimo' | 'extinta' | 'recuperada', name: string, year: number, point: Vec3, id: number): LogEntry {
  const label = kind === 'risco' ? `${name}: espécie em risco` : kind === 'ultimo' ? `${name}: último indivíduo (toque para ir até ele)` : kind === 'extinta' ? `${name}: extinta` : `${name}: saiu do risco`;
  return { id, kind: -1 as DisasterKind, year: year + 1, label, point, notable: true, manual: false, icon: LIFE_ICONS[kind] as string };
}

/** Texto de uma linha: "Ano 1.234 · Terremoto M 7,8". */
export function entryText(e: LogEntry): string {
  return `Ano ${e.year.toLocaleString('pt-BR')} · ${e.label}${e.manual ? ' (provocado)' : ''}`;
}
