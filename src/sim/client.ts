import type { Speed } from '../core/time';
import type { Tool } from '../input/tools';
import type { Layers } from '../render/colors';
import type { Vec3 } from '../world/cubesphere';
import type { CellQuery, FromWorker, Patch, ToWorker, WorldInfo } from './protocol';

export interface SimEvents {
  onWorld(info: WorldInfo, colors: Uint8Array): void;
  onProgress(stage: string, fraction: number): void;
  onPatch(patches: Patch[], brushMs: number): void;
  onClock(tick: number, speed: Speed, ticksPerSecond: number, geologyMs: number, recompositions: number): void;
}

/**
 * Lado da thread principal: cria o worker, manda comandos e entrega as respostas.
 * Pinceladas são agrupadas: enquanto o worker processa uma, as seguintes acumulam o tempo e a
 * posição mais recente, para nunca formar fila (a tela segue fluida com pincel grande).
 */
export class SimClient {
  private worker: Worker;
  private brushInFlight = false;
  private pendingBrush: { tool: Tool; point: Vec3; radius: number; dt: number } | null = null;
  private queries = new Map<number, (cell: CellQuery) => void>();
  private nextQuery = 1;

  constructor(private events: SimEvents) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  newWorld(seedText: string, n: number): void {
    this.pendingBrush = null;
    this.send({ type: 'newWorld', seedText, n });
  }

  /** Controle "Placas": 0 congela a geologia, 1 é o máximo. */
  setPlateRate(rate: number): void {
    this.send({ type: 'plateRate', rate });
  }

  setLayers(layers: Layers): void {
    this.send({ type: 'layers', layers });
  }

  setSpeed(speed: Speed): void {
    this.send({ type: 'speed', speed });
  }

  brush(tool: Tool, point: Vec3, radius: number, dt: number): void {
    if (this.brushInFlight) {
      const prev = this.pendingBrush;
      this.pendingBrush = { tool, point, radius, dt: (prev && prev.tool === tool ? prev.dt : 0) + dt };
      return;
    }
    this.brushInFlight = true;
    this.send({ type: 'brush', tool, point, radius, dt });
  }

  /** Pergunta ao worker o que há num ponto do planeta (usado pela depuração e pelos testes). */
  query(point: Vec3): Promise<CellQuery> {
    const id = this.nextQuery++;
    return new Promise((resolve) => {
      this.queries.set(id, resolve);
      this.send({ type: 'query', id, point });
    });
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'world':
        this.brushInFlight = false;
        this.events.onWorld(msg.info, msg.colors);
        break;
      case 'progress':
        this.events.onProgress(msg.stage, msg.fraction);
        break;
      case 'patch':
        this.events.onPatch(msg.patches, msg.brushMs);
        // Só a resposta de uma pincelada libera a próxima (repintura de camada tem brushMs < 0).
        if (msg.brushMs < 0) break;
        this.brushInFlight = false;
        if (this.pendingBrush) {
          const b = this.pendingBrush;
          this.pendingBrush = null;
          this.brush(b.tool, b.point, b.radius, b.dt);
        }
        break;
      case 'clock':
        this.events.onClock(msg.tick, msg.speed, msg.ticksPerSecond, msg.geologyMs, msg.recompositions);
        break;
      case 'query':
        this.queries.get(msg.id)?.(msg.cell);
        this.queries.delete(msg.id);
        break;
    }
  }
}
