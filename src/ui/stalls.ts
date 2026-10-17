/**
 * Registro de travadas (pedido do usuário, 2026-10-16), sempre ligado: o "relógio esperou" do
 * relatório só mede o relógio parado à espera do ajudante; aqui entra tudo o que o jogador vê parar.
 * - **tela:** um quadro que demorou mais que FRAME_STALL_MS (a imagem engasga);
 * - **data:** com o tempo correndo, a data ficou mais que DATE_STALL_MS sem mudar.
 * Cada travada guarda a hora, quanto durou e o que estava acontecendo. Lógica pura, com tempos
 * passados por quem chama (testada sem relógio real).
 */

export const FRAME_STALL_MS = 100;
export const DATE_STALL_MS = 300;
/** Quantas travadas ficam guardadas para mostrar. */
export const STALL_KEEP = 12;

export type StallKind = 'tela' | 'data';

export interface StallEntry {
  kind: StallKind;
  /** Hora do relógio de parede quando terminou (ms desde 1970), para mostrar hh:mm:ss. */
  wall: number;
  ms: number;
  cause: string;
  /** Velocidade e placas naquela hora (ex.: "20× · placas 100%"). */
  context: string;
  /** Quanto tempo antes do fim da travada chegou a última recomposição à tela (ms; -1: nenhuma ainda). */
  sinceRecomposition: number;
}

export class StallLog {
  readonly entries: StallEntry[] = [];
  readonly counts: Record<StallKind, number> = { tela: 0, data: 0 };
  private lastFrame = -1;
  private lastWork = 0;
  private lastClock = -1;
  private lastWait = 0;
  private lastRecompositions = 0;
  /** Recomposições recebidas pela tela: [quando terminou, quanto levou]. */
  private received: [number, number][] = [];
  /** Fim e começo da última travada de tela (para explicar uma travada de data junto). */
  private lastScreenStall: [number, number] = [-1, -1];
  private lastRecompositionAt = -1;

  /** Recomeça a contagem dos intervalos (página escondida, mundo novo, pausa). Não apaga o registro. */
  restart(): void {
    this.lastFrame = -1;
    this.lastClock = -1;
  }

  /** A tela recebeu uma recomposição que levou `ms` para aplicar, terminando em `now`. */
  noteRecomposition(now: number, ms: number): void {
    this.received.push([now, ms]);
    if (this.received.length > 8) this.received.shift();
    this.lastRecompositionAt = now;
  }

  /** Começo de um quadro. */
  frame(now: number, wall: number, context: string): void {
    const gap = this.lastFrame < 0 ? 0 : now - this.lastFrame;
    if (gap > FRAME_STALL_MS) {
      this.lastScreenStall = [now, this.lastFrame];
      this.add({ kind: 'tela', wall, ms: gap, cause: this.screenCause(now, gap), context, sinceRecomposition: this.since(now) });
    }
    this.lastFrame = now;
  }

  /** Fim de um quadro: quanto a tela trabalhou nele (ms). */
  frameWork(ms: number): void {
    this.lastWork = ms;
  }

  /**
   * Chegou o relógio do worker. `running`: tempo correndo (pausado não conta). `waitMs` e
   * `recompositions` são os contadores acumulados do worker.
   */
  clock(now: number, wall: number, running: boolean, waitMs: number, recompositions: number, context: string): void {
    const gap = this.lastClock < 0 || !running ? 0 : now - this.lastClock;
    if (gap > DATE_STALL_MS) {
      this.add({ kind: 'data', wall, ms: gap, cause: this.dateCause(now, gap, waitMs - this.lastWait, recompositions - this.lastRecompositions), context, sinceRecomposition: this.since(now) });
    }
    this.lastClock = running ? now : -1;
    this.lastWait = waitMs;
    this.lastRecompositions = recompositions;
  }

  private screenCause(now: number, gap: number): string {
    const start = now - gap;
    const got = this.received.filter(([at]) => at > start && at <= now);
    const receiving = got.reduce((sum, [, ms]) => sum + ms, 0);
    if (got.length && receiving >= 0.3 * gap) return `tela aplicando recomposição (${Math.round(receiving)} ms)`;
    if (this.lastWork >= 0.5 * gap) return `desenho do quadro (${Math.round(this.lastWork)} ms)`;
    // A tela não trabalhou: o tempo foi para fora do código dela (GPU, outro trabalho no núcleo,
    // limpeza de memória do navegador ou o sistema). "recomposição há" ajuda a ver se coincide.
    return 'fora do código da tela (GPU, núcleo ocupado, limpeza de memória ou sistema)';
  }

  private dateCause(now: number, gap: number, waited: number, recomposed: number): string {
    const [end, start] = this.lastScreenStall;
    if (end >= now - gap && start <= now && end - start >= 0.5 * gap) return 'a tela travou junto (ver "tela")';
    if (waited > 0) return `relógio esperou o ajudante ${Math.round(waited)} ms`;
    if (recomposed > 0) return 'relógio aplicando recomposição';
    return 'relógio atrasou (núcleo ocupado)';
  }

  private since(now: number): number {
    return this.lastRecompositionAt < 0 ? -1 : now - this.lastRecompositionAt;
  }

  private add(e: StallEntry): void {
    this.counts[e.kind]++;
    this.entries.push(e);
    if (this.entries.length > STALL_KEEP) this.entries.shift();
  }

  /** Resumo e as últimas `count` travadas, uma por linha (para o painel Dados e o relatório). */
  lines(count: number, timeOf: (wall: number) => string): string[] {
    const head = `travadas ${this.counts.tela} da tela · ${this.counts.data} da data`;
    const last = this.entries.slice(-count).reverse();
    const since = (e: StallEntry) => (e.sinceRecomposition < 0 ? '' : ` · recomposição há ${(e.sinceRecomposition / 1000).toFixed(1).replace('.', ',')} s`);
    return [head, ...last.map((e) => `  ${timeOf(e.wall)} ${e.kind} ${Math.round(e.ms)} ms · ${e.cause} · ${e.context}${since(e)}`)];
  }
}
