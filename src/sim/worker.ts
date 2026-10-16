/// <reference lib="webworker" />
import { SimulationCore } from './core';
import { SHARED_PROBE_VALUE, type ToWorker } from './protocol';

/**
 * Web Worker da simulação: só liga o núcleo (`SimulationCore`) às mensagens e roda o laço do
 * relógio. Toda a lógica está no núcleo, que é testado sem worker.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const core = new SimulationCore((msg, transfer) => scope.postMessage(msg, transfer));

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
