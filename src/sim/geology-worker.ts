/// <reference lib="webworker" />
import { enableSharedMemory } from '../core/shared';
import { adoptShadeWeights } from '../render/colors';
import { adoptUpwindTable } from '../world/climate';
import { CubeSphere } from '../world/cubesphere';
import { GeologyEngine, type GeologyEvent, type HelperReply, type HelperRequest } from './geology';

/**
 * Ajudante 2 "Terra" (correção 2): só liga o motor da geologia às mensagens do relógio (o worker da
 * simulação). Toda a lógica está em `geology.ts`, testada sem worker. Criado pelo worker do relógio,
 * só quando a página tem memória compartilhada.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
enableSharedMemory(true);

let engine: GeologyEngine | null = null;
let grid: CubeSphere | null = null;

function reply(msg: HelperReply, transfer: ArrayBuffer[] = []): void {
  scope.postMessage(msg, transfer);
}

function report(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  reply(stack ? { type: 'error', message: `Ajudante da geologia: ${message}`, stack } : { type: 'error', message: `Ajudante da geologia: ${message}` });
}

scope.onmessage = (e: MessageEvent<HelperRequest>) => {
  try {
    const msg = e.data;
    if (msg.type === 'init') {
      // A grade vem do relógio, em memória compartilhada: uma só para os dois ajudantes.
      if (!grid || grid.positions !== msg.grid.positions) {
        grid = new CubeSphere(msg.grid.n, msg.grid);
        adoptUpwindTable(grid, msg.upwind);
        adoptShadeWeights(grid, msg.shade);
      }
      engine = new GeologyEngine(msg.init, grid, (event: GeologyEvent, transfer?: ArrayBuffer[]) => reply(event, transfer));
      reply({ type: 'ready', buffers: engine.buffers });
      return;
    }
    engine?.receive(msg.cmd);
  } catch (err) {
    report(err);
  }
};
scope.onerror = (e) => report(e instanceof ErrorEvent ? (e.error ?? e.message) : e);
scope.onunhandledrejection = (e) => report(e.reason);
