/**
 * Relógio do mundo com passo fixo: a simulação sempre avança em passos iguais (1 passo = 1 mês),
 * não importa a taxa de quadros. A velocidade só muda quantos passos rodam por segundo real.
 */
export const TICKS_PER_YEAR = 12;
/** Passos por segundo real na velocidade 1× (1× = 1 ano por segundo). */
export const BASE_TICKS_PER_SECOND = 12;
/** Teto de passos num único quadro (protege contra travar a tela em "máximo"). */
export const MAX_TICKS_PER_FRAME = 600;
/** Em 1×, dentro da maquete: um mês de jogo por segundo. */
export const MAQUETE_PACE = 1 / 12;
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

/** Reduzir a velocidade com rocha caindo: o botão muda na hora e o tempo espera o impacto (T8, opção 3). Pausar e acelerar valem na hora. */
export function holdsSpeedChange(current: Speed, requested: Speed, fallingUntil: number, tick: number): boolean {
  if (requested === 0 || current === 0 || fallingUntil <= tick) return false;
  const rate = (s: Speed): number => (s === 'max' ? Infinity : s);
  return rate(requested) < rate(current);
}

export class Clock {
  /** Passos desde o início do mundo. */
  tick = 0;
  speed: Speed = 1;
  /**
   * Ritmo da maquete (decisão do usuário, 2026-11-09, opção 5): olhando de perto em 1×, o tempo anda a 1/12 (um mês por segundo), para o fogo, os bichos e a chuva
   * ficarem na mesma escala. Só vale em 1×; 2×, 5×, 20× e Máx seguem como escolhidos. Não muda o mundo: só quantos passos rodam por segundo.
   */
  pace = 1;
  private accumulator = 0;

  /**
   * Avança o relógio pelo tempo real `dt` (segundos), chamando `step` a cada passo.
   * Retorna quantos passos rodaram. `now` mede o orçamento da velocidade máxima.
   */
  advance(
    dt: number,
    step?: (tick: number) => void,
    now: () => number = () => performance.now(),
    canStep?: (next: number) => boolean,
  ): number {
    if (this.speed === 0 || dt <= 0) return 0;
    let count: number;
    if (this.speed === 'max') {
      const start = now();
      count = 0;
      while (count < MAX_TICKS_PER_FRAME && now() - start < MAX_SPEED_BUDGET_MS) {
        if (canStep && !canStep(this.tick + 1)) break;
        this.tick++;
        count++;
        step?.(this.tick);
      }
      return count;
    }
    this.accumulator += Math.min(dt, MAX_FRAME_DT) * BASE_TICKS_PER_SECOND * this.speed * (this.speed === 1 ? this.pace : 1);
    count = Math.min(MAX_TICKS_PER_FRAME, Math.floor(this.accumulator));
    this.accumulator -= count;
    // Se bateu no teto, descarta o atraso em vez de acumular uma dívida infinita.
    if (this.accumulator > MAX_TICKS_PER_FRAME) this.accumulator = 0;
    for (let i = 0; i < count; i++) {
      // `canStep` false: espera (ex.: o ajudante da geologia atrasou); o que faltou fica para depois,
      // dentro do teto de MAX_FRAME_DT por chamada.
      if (canStep && !canStep(this.tick + 1)) {
        this.accumulator = Math.min(this.accumulator + (count - i), BASE_TICKS_PER_SECOND * (this.speed as number) * MAX_FRAME_DT);
        return i;
      }
      this.tick++;
      step?.(this.tick);
    }
    return count;
  }

  /** Passos já devidos e ainda não rodados (fração incluída). */
  get backlog(): number {
    return this.accumulator;
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
