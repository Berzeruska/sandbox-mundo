/**
 * Decide quando um toque no modo pintar vira pincelada. Espera um pouco antes de pintar: se o
 * segundo dedo chegar antes, é pinça (zoom) e nada é pintado. Um toque rápido (soltou antes da
 * espera) ainda pinta uma vez. Função pura de tempo (o tempo entra como parâmetro), testada sem
 * depender do relógio real.
 */
export const PAINT_DELAY_MS = 80;
/**
 * Com a camada "Ver recursos" ligada (T6, opção a do usuário): toque curto numa jazida mostra o nome e
 * não pinta. A pincelada espera até este tempo segurando, ou começa já se o dedo andar.
 */
export const TAP_HOLD_MS = 300;

export type GateAction = 'none' | 'first' | 'continue';

export class PaintGate {
  private active = false;
  private startedAt = 0;
  private applied = false;
  private wait = PAINT_DELAY_MS;
  private moved = false;

  constructor(private delayMs = PAINT_DELAY_MS) {}

  /** Dedo (ou botão) encostou. `holdMs`: espera antes de pintar (mais longa com a camada de recursos). */
  start(now: number, holdMs = this.delayMs): void {
    this.active = true;
    this.startedAt = now;
    this.applied = false;
    this.wait = holdMs;
    this.moved = false;
  }

  /** O dedo andou de verdade: é pincelada, não toque (pinta já, depois da espera curta). */
  move(): void {
    this.moved = true;
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
    const wait = this.moved ? Math.min(this.wait, this.delayMs) : this.wait;
    if (!this.active || now - this.startedAt < wait) return 'none';
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
