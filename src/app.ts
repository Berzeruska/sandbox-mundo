import { quatFromAxisAngle, quatMultiply, quatNormalize } from './core/quat';
import { Clock, formatDate, type Speed } from './core/time';
import { PaintGate } from './input/paint-gate';
import { PointerInput, type InputMode, type PaintPhase } from './input/pointer';
import { Tool } from './input/tools';
import { DEFAULT_PLATE_RATE, MAX_PLATE_RATE, RIDGE_DEPTH } from './world/tectonics';
import { advanceDisplayTick, MAX_SHADER_PLATES, rotate } from './render/plate-motion';
import type { PlateMotionUniforms } from './render/globe-renderer';
import { BIOME_INFO, Biome } from './world/biomes';
import { BASE_TICKS_PER_SECOND } from './core/time';
import { Camera } from './render/camera';
import { GlobeRenderer } from './render/globe-renderer';
import { Overlay } from './render/overlay';
import { SimClient } from './sim/client';
import { applyPatch, type Patch, type PlateMotionInfo, type WorldInfo } from './sim/protocol';
import { Hud } from './ui/hud';
import { activeBrush, inputModeOf } from './ui/menu-state';
import { DebugPanel, NewWorldDialog, type PanelMode } from './ui/panels';
import { ErrorScreen } from './ui/error-screen';
import { emptyWork, FrameRecorder, formatReport, workDelta, type FirstLoad, type GenerationResult, type ScenarioResult, type WorkCounters } from './ui/benchmark';

/** Resolução padrão da face do planeta (ver docs/01-arquitetura.md). */
export const DEFAULT_N = 256;
const MAX_PIXEL_RATIO = 2;
const DEFAULT_BRUSH = 6;
/** Sem nenhuma notícia da geração por este tempo (ms), mostra erro em vez de esperar para sempre. */
const GENERATION_WATCHDOG_MS = 20_000;
/** Chave da recarga automática por versão diferente (evita recarregar em laço). */
const VERSION_RELOAD_KEY = 'sandbox-mundo:recarga-por-versao';
/** Duração da transição suave entre a composição anterior e a nova (ms). */
const FADE_MS = 350;

/**
 * Thread principal: câmera, entrada, interface e desenho. O mundo vive no Web Worker
 * (`src/sim/`); aqui fica só uma cópia das cores para a textura, atualizada por remendos.
 */
export class App {
  readonly camera = new Camera();
  readonly overlay: Overlay;
  readonly input: PointerInput;
  readonly hud: Hud;
  readonly sim: SimClient;
  readonly debug: DebugPanel;
  readonly worldDialog: NewWorldDialog;
  /** Cópia do relógio do worker, só para mostrar a data. */
  readonly clock = new Clock();
  renderer: GlobeRenderer | null = null;
  info: WorldInfo | null = null;
  colors: Uint8Array = new Uint8Array(0);
  mode: InputMode = 'move';
  tool: Tool = Tool.Raise;
  brushSize = DEFAULT_BRUSH;
  private canvas: HTMLCanvasElement;
  /** Controle "Placas" (0 a 1), espelho do que foi mandado ao worker. */
  private plateRate = DEFAULT_PLATE_RATE;
  /** Movimento das placas para o desenho suave: ângulos da composição, recebidos e mostrados. */
  private motion = {
    baseAngles: [] as number[],
    /** Último relógio do worker: passo, quando chegou e ângulos naquele passo. */
    received: [] as number[],
    receivedTick: 0,
    receivedAt: 0,
    /** Relógio do desenho (passos fracionários) e ângulos mostrados. */
    displayTick: 0,
    shown: [] as number[],
    uniforms: {
      moving: false,
      axis: new Float32Array(MAX_SHADER_PLATES * 4),
      center: new Float32Array(MAX_SHADER_PLATES * 3),
      total: new Float32Array(MAX_SHADER_PLATES * 2),
      base: new Float32Array(MAX_SHADER_PLATES * 2),
      basePrev: new Float32Array(MAX_SHADER_PLATES * 2),
      fade: 1,
      maxDeltaPrev: 0,
      maxDelta: 0,
    } as PlateMotionUniforms,
    /** Ângulos da composição anterior e início da transição suave (ms). */
    prevAngles: [] as number[],
    fadeStart: 0,
  };
  private loadingEl: HTMLDivElement;
  private errorScreen: ErrorScreen;
  /** Último sinal de vida da geração (pedido, progresso ou mundo pronto), para o vigia. */
  private lastGenerationSignal = 0;
  private loadingText: HTMLDivElement;
  private loadingFill: HTMLDivElement;
  private lastRunningSpeed: Speed = 1;
  /** Giro contínuo para medir fps (redesenha todo quadro). */
  private stressSpin = false;
  private stats = {
    frames: 0, workMs: 0, since: 0, fps: 0, frameMs: 0, brushMs: 0, ticksPerSecond: 0,
    minGap: Infinity, maxGap: 0, lastMinGap: 0, lastMaxGap: 0, prevTime: 0, geologyMs: 0, recompositions: 0, memoryMb: 0,
  };
  /** "Medir desempenho": quadros do cenário em andamento, recomposições recebidas e o mundo novo. */
  private bench: {
    recorder: FrameRecorder | null;
    receive: number[];
    onWorld: ((receiveMs: number) => void) | null;
    /** Cenário com o painel Dados aberto (ele se atualiza como no jogo normal). */
    panelOpen: boolean;
  } | null = null;
  /** Primeira abertura: da navegação até o primeiro globo na tela (ms), e a geração dentro disso. */
  private firstLoad: FirstLoad | null = null;
  /** Últimos contadores de trabalho do worker (chegam com o relógio). */
  private work: WorkCounters = emptyWork();
  /** Momento do pedido de mundo novo, para medir o tempo total até o globo aparecer. */
  private worldRequestedAt = 0;
  private worldTotalMs = 0;
  private needsDraw = true;
  private lastTime = 0;
  /** Duração do último quadro (s), para o relógio do desenho. */
  private frameDt = 0;
  /** Posição do pincel na tela (mouse por cima ou dedo pintando), ou null. */
  private brushScreen: { x: number; y: number } | null = null;
  /** Decide quando o toque vira pincelada (espera o segundo dedo de uma pinça). */
  private paintGate = new PaintGate();

  constructor(root: HTMLElement, seedText: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'globe';
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'overlay';
    root.append(this.canvas, overlayCanvas);
    this.overlay = new Overlay(overlayCanvas);

    this.input = new PointerInput(this.canvas, this.camera, {
      getMode: () => this.mode,
      onCameraChange: () => this.requestDraw(),
      onPaint: (sx, sy, phase) => this.onPaint(sx, sy, phase),
      onHover: (sx, sy) => {
        this.brushScreen = { x: sx, y: sy };
        if (this.mode === 'paint') this.requestDraw();
      },
      onLeave: () => {
        this.brushScreen = null;
        this.requestDraw();
      },
    });

    this.hud = new Hud(
      root,
      {
        onMenuChange: (state) => {
          const brush = activeBrush(state);
          if (brush !== null) this.tool = brush;
          this.setMode(inputModeOf(state));
        },
        onBrushSize: (size) => {
          this.brushSize = size;
          this.requestDraw();
        },
        onPlateRate: (percent) => this.setPlateRate(percent / 100),
        onSpeed: (speed) => this.setSpeed(speed),
        onTogglePause: () => this.togglePause(),
        onAction: (action) => {
          if (action === 'newWorld') this.worldDialog.show(this.info?.seedText ?? '');
          if (action === 'debug') {
            this.debug.toggle();
            this.updateDebug();
          }
        },
        onToggle: (id, on) => {
          if (id === 'platesLayer') this.sim.setLayers({ plates: on });
        },
        onNorthUp: () => {
          this.camera.stopSpin();
          this.camera.northUp();
          this.requestDraw();
        },
      },
      this.brushSize,
      Math.round(DEFAULT_PLATE_RATE * 100),
    );
    this.debug = new DebugPanel(
      this.hud.root,
      () => {
        this.stressSpin = !this.stressSpin;
        this.debug.setSpinning(this.stressSpin);
      },
      () => void this.runBenchmark(),
    );
    this.worldDialog = new NewWorldDialog(this.hud.root, (text) => this.newWorld(text));
    this.errorScreen = new ErrorScreen(root, () => void retry());
    // Erros não tratados em qualquer parte da tela também aparecem (em vez de travar em silêncio).
    window.addEventListener('error', (e) => this.fail(`${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`));
    window.addEventListener('unhandledrejection', (e) => this.fail(`Promessa rejeitada: ${String(e.reason)}`));
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'loading';
    this.loadingText = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    this.loadingFill = document.createElement('div');
    bar.append(this.loadingFill);
    this.loadingEl.append(this.loadingText, bar);
    root.append(this.loadingEl);
    this.hud.setSpeed(this.clock.speed);
    this.hud.setDate(formatDate(this.clock));

    // Notebook: barra de espaço pausa e retoma (sem "clicar" no botão que estiver com foco).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (!e.repeat) this.togglePause();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    });

    this.sim = new SimClient({
      onError: (message, versionMismatch) => this.fail(message, versionMismatch),
      onWorld: (info, colors, plateCells) => this.onWorld(info, colors, plateCells),
      onRecomposed: (patches, plateCells, angles, plates) => this.onRecomposed(patches, plateCells, angles, plates),
      onProgress: (stage, fraction) => {
        this.lastGenerationSignal = performance.now();
        this.showProgress(stage, fraction);
      },
      onPatch: (patches, brushMs) => this.onPatch(patches, brushMs),
      onClock: (tick, speed, ticksPerSecond, geologyMs, memoryMb, angles, work) => {
        this.stats.memoryMb = memoryMb;
        this.work = work;
        if (angles.length) {
          this.motion.received = angles;
          this.motion.receivedTick = tick;
          this.motion.receivedAt = performance.now();
        }
        this.clock.tick = tick;
        this.stats.ticksPerSecond = ticksPerSecond;
        this.stats.geologyMs = geologyMs;
        this.stats.recompositions = work.recompositions;
        if (speed !== this.clock.speed) {
          this.clock.speed = speed;
          this.hud.setSpeed(speed);
        }
        this.hud.setDate(formatDate(this.clock));
      },
    });
    this.newWorld(seedText);
  }

  /** Pede ao worker outro planeta. O globo atual continua na tela (e girável) enquanto ele nasce. */
  newWorld(seedText: string): void {
    this.showProgress('', 0);
    this.loadingEl.hidden = false;
    this.worldRequestedAt = performance.now();
    this.lastGenerationSignal = this.worldRequestedAt;
    this.sim.newWorld(seedText, DEFAULT_N);
  }

  /**
   * Algo deu errado: mostra o texto e "tentar de novo" em vez de travar. Versão diferente entre tela
   * e worker (cache antigo) recarrega sozinha uma vez, limpando o cache.
   */
  fail(message: string, versionMismatch = false): void {
    console.error(message);
    if (versionMismatch) {
      let recent: boolean;
      try {
        recent = Date.now() - Number(sessionStorage.getItem(VERSION_RELOAD_KEY) ?? 0) < 60_000;
        if (!recent) sessionStorage.setItem(VERSION_RELOAD_KEY, String(Date.now()));
      } catch {
        recent = true; // sem sessionStorage: não arrisca recarregar em laço
      }
      if (!recent) {
        void retry();
        return;
      }
    }
    this.loadingEl.hidden = true;
    this.errorScreen.show(`${message}\n\nversão ${__BUILD_ID__} · ${navigator.userAgent}`);
  }

  /** Barra de progresso da geração (a etapa pesada, o terreno, avisa várias vezes). */
  private showProgress(stage: string, fraction: number): void {
    const pct = Math.round(fraction * 100);
    this.loadingText.textContent = stage ? `Gerando mundo… ${pct}% (${stage})` : 'Gerando mundo…';
    this.loadingFill.style.width = `${pct}%`;
  }

  private onWorld(info: WorldInfo, colors: Uint8Array, plateCells: Uint8Array): void {
    const receiveStart = performance.now();
    this.worldTotalMs = receiveStart - this.worldRequestedAt;
    this.firstLoad ??= { pageToGlobeMs: receiveStart, requestToGlobeMs: this.worldTotalMs, workerMs: info.generationMs, stagesMs: info.stagesMs };
    this.lastGenerationSignal = performance.now();
    this.info = info;
    this.colors = colors;
    if (!this.renderer) this.renderer = new GlobeRenderer(this.canvas, info.n, colors);
    else this.renderer.setWorld(info.n, colors);
    this.renderer.setPlates(plateCells);
    this.renderer.ridgeColor = ridgeColor();
    // Mundo novo: placas nos ângulos 0.
    const zeros = info.plates.map(() => 0);
    this.motion.baseAngles = zeros;
    this.motion.prevAngles = [...zeros];
    this.motion.fadeStart = 0;
    this.motion.received = [...zeros];
    this.motion.receivedTick = 0;
    this.motion.displayTick = 0;
    this.motion.shown = [...zeros];
    const u = this.motion.uniforms;
    u.axis.fill(0);
    info.plates.forEach((p, k) => u.axis.set([...p.axis, p.speed], k * 4));
    this.camera.setCellAngle(Math.PI / 2 / info.n);
    this.camera.stopSpin();
    this.camera.zoom = 1;
    this.camera.lookAt(info.landCenter);
    setSeedInUrl(info.seedText);
    this.loadingEl.hidden = true;
    this.updateDebug();
    this.requestDraw();
    const bench = this.bench;
    const done = bench?.onWorld;
    if (bench && done) {
      bench.onWorld = null;
      done(performance.now() - receiveStart);
    }
  }

  /** As placas andaram: textura nova composta nos ângulos `angles`; o desenho suave continua dali. */
  private onRecomposed(patches: Patch[], plateCells: Uint8Array, angles: number[], plates: PlateMotionInfo[]): void {
    if (!this.info || !this.renderer) return;
    // Eixo, velocidade e centro de cada placa nesta composição (o eixo muda quando placas se soldam).
    this.info.plates = plates;
    const u = this.motion.uniforms;
    plates.forEach((p, k) => u.axis.set([...p.axis, p.speed], k * 4));
    const receiveStart = performance.now();
    for (const p of patches) applyPatch(this.colors, this.info.n, p);
    // A composição atual vira a anterior e as duas se misturam por FADE_MS (sem salto na troca).
    this.renderer.recomposed(plateCells);
    this.motion.prevAngles = this.motion.baseAngles;
    this.motion.baseAngles = angles;
    this.motion.fadeStart = performance.now();
    this.requestDraw();
    this.bench?.receive.push(performance.now() - receiveStart);
  }

  /**
   * Ângulos a mostrar neste quadro (adiantando o último recebido pelo tempo) e uniformes do shader.
   * Retorna true se algo mudou e precisa redesenhar.
   */
  private updateMotion(): boolean {
    const m = this.motion;
    const info = this.info;
    if (!info || !m.received.length) return false;
    const speed = this.clock.speed;
    const ticksPerSecond = speed === 0 ? 0 : speed === 'max' ? this.stats.ticksPerSecond : BASE_TICKS_PER_SECOND * speed;
    const now = performance.now();
    const since = Math.min(2, (now - m.receivedAt) / 1000);
    // Passo estimado do worker agora, e o relógio do desenho seguindo ele sem saltos.
    const target = m.receivedTick + since * ticksPerSecond;
    m.displayTick = advanceDisplayTick(m.displayTick, target, ticksPerSecond, this.frameDt);
    const u = m.uniforms;
    let changed = false;
    let maxDelta = 0;
    let maxDeltaPrev = 0;
    for (let k = 0; k < info.plates.length; k++) {
      // Ângulo é linear nos passos: o do último relógio + a taxa × (passo do desenho − passo recebido).
      const ratePerTick = MAX_PLATE_RATE * this.plateRate * (info.plates[k]?.speed ?? 0);
      const shown = (m.received[k] ?? 0) + ratePerTick * (m.displayTick - m.receivedTick);
      if (shown !== m.shown[k]) changed = true;
      m.shown[k] = shown;
      const base = m.baseAngles[k] ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(shown - base));
      u.total[k * 2] = Math.cos(shown);
      u.total[k * 2 + 1] = Math.sin(shown);
      const plate = info.plates[k];
      // Centro na composição base, girado pelo que a placa andou desde então.
      if (plate) u.center.set(rotate(plate.center, plate.axis, shown - base), k * 3);
      u.base[k * 2] = Math.cos(base);
      u.base[k * 2 + 1] = Math.sin(base);
      const prev = m.prevAngles[k] ?? base;
      maxDeltaPrev = Math.max(maxDeltaPrev, Math.abs(shown - prev));
      u.basePrev[k * 2] = Math.cos(prev);
      u.basePrev[k * 2 + 1] = Math.sin(prev);
    }
    const fade = Math.min(1, (performance.now() - m.fadeStart) / FADE_MS);
    if (fade !== u.fade) changed = true;
    u.fade = fade;
    const moving = maxDelta > 1e-7 || fade < 1;
    if (moving !== u.moving) changed = true;
    u.moving = moving;
    u.maxDelta = maxDelta;
    u.maxDeltaPrev = maxDeltaPrev;
    return changed;
  }

  private onPatch(patches: Patch[], brushMs: number): void {
    if (!this.info || !this.renderer) return;
    for (const p of patches) applyPatch(this.colors, this.info.n, p);
    this.renderer.upload(patches);
    if (brushMs >= 0) this.stats.brushMs = brushMs;
    this.requestDraw();
  }

  /** Pausa, ou retoma na última velocidade usada. */
  togglePause(): void {
    this.setSpeed(this.clock.speed === 0 ? this.lastRunningSpeed : 0);
  }

  setSpeed(speed: Speed): void {
    if (speed !== 0) this.lastRunningSpeed = speed;
    this.clock.speed = speed;
    this.hud.setSpeed(speed);
    this.sim.setSpeed(speed);
  }

  /** Controle "Placas" (0 a 1): a tela guarda uma cópia para o desenho suave do movimento. */
  setPlateRate(rate: number): void {
    this.plateRate = rate;
    this.sim.setPlateRate(rate);
    this.requestDraw();
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    this.paintGate.cancel();
    this.requestDraw();
  }

  requestDraw(): void {
    this.needsDraw = true;
  }

  private onPaint(sx: number, sy: number, phase: PaintPhase): void {
    this.brushScreen = { x: sx, y: sy };
    if (phase === 'start') this.paintGate.start(performance.now());
    else if (phase === 'cancel') this.paintGate.cancel();
    // Toque rápido (soltou antes da espera): aplica uma vez, com efeito visível.
    else if (phase === 'end' && this.paintGate.end()) this.applyBrushAtScreen(1 / 20);
    this.requestDraw();
  }

  private applyBrushAtScreen(dt: number): void {
    if (!this.brushScreen || !this.info) return;
    const p = this.camera.pick(this.brushScreen.x, this.brushScreen.y);
    if (p) this.sim.brush(this.tool, p, this.brushSize, dt);
  }

  /** Um quadro: ajusta tamanho, avança animações e pincel, e desenha se algo mudou. */
  frame(time: number): void {
    const workStart = performance.now();
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    this.frameDt = dt;
    // Vigia: geração sem nenhuma notícia há muito tempo vira erro na tela, nunca espera infinita.
    if (!this.loadingEl.hidden && !this.errorScreen.visible && performance.now() - this.lastGenerationSignal > GENERATION_WATCHDOG_MS) {
      this.fail(`O simulador não deu notícia da geração por ${GENERATION_WATCHDOG_MS / 1000} s (última etapa: "${this.loadingText.textContent}").`);
    }
    const renderer = this.renderer;
    if (!renderer) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (renderer.resize(ratio)) {
      this.camera.setViewport(renderer.canvas.width, renderer.canvas.height);
      this.overlay.resize(renderer.canvas.width, renderer.canvas.height);
      this.needsDraw = true;
    }
    if (this.camera.update(dt)) this.needsDraw = true;
    if (this.input.update(dt)) this.needsDraw = true;
    if (this.updateMotion()) this.needsDraw = true;
    const gate = this.paintGate.frame(performance.now());
    if (gate !== 'none') this.applyBrushAtScreen(gate === 'first' ? 1 / 20 : dt);

    if (this.stressSpin) {
      const r = quatFromAxisAngle([0, 1, 0], dt * 0.6);
      this.camera.setOrientation(quatNormalize(quatMultiply(this.camera.orientation, r)));
      this.needsDraw = true;
    }

    if (this.needsDraw) {
      renderer.draw(this.camera, this.motion.uniforms);
      this.drawOverlay();
      this.needsDraw = false;
    }
    const workMs = performance.now() - workStart;
    this.bench?.recorder?.frame(time, workMs);
    this.measure(time, workMs);
  }

  private measure(time: number, workMs: number): void {
    const st = this.stats;
    // Menor e maior intervalo entre quadros: mostra a taxa que a tela está oferecendo
    // (16,7 ms = 60 Hz; 11,1 ms = 90 Hz; 8,3 ms = 120 Hz).
    if (st.prevTime) {
      const gap = time - st.prevTime;
      st.minGap = Math.min(st.minGap, gap);
      st.maxGap = Math.max(st.maxGap, gap);
    }
    st.prevTime = time;
    st.frames++;
    st.workMs += workMs;
    if (!st.since) st.since = time;
    const elapsed = time - st.since;
    if (elapsed >= 500) {
      st.fps = (st.frames * 1000) / elapsed;
      st.frameMs = st.workMs / st.frames;
      st.lastMinGap = st.minGap === Infinity ? 0 : st.minGap;
      st.lastMaxGap = st.maxGap;
      st.minGap = Infinity;
      st.maxGap = 0;
      st.frames = 0;
      st.workMs = 0;
      st.since = time;
      this.updateDebug();
    }
  }

  private updateDebug(): void {
    if (!this.debug.visible || !this.info || (this.bench && !this.bench.panelOpen)) return;
    const renderer = this.renderer;
    this.debug.update({
      fps: this.stats.fps,
      frameMs: this.stats.frameMs,
      cells: this.info.cellCount,
      n: this.info.n,
      seedText: this.info.seedText,
      seed: this.info.seed,
      generationMs: this.info.generationMs,
      generationTotalMs: this.worldTotalMs,
      stagesMs: this.info.stagesMs,
      minGapMs: this.stats.lastMinGap,
      maxGapMs: this.stats.lastMaxGap,
      zoom: this.camera.zoom,
      cellPixels: this.camera.cellPixels(),
      ticksPerSecond: this.stats.ticksPerSecond,
      brushMs: this.stats.brushMs,
      geologyMs: this.stats.geologyMs,
      recompositions: this.stats.recompositions,
      memoryMb: this.stats.memoryMb,
      drawing: renderer ? (renderer.motionSupported ? 'completo' : `simplificado (${renderer.fallbackReason})`) : '—',
      version: __BUILD_ID__,
    });
  }

  /**
   * "Medir desempenho" (~2 min): roda sozinho os cenários e mostra o relatório para copiar.
   * Globo sempre do mesmo jeito (terra no centro, zoom 1) para comparar uma medição com a outra.
   */
  async runBenchmark(): Promise<void> {
    if (this.bench || !this.info || !this.renderer) return;
    const seedText = this.info.seedText;
    const before = { speed: this.clock.speed, plateRate: this.plateRate, spin: this.stressSpin };
    const bench: NonNullable<App['bench']> = { recorder: null, receive: [], onWorld: null, panelOpen: false };
    this.bench = bench;
    this.hud.closeMenu();
    const startedAt = performance.now();
    const steps = 9;
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const status = (step: number, name: string, panel: PanelMode = 'hidden') =>
      this.debug.setBenchmarkRunning(`Medindo ${step}/${steps}: ${name}… (${Math.round((performance.now() - startedAt) / 1000)} s)`, panel);
    const scenarios: ScenarioResult[] = [];
    // Um cenário: prepara, espera assentar, mede `ms` e guarda quadros + trabalho do worker.
    // `panel`: painel Dados escondido (só a linha de andamento) ou aberto, com ou sem o desfoque antigo.
    const scenario = async (step: number, name: string, ms: number, setup: () => void, panel: PanelMode = 'hidden'): Promise<void> => {
      bench.panelOpen = panel !== 'hidden';
      status(step, name, panel);
      setup();
      this.updateDebug();
      await wait(800);
      const recorder = new FrameRecorder();
      bench.recorder = recorder;
      bench.receive = [];
      const work0 = { ...this.work };
      const timer = setInterval(() => status(step, name, panel), 1000);
      await wait(ms);
      clearInterval(timer);
      const frames = recorder.summary();
      bench.recorder = null;
      const r = bench.receive;
      scenarios.push({
        name,
        frames,
        work: workDelta(work0, this.work),
        receiveAvgMs: r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0,
        receiveMaxMs: r.length ? Math.max(...r) : 0,
      });
    };
    const spin = (on: boolean) => {
      this.stressSpin = on;
      this.debug.setSpinning(on);
    };
    let gen: GenerationResult;
    try {
      this.camera.stopSpin();
      this.camera.zoom = 1;
      this.camera.lookAt(this.info.landCenter);
      await scenario(1, 'pausado, parado', 5000, () => {
        spin(false);
        this.setSpeed(0);
        this.requestDraw();
      });
      await scenario(2, 'pausado, girando', 6000, () => spin(true));
      await scenario(3, 'tempo 20×, placas paradas', 8000, () => {
        spin(false);
        this.setPlateRate(0);
        this.setSpeed(20);
      });
      await scenario(4, '  idem, painel c/ desfoque', 8000, () => undefined, 'blur');
      await scenario(5, 'tempo 20×, placas 100%', 12_000, () => this.setPlateRate(1));
      await scenario(6, '  idem, painel c/ desfoque', 10_000, () => undefined, 'blur');
      await scenario(7, '  idem, painel s/ desfoque', 10_000, () => undefined, 'plain');
      // Deriva longa: continua a mesma deriva por mais 1 min (o planeta passa de ~1,5 min de deriva
      // a 20×, quando os continentes começam a colidir e se soldar).
      await scenario(8, 'deriva longa c/ colisões', 60_000, () => undefined);
      bench.panelOpen = false;
      // Geração: o mesmo mundo de novo (também desfaz a deriva da medição).
      status(9, 'geração de mundo');
      this.setSpeed(0);
      this.setPlateRate(before.plateRate);
      await wait(500);
      const receiveMs = await new Promise<number>((resolve) => {
        bench.onWorld = resolve;
        this.newWorld(seedText);
      });
      const info = this.info as WorldInfo;
      gen = { totalMs: this.worldTotalMs, workerMs: info.generationMs, stagesMs: info.stagesMs, receiveMs };
    } finally {
      spin(before.spin);
      this.setPlateRate(before.plateRate);
      this.setSpeed(before.speed);
      this.bench = null;
      this.debug.setBenchmarkRunning(null);
    }
    const renderer = this.renderer;
    const canvas = this.canvas;
    const report = formatReport(
      {
        version: __BUILD_ID__,
        date: new Date().toLocaleString('pt-BR'),
        gpu: renderer?.gpuName() ?? '—',
        drawing: renderer ? (renderer.motionSupported ? 'completo' : `simplificado (${renderer.fallbackReason})`) : '—',
        cores: navigator.hardwareConcurrency || 0,
        screen: `tela ${screen.width}×${screen.height} @${(window.devicePixelRatio || 1).toFixed(2)} · desenho ${canvas.width}×${canvas.height} · ~${this.stats.lastMinGap > 0 ? Math.round(1000 / this.stats.lastMinGap) : 0} Hz`,
        userAgent: navigator.userAgent,
      },
      scenarios,
      gen,
      this.firstLoad,
    );
    this.debug.showReport(report);
    this.updateDebug();
  }

  private drawOverlay(): void {
    this.overlay.clear();
    if (this.mode !== 'paint' || !this.brushScreen || !this.info) return;
    const p = this.camera.pick(this.brushScreen.x, this.brushScreen.y);
    if (p) this.overlay.drawCap(this.camera, p, this.brushSize * (Math.PI / 2 / this.info.n));
  }

  start(): void {
    const loop = (time: number): void => {
      this.frame(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/** Tentar de novo: limpa o cache do jogo (pode ter versão velha misturada) e recarrega a página. */
async function retry(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((k) => k.startsWith('sandbox-mundo')).map((k) => caches.delete(k)));
  } catch {
    // sem cache para limpar: segue para o recarregamento
  }
  window.location.reload();
}

/** Cor do fundo oceânico recém-nascido (a mesma que o worker pinta na dorsal), de 0 a 1. */
function ridgeColor(): [number, number, number] {
  const c = BIOME_INFO[Biome.DeepOcean]?.color ?? [22, 52, 110];
  const k = 1.12 - 0.42 * Math.min(1, -RIDGE_DEPTH / 5000);
  return [(c[0] * k) / 255, (c[1] * k) / 255, (c[2] * k) / 255];
}

/** Guarda a semente na URL: o link compartilhado abre o mesmo mundo. */
export function setSeedInUrl(seedText: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seedText);
  window.history.replaceState(null, '', url);
}
