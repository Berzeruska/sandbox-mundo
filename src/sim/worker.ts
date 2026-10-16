/// <reference lib="webworker" />
import { enableSharedMemory, sharedMemoryEnabled } from '../core/shared';
import { shadeWeightsFor } from '../render/colors';
import { upwindTable } from '../world/climate';
import type { CubeSphere } from '../world/cubesphere';
import { LocalGeology, SimulationCore, type GeologyPort } from './core';
import type { GeologyCommand, GeologyInit, HelperReply, HelperRequest } from './geology';
import { SHARED_PROBE_VALUE, type ToWorker } from './protocol';

/**
 * Web Worker da simulação: só liga o núcleo (`SimulationCore`) às mensagens e roda o laço do
 * relógio. Toda a lógica está no núcleo, que é testado sem worker.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
// Com a página isolada, a grade, as tabelas e o mundo nascem em memória compartilhada e a geologia
// pesada vai para o ajudante 2 (correção 2). Sem isolamento, roda aqui mesmo, como antes.
enableSharedMemory(true);

/** Ajudante 2 "Terra": recomposição das placas, clima e cores do mundo todo, em outro worker. */
class RemoteGeology implements GeologyPort {
  readonly perTick = false;
  private helper: Worker;
  private engineBytes = 0;

  constructor(private core: SimulationCore) {
    this.helper = new Worker(new URL('./geology-worker.ts', import.meta.url), { type: 'module' });
    this.helper.onmessage = (e: MessageEvent<HelperReply>) => {
      const msg = e.data;
      try {
        if (msg.type === 'ready') this.core.onGeologyBuffers(msg.buffers);
        else {
          if (msg.type === 'result') this.engineBytes = msg.result.stats.engineBytes;
          this.core.onGeologyEvent(msg);
        }
      } catch (err) {
        report(err);
      }
      wake();
    };
    this.helper.onerror = (e) => {
      e.preventDefault();
      report(new Error(`Ajudante da geologia não carregou: ${e.message || 'sem detalhes'}`));
    };
  }

  private request(msg: HelperRequest): void {
    this.helper.postMessage(msg);
  }

  start(init: GeologyInit, grid: CubeSphere): void {
    this.engineBytes = 0;
    this.request({
      type: 'init',
      init,
      grid: { n: grid.n, positions: grid.positions, neighbors: grid.neighbors },
      upwind: upwindTable(grid),
      shade: shadeWeightsFor(grid),
    });
  }

  send(cmd: GeologyCommand): void {
    this.request({ type: 'command', cmd });
  }

  get bytes(): number {
    return this.engineBytes;
  }
}

const core = new SimulationCore(
  (msg, transfer) => scope.postMessage(msg, transfer),
  undefined,
  (c) => (sharedMemoryEnabled() ? new RemoteGeology(c) : new LocalGeology(c, () => performance.now())),
);

/** Qualquer erro vira mensagem para a tela (que mostra o texto e "tentar de novo"). */
function report(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  scope.postMessage({ type: 'error', message, stack: err instanceof Error ? err.stack : undefined });
}

scope.postMessage({ type: 'hello', version: __BUILD_ID__ });

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'sharedProbe') {
    // Teste de memória compartilhada: a tela lê o valor no mesmo buffer, sem cópia.
    let ok: boolean;
    try {
      Atomics.store(new Int32Array(msg.buffer), 0, SHARED_PROBE_VALUE);
      ok = true;
    } catch {
      ok = false;
    }
    scope.postMessage({ type: 'sharedProbe', ok });
    return;
  }
  try {
    core.handle(msg);
  } catch (err) {
    report(err);
  }
  wake();
};
scope.onerror = (e) => {
  report(e instanceof ErrorEvent ? (e.error ?? e.message) : e);
};
scope.onunhandledrejection = (e) => report(e.reason);

// Laço do relógio, independente dos quadros da tela. Só roda com o tempo correndo: pausado (ou
// sem mundo), o worker dorme e uma mensagem nova (ex.: mudar a velocidade) o acorda.
const STEP_MS = 1000 / 60;
let last = 0;
let scheduled = false;
let failed = false;
const loop = (): void => {
  scheduled = false;
  const now = performance.now();
  if (!failed) {
    try {
      core.advance((now - last) / 1000);
    } catch (err) {
      failed = true; // avisa uma vez e para o relógio, em vez de repetir o erro todo quadro
      report(err);
    }
  }
  last = now;
  if (core.running && !failed) {
    scheduled = true;
    setTimeout(loop, STEP_MS);
  }
};
function wake(): void {
  if (scheduled || failed || !core.running) return;
  scheduled = true;
  last = performance.now();
  setTimeout(loop, STEP_MS);
}
