/// <reference lib="webworker" />
import { SimulationCore } from './core';
import type { ToWorker } from './protocol';

/**
 * Web Worker da simulação: só liga o núcleo (`SimulationCore`) às mensagens e roda o laço do
 * relógio. Toda a lógica está no núcleo, que é testado sem worker.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const core = new SimulationCore((msg, transfer) => scope.postMessage(msg, transfer));

scope.onmessage = (e: MessageEvent<ToWorker>) => core.handle(e.data);

// Laço do relógio, independente dos quadros da tela.
const STEP_MS = 1000 / 60;
let last = performance.now();
const loop = (): void => {
  const now = performance.now();
  core.advance((now - last) / 1000);
  last = now;
  setTimeout(loop, STEP_MS);
};
setTimeout(loop, STEP_MS);
