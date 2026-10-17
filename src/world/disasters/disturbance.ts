/**
 * Camada de perturbação (marcas temporárias dos desastres): por célula, o tipo da marca, quando ela
 * começou e quando some. Só visual no M2 (ainda não há vida); a vida do M3 vai ler daqui. A marca vai
 * sumindo aos poucos (força = fração do tempo que falta). Lógica pura, sem cor: quem pinta é
 * `src/render/colors.ts` (`tintDisturbance`).
 */
export const Mark = {
  None: 0,
  /** Terra alagada (tsunami, enchente). */
  Flood: 1,
  /** Cinzas de vulcão. */
  Ash: 2,
  /** Área queimada (incêndio). */
  Burned: 3,
  /** Terra ressecada (seca). */
  Dry: 4,
} as const;
export type Mark = (typeof Mark)[keyof typeof Mark];

/** Quanto tempo (anos de jogo) cada marca leva para sumir. Floresta queimada se recupera em décadas. */
export const MARK_YEARS: Record<Exclude<Mark, 0>, number> = { 1: 8, 2: 25, 3: 60, 4: 12 };

export class Disturbance {
  readonly kind: Uint8Array;
  readonly start: Int32Array;
  readonly until: Int32Array;
  /** Células com marca (para não varrer o mundo inteiro). */
  readonly active = new Set<number>();

  constructor(cellCount: number) {
    this.kind = new Uint8Array(cellCount);
    this.start = new Int32Array(cellCount);
    this.until = new Int32Array(cellCount);
  }

  /** Marca a célula de `tick` até `tick + years`; uma marca mais longa já ali fica. */
  mark(c: number, kind: Exclude<Mark, 0>, tick: number, years: number, ticksPerYear: number): void {
    const until = tick + Math.round(years * ticksPerYear);
    if (this.kind[c] && (this.until[c] as number) >= until) return;
    this.kind[c] = kind;
    this.start[c] = tick;
    this.until[c] = until;
    this.active.add(c);
  }

  /** Força da marca (0–1) no passo `tick`. */
  strength(c: number, tick: number): number {
    if (!this.kind[c]) return 0;
    const total = (this.until[c] as number) - (this.start[c] as number);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, ((this.until[c] as number) - tick) / total));
  }

  /** Tira as marcas vencidas; devolve as células que mudaram (para repintar). */
  expire(tick: number): number[] {
    const out: number[] = [];
    for (const c of this.active) {
      if ((this.until[c] as number) > tick) continue;
      this.kind[c] = Mark.None;
      this.active.delete(c);
      out.push(c);
    }
    return out;
  }

  clear(): void {
    for (const c of this.active) this.kind[c] = Mark.None;
    this.active.clear();
  }
}
