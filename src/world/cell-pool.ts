/**
 * Trabalho por célula dividido entre dois workers (o relógio e o ajudante 2), com memória
 * compartilhada. Cada célula é calculada pela mesma função pura em qualquer um dos dois, então o
 * resultado é idêntico ao de um worker só: só muda quem faz cada pedaço.
 */

/** Primeira passada do terreno (`generation.ts`): continente, relevo bruto e ruídos do clima. */
export interface TerrainBaseJob {
  kind: 'terrainBase';
  seed: number;
  landFraction: number;
  positions: Float32Array;
  raw: Float32Array;
  continent: Float32Array;
  tempNoise: Float32Array;
  rainNoise: Float32Array;
}

export type CellJob = TerrainBaseJob;

export interface CellPool {
  /**
   * Roda `local(from, to)` em pedaços de [0, total), com outro worker pegando pedaços ao mesmo tempo
   * (pelo `job`). Volta só quando todos os pedaços terminaram.
   */
  run(job: CellJob, total: number, local: (from: number, to: number) => void, onProgress?: (fraction: number) => void): void;
  /** Fração dos pedaços que o outro worker fez no último trabalho. */
  readonly helperShare: number;
}

/** Células por pedaço: pequeno o bastante para dividir bem, grande o bastante para pouca conversa. */
export const CELL_CHUNK = 4096;

/** Mensagem para o ajudante: o trabalho e o controle compartilhado dos pedaços. */
export interface CellsRequest {
  type: 'cells';
  job: CellJob;
  total: number;
  /** [0] próximo pedaço livre; [1] pedaços terminados; [2 + i] = 1 quando o pedaço i terminou. */
  control: Int32Array;
}

/** Pega o próximo pedaço livre; -1 se acabaram. */
function claim(control: Int32Array, chunks: number): number {
  const i = Atomics.add(control, 0, 1);
  return i < chunks ? i : -1;
}

function finish(control: Int32Array, i: number): void {
  Atomics.store(control, 2 + i, 1);
  Atomics.add(control, 1, 1);
  Atomics.notify(control, 1);
}

/** Lado do ajudante: pega pedaços até acabarem. */
export function helpWithCells(msg: CellsRequest, run: (job: CellJob, from: number, to: number) => void): void {
  const chunks = Math.ceil(msg.total / CELL_CHUNK);
  for (let i = claim(msg.control, chunks); i >= 0; i = claim(msg.control, chunks)) {
    run(msg.job, i * CELL_CHUNK, Math.min(msg.total, (i + 1) * CELL_CHUNK));
    finish(msg.control, i);
  }
}

/**
 * Lado do relógio. Manda o trabalho ao ajudante e pega pedaços também; no fim espera os pedaços que o
 * ajudante pegou. Se ele demorar demais (travou ou morreu), o relógio refaz os que faltam (o
 * resultado é o mesmo, então não importa se os dois escreverem a mesma célula).
 */
export class SharedCellPool implements CellPool {
  /** Fração dos pedaços que o ajudante fez no último trabalho (para o "Medir desempenho"). */
  helperShare = 0;

  constructor(
    private post: (msg: CellsRequest) => void,
    private now: () => number,
    private wait: (control: Int32Array, value: number, ms: number) => void = (c, v, ms) => {
      Atomics.wait(c, 1, v, ms);
    },
    private timeoutMs = 10_000,
  ) {}

  run(job: CellJob, total: number, local: (from: number, to: number) => void, onProgress?: (fraction: number) => void): void {
    const chunks = Math.ceil(total / CELL_CHUNK);
    const control = new Int32Array(new SharedArrayBuffer(4 * (2 + chunks)));
    this.post({ type: 'cells', job, total, control });
    const range = (i: number): [number, number] => [i * CELL_CHUNK, Math.min(total, (i + 1) * CELL_CHUNK)];
    let mine = 0;
    for (let i = claim(control, chunks); i >= 0; i = claim(control, chunks)) {
      mine++;
      local(...range(i));
      finish(control, i);
      onProgress?.(Atomics.load(control, 1) / chunks);
    }
    const deadline = this.now() + this.timeoutMs;
    for (let done = Atomics.load(control, 1); done < chunks; done = Atomics.load(control, 1)) {
      if (this.now() > deadline) {
        for (let i = 0; i < chunks; i++) if (!Atomics.load(control, 2 + i)) local(...range(i));
        break;
      }
      this.wait(control, done, 50);
    }
    onProgress?.(1);
    this.helperShare = chunks > 0 ? 1 - mine / chunks : 0;
  }
}
