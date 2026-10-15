/// <reference lib="webworker" />
import { SimulationCore } from './core';
import type { ToWorker } from './protocol';

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
  try {
    core.handle(e.data);
  } catch (err) {
    report(err);
  }
};
scope.onerror = (e) => {
  report(e instanceof ErrorEvent ? (e.error ?? e.message) : e);
};
scope.onunhandledrejection = (e) => report(e.reason);

// Laço do relógio, independente dos quadros da tela.
const STEP_MS = 1000 / 60;
let last = performance.now();
let failed = false;
const loop = (): void => {
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
  setTimeout(loop, STEP_MS);
};
setTimeout(loop, STEP_MS);
