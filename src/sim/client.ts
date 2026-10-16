import type { Speed } from '../core/time';
import type { Tool } from '../input/tools';
import type { Layers } from '../render/colors';
import type { Vec3 } from '../world/cubesphere';
import type { WorkCounters } from '../ui/benchmark';
import { SHARED_PROBE_VALUE, sharedMemoryLabel, type CellQuery, type FromWorker, type Patch, type PlateMotionInfo, type ToWorker, type WorldInfo } from './protocol';

export interface SimEvents {
  onWorld(info: WorldInfo, colors: Uint8Array, plateCells: Uint8Array): void;
  onRecomposed(patches: Patch[], plateCells: Uint8Array, angles: number[], plates: PlateMotionInfo[]): void;
  onProgress(stage: string, fraction: number): void;
  onPatch(patches: Patch[], brushMs: number): void;
  /** Erro no worker, no protocolo ou versão diferente (`versionMismatch`). */
  onError(message: string, versionMismatch?: boolean): void;
  /** Qualquer mensagem do worker (para o vigia de "sem resposta"). */
  onAlive?(): void;
  onClock(tick: number, speed: Speed, ticksPerSecond: number, geologyMs: number, memoryMb: number, angles: number[], work: WorkCounters): void;
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
  private sharedBuffer: SharedArrayBuffer | null = null;
  private sharedProbe: boolean | null = null;

  constructor(private events: SimEvents) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      this.events.onAlive?.();
      try {
        this.receive(e.data);
      } catch (err) {
        // Erro na tela ao tratar uma mensagem (ex.: a GPU recusou o desenho): aparece, não trava.
        this.events.onError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      }
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.events.onError(`Erro ao carregar ou rodar o simulador: ${e.message || 'sem detalhes'}`);
    };
    this.worker.onmessageerror = () => this.events.onError('Mensagem do simulador ilegível (versões diferentes?)', true);
    this.probeSharedMemory();
  }

  /**
   * Teste de portão da correção 2: a tela e o worker conseguem usar a mesma memória? Só com a página
   * isolada entre origens (cabeçalhos postos pelo service worker) o navegador libera isso.
   */
  private probeSharedMemory(): void {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return;
    this.sharedBuffer = new SharedArrayBuffer(4);
    this.send({ type: 'sharedProbe', buffer: this.sharedBuffer });
  }

  /** "sim", "não (motivo)" ou "testando…", para o painel Dados e o relatório. */
  get sharedMemory(): string {
    return sharedMemoryLabel(globalThis.crossOriginIsolated === true, typeof SharedArrayBuffer !== 'undefined', this.sharedProbe);
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

  forceRupture(): void {
    this.send({ type: 'forceRupture' });
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
      case 'hello':
        if (msg.version !== __BUILD_ID__) {
          this.events.onError(`Versões diferentes: tela ${__BUILD_ID__}, simulador ${msg.version}`, true);
        }
        break;
      case 'error':
        this.events.onError(msg.stack?.includes(msg.message) ? msg.stack : msg.message + (msg.stack ? `\n\n${msg.stack}` : ''));
        break;
      case 'world':
        this.brushInFlight = false;
        this.events.onWorld(msg.info, msg.colors, msg.plateCells);
        break;
      case 'recomposed':
        this.events.onRecomposed(msg.patches, msg.plateCells, msg.angles, msg.plates);
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
        this.events.onClock(msg.tick, msg.speed, msg.ticksPerSecond, msg.geologyMs, msg.memoryMb, msg.angles, msg.work);
        break;
      case 'query':
        this.queries.get(msg.id)?.(msg.cell);
        this.queries.delete(msg.id);
        break;
      case 'sharedProbe':
        this.sharedProbe = msg.ok && !!this.sharedBuffer && Atomics.load(new Int32Array(this.sharedBuffer), 0) === SHARED_PROBE_VALUE;
        break;
    }
  }
}
