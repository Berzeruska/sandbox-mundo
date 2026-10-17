import { TICKS_PER_YEAR } from '../core/time';
import type { Vec3 } from '../world/cubesphere';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';

/**
 * Avisos e lista de desastres (T12). Só os desastres grandes viram aviso na tela; a lista guarda todos
 * (os mais recentes primeiro). Não é a crônica permanente (M5): a lista guarda só os últimos.
 */

/** Quantos desastres a lista guarda. */
export const LOG_KEEP = 300;
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
};

export interface LogEntry {
  id: number;
  kind: DisasterKind;
  year: number;
  label: string;
  point: Vec3;
  notable: boolean;
  manual: boolean;
}

/** Vira aviso: grande e natural (o que o jogador provocou ele já está vendo). */
export function isToast(e: DisasterEvent): boolean {
  return e.notable && !e.manual;
}

/** Texto de uma linha: "Ano 1.234 · Terremoto M 7,8". */
export function entryText(e: LogEntry): string {
  return `Ano ${e.year.toLocaleString('pt-BR')} · ${e.label}${e.manual ? ' (provocado)' : ''}`;
}

export class DisasterLog {
  /** Mais recentes primeiro. */
  entries: LogEntry[] = [];

  add(events: readonly DisasterEvent[]): LogEntry[] {
    const added = events.map((e) => ({
      id: e.id,
      kind: e.kind,
      year: 1 + Math.floor(e.tick / TICKS_PER_YEAR),
      label: e.label,
      point: e.point,
      notable: e.notable,
      manual: e.manual,
    }));
    this.entries = [...added].reverse().concat(this.entries).slice(0, LOG_KEEP);
    return added;
  }

  clear(): void {
    this.entries = [];
  }
}
