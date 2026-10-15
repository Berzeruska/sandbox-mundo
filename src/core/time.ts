/**
 * Relógio do mundo com passo fixo: a simulação sempre avança em passos iguais (1 passo = 1 mês),
 * não importa a taxa de quadros. A velocidade só muda quantos passos rodam por segundo real.
 */
export const TICKS_PER_YEAR = 12;
/** Passos por segundo real na velocidade 1× (1× = 1 ano por segundo). */
export const BASE_TICKS_PER_SECOND = 12;
/** Teto de passos num único quadro (protege contra travar a tela em "máximo"). */
export const MAX_TICKS_PER_FRAME = 600;
/** Orçamento de tempo de simulação por quadro na velocidade máxima (ms). */
export const MAX_SPEED_BUDGET_MS = 8;
/** Maior intervalo real considerado num quadro (aba em segundo plano, engasgo). */
const MAX_FRAME_DT = 0.25;

export type Speed = 0 | 1 | 2 | 5 | 20 | 'max';
export const SPEEDS: readonly Speed[] = [0, 1, 2, 5, 20, 'max'];

export function speedLabel(speed: Speed): string {
  if (speed === 0) return '⏸';
  return speed === 'max' ? 'Máx' : `${speed}×`;
}

export class Clock {
  /** Passos desde o início do mundo. */
  tick = 0;
  speed: Speed = 1;
  private accumulator = 0;

  /**
   * Avança o relógio pelo tempo real `dt` (segundos), chamando `step` a cada passo.
   * Retorna quantos passos rodaram. `now` mede o orçamento da velocidade máxima.
   */
  advance(dt: number, step?: (tick: number) => void, now: () => number = () => performance.now()): number {
    if (this.speed === 0 || dt <= 0) return 0;
    let count: number;
    if (this.speed === 'max') {
      const start = now();
      count = 0;
      while (count < MAX_TICKS_PER_FRAME && now() - start < MAX_SPEED_BUDGET_MS) {
        this.tick++;
        count++;
        step?.(this.tick);
      }
      return count;
    }
    this.accumulator += Math.min(dt, MAX_FRAME_DT) * BASE_TICKS_PER_SECOND * this.speed;
    count = Math.min(MAX_TICKS_PER_FRAME, Math.floor(this.accumulator));
    this.accumulator -= count;
    // Se bateu no teto, descarta o atraso em vez de acumular uma dívida infinita.
    if (this.accumulator > MAX_TICKS_PER_FRAME) this.accumulator = 0;
    for (let i = 0; i < count; i++) {
      this.tick++;
      step?.(this.tick);
    }
    return count;
  }

  /** Ano atual, começando no ano 1. */
  year(): number {
    return 1 + Math.floor(this.tick / TICKS_PER_YEAR);
  }

  /** Mês atual, de 1 a 12. */
  month(): number {
    return (this.tick % TICKS_PER_YEAR) + 1;
  }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatDate(clock: Clock): string {
  return `Ano ${clock.year().toLocaleString('pt-BR')} · ${MONTHS[clock.month() - 1] ?? ''}`;
}
