/**
 * Decide quando um toque no modo pintar vira pincelada. Espera um pouco antes de pintar: se o
 * segundo dedo chegar antes, é pinça (zoom) e nada é pintado. Um toque rápido (soltou antes da
 * espera) ainda pinta uma vez. Função pura de tempo (o tempo entra como parâmetro), testada sem
 * depender do relógio real.
 */
export const PAINT_DELAY_MS = 80;

export type GateAction = 'none' | 'first' | 'continue';

export class PaintGate {
  private active = false;
  private startedAt = 0;
  private applied = false;

  constructor(private delayMs = PAINT_DELAY_MS) {}

  /** Dedo (ou botão) encostou. */
  start(now: number): void {
    this.active = true;
    this.startedAt = now;
    this.applied = false;
  }

  /** Virou pinça: descarta a pincelada se ainda não começou e para de pintar. */
  cancel(): void {
    this.active = false;
  }

  /**
   * Chamado a cada quadro: 'first' = primeira aplicação (efeito visível imediato),
   * 'continue' = segue pintando (proporcional ao tempo), 'none' = ainda esperando ou parado.
   */
  frame(now: number): GateAction {
    if (!this.active || now - this.startedAt < this.delayMs) return 'none';
    if (!this.applied) {
      this.applied = true;
      return 'first';
    }
    return 'continue';
  }

  /** Soltou. Retorna true se é um toque rápido que ainda não pintou (aplicar uma vez). */
  end(): boolean {
    const quickTap = this.active && !this.applied;
    this.active = false;
    return quickTap;
  }

  get painting(): boolean {
    return this.active;
  }
}
