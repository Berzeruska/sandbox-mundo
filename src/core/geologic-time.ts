import { Clock, type Speed } from './time';

/**
 * Modo de tempo geológico (decisão do usuário, 2026-11-05): em 20× ou Máx com as placas andando, a câmera
 * fica no planeta inteiro, o zoom trava e a data anda em saltos. Lógica pura, testada sem navegador.
 */

/** De quantos em quantos anos a data salta, em cada velocidade. */
export const JUMP_YEARS_20X = 500;
export const JUMP_YEARS_MAX = 1000;

/** Salto da data em anos com esta velocidade e estas placas; 0: modo desligado. */
export function geologicJump(speed: Speed, plateRate: number): number {
  if (plateRate <= 0) return 0;
  if (speed === 20) return JUMP_YEARS_20X;
  return speed === 'max' ? JUMP_YEARS_MAX : 0;
}

/** O último múltiplo do salto já alcançado: o ano que a data mostra nesse modo. */
export function jumpYear(clock: Clock, jump: number): number {
  return Math.max(1, Math.floor(clock.year() / jump) * jump);
}

/** Data em saltos: "Ano 12.500" (sem mês). */
export function formatJumpYear(year: number): string {
  return `Ano ${year.toLocaleString('pt-BR')}`;
}

/** Quanto os números da data levam rolando até o salto novo (ms). */
export const DATE_ROLL_MS = 700;

/**
 * Os números da data rolando até o salto novo, como um contador (usuário, teste da `3238cd7b`): rápido no
 * começo e assentando no valor certo. Só calcula um número por quadro e só enquanto rola; a data nunca volta
 * (20× para Máx troca o salto de 500 por 1.000: o ano fica até o múltiplo novo passar dele).
 */
export class RollingYear {
  private from = 0;
  private to = 0;
  private start = 0;
  private started = false;

  /** O ano-alvo agora: a primeira vez aparece direto, depois rola. */
  set(target: number, now: number): void {
    if (!this.started) {
      this.started = true;
      this.from = this.to = target;
      return;
    }
    if (target <= this.to) return;
    this.from = this.at(now);
    this.to = target;
    this.start = now;
  }

  /** O ano a mostrar no instante `now`. */
  at(now: number): number {
    const u = Math.min(1, (now - this.start) / DATE_ROLL_MS);
    return u >= 1 ? this.to : Math.round(this.from + (this.to - this.from) * (1 - (1 - u) ** 3));
  }

  /** Mundo novo ou fim do modo: o próximo `set` aparece direto. */
  reset(): void {
    this.started = false;
  }
}

/**
 * Até quantos passos o relógio fica à frente do motor no Máx (o limite duro é APPLY_DELAY_TICKS, 480).
 * Fica abaixo dele para o relógio nunca chegar a parar.
 */
export const MAX_SPEED_LEAD = 440;
/**
 * Constante de tempo do ritmo no Máx (s). Sem o motor ocupado, o relógio corre a LEAD/TAU = 2.200 passos
 * por segundo; ocupado, a folga vai acabando e o relógio freia aos poucos, sem nunca parar.
 */
export const MAX_SPEED_TAU = 0.2;
/** Maior intervalo real que conta para o ritmo (s), para uma volta atrasada não virar uma rajada. */
const MAX_PACE_DT = 0.05;

/**
 * Quantos passos o relógio pode andar nesta volta do Máx. `lead`: passos à frente do motor. Antes o Máx
 * corria até bater no limite e ficava parado até o motor terminar a recomposição (data parada 400–550 ms,
 * teste da `2d9a2156`); agora a velocidade cai junto com a folga: rate = (LEAD − lead) / TAU. `carry` é a
 * fração de passo que sobrou da volta anterior; devolve os passos inteiros e a fração nova.
 */
export function maxSpeedQuota(lead: number, dt: number, carry: number): { quota: number; carry: number } {
  const rate = Math.max(0, MAX_SPEED_LEAD - lead) / MAX_SPEED_TAU;
  const total = carry + rate * Math.min(dt, MAX_PACE_DT);
  const quota = Math.floor(total);
  return { quota, carry: total - quota };
}
