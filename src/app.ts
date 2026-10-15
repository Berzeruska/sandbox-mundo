import { quatFromAxisAngle, quatMultiply, quatNormalize } from './core/quat';
import { Clock, formatDate, type Speed } from './core/time';
import { PaintGate } from './input/paint-gate';
import { PointerInput, type InputMode, type PaintPhase } from './input/pointer';
import { Tool } from './input/tools';
import { DEFAULT_PLATE_RATE } from './world/tectonics';
import { Camera } from './render/camera';
import { GlobeRenderer } from './render/globe-renderer';
import { Overlay } from './render/overlay';
import { SimClient } from './sim/client';
import { applyPatch, type Patch, type WorldInfo } from './sim/protocol';
import { Hud } from './ui/hud';
import { activeBrush, inputModeOf } from './ui/menu-state';
import { DebugPanel, NewWorldDialog } from './ui/panels';

/** Resolução padrão da face do planeta (ver docs/01-arquitetura.md). */
export const DEFAULT_N = 256;
const MAX_PIXEL_RATIO = 2;
const DEFAULT_BRUSH = 6;

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
  private loadingEl: HTMLDivElement;
  private loadingText: HTMLDivElement;
  private loadingFill: HTMLDivElement;
  private lastRunningSpeed: Speed = 1;
  /** Giro contínuo para medir fps (redesenha todo quadro). */
  private stressSpin = false;
  private stats = {
    frames: 0, workMs: 0, since: 0, fps: 0, frameMs: 0, brushMs: 0, ticksPerSecond: 0,
    minGap: Infinity, maxGap: 0, lastMinGap: 0, lastMaxGap: 0, prevTime: 0, geologyMs: 0, recompositions: 0,
  };
  /** Momento do pedido de mundo novo, para medir o tempo total até o globo aparecer. */
  private worldRequestedAt = 0;
  private worldTotalMs = 0;
  private needsDraw = true;
  private lastTime = 0;
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
        onPlateRate: (percent) => this.sim.setPlateRate(percent / 100),
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
    this.debug = new DebugPanel(this.hud.root, () => {
      this.stressSpin = !this.stressSpin;
      this.debug.setSpinning(this.stressSpin);
    });
    this.worldDialog = new NewWorldDialog(this.hud.root, (text) => this.newWorld(text));
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
      onWorld: (info, colors) => this.onWorld(info, colors),
      onProgress: (stage, fraction) => this.showProgress(stage, fraction),
      onPatch: (patches, brushMs) => this.onPatch(patches, brushMs),
      onClock: (tick, speed, ticksPerSecond, geologyMs, recompositions) => {
        this.clock.tick = tick;
        this.stats.ticksPerSecond = ticksPerSecond;
        this.stats.geologyMs = geologyMs;
        this.stats.recompositions = recompositions;
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
    this.sim.newWorld(seedText, DEFAULT_N);
  }

  /** Barra de progresso da geração (a etapa pesada, o terreno, avisa várias vezes). */
  private showProgress(stage: string, fraction: number): void {
    const pct = Math.round(fraction * 100);
    this.loadingText.textContent = stage ? `Gerando mundo… ${pct}% (${stage})` : 'Gerando mundo…';
    this.loadingFill.style.width = `${pct}%`;
  }

  private onWorld(info: WorldInfo, colors: Uint8Array): void {
    this.worldTotalMs = performance.now() - this.worldRequestedAt;
    this.info = info;
    this.colors = colors;
    if (!this.renderer) this.renderer = new GlobeRenderer(this.canvas, info.n, colors);
    else this.renderer.setWorld(info.n, colors);
    this.camera.setCellAngle(Math.PI / 2 / info.n);
    this.camera.stopSpin();
    this.camera.zoom = 1;
    this.camera.lookAt(info.landCenter);
    setSeedInUrl(info.seedText);
    this.loadingEl.hidden = true;
    this.updateDebug();
    this.requestDraw();
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
    const gate = this.paintGate.frame(performance.now());
    if (gate !== 'none') this.applyBrushAtScreen(gate === 'first' ? 1 / 20 : dt);

    if (this.stressSpin) {
      const r = quatFromAxisAngle([0, 1, 0], dt * 0.6);
      this.camera.setOrientation(quatNormalize(quatMultiply(this.camera.orientation, r)));
      this.needsDraw = true;
    }

    if (this.needsDraw) {
      renderer.draw(this.camera);
      this.drawOverlay();
      this.needsDraw = false;
    }
    this.measure(time, performance.now() - workStart);
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
    if (!this.debug.visible || !this.info) return;
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
    });
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

/** Guarda a semente na URL: o link compartilhado abre o mesmo mundo. */
export function setSeedInUrl(seedText: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seedText);
  window.history.replaceState(null, '', url);
}
