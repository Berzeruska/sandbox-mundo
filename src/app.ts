import { quatFromAxisAngle, quatMultiply, quatNormalize } from './core/quat';
import { Clock, formatDate, type Speed } from './core/time';
import { PaintGate } from './input/paint-gate';
import { PointerInput, type InputMode, type PaintPhase } from './input/pointer';
import { Tool } from './input/tools';
import { DEFAULT_PLATE_RATE, MAX_PLATE_RATE, RIDGE_DEPTH } from './world/tectonics';
import { extrapolateAngle, MAX_SHADER_PLATES, rotate } from './render/plate-motion';
import type { PlateMotionUniforms } from './render/globe-renderer';
import { BIOME_INFO, Biome } from './world/biomes';
import { BASE_TICKS_PER_SECOND } from './core/time';
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
    received: [] as number[],
    receivedAt: 0,
    shown: [] as number[],
    uniforms: {
      moving: false,
      axis: new Float32Array(MAX_SHADER_PLATES * 4),
      center: new Float32Array(MAX_SHADER_PLATES * 3),
      total: new Float32Array(MAX_SHADER_PLATES * 2),
      base: new Float32Array(MAX_SHADER_PLATES * 2),
      basePrev: new Float32Array(MAX_SHADER_PLATES * 2),
      fade: 1,
      maxDelta: 0,
    } as PlateMotionUniforms,
    /** Ângulos da composição anterior e início da transição suave (ms). */
    prevAngles: [] as number[],
    fadeStart: 0,
  };
  private loadingEl: HTMLDivElement;
  private loadingText: HTMLDivElement;
  private loadingFill: HTMLDivElement;
  private lastRunningSpeed: Speed = 1;
  /** Giro contínuo para medir fps (redesenha todo quadro). */
  private stressSpin = false;
  private stats = {
    frames: 0, workMs: 0, since: 0, fps: 0, frameMs: 0, brushMs: 0, ticksPerSecond: 0,
    minGap: Infinity, maxGap: 0, lastMinGap: 0, lastMaxGap: 0, prevTime: 0, geologyMs: 0, recompositions: 0, memoryMb: 0,
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
        onPlateRate: (percent) => {
          this.plateRate = percent / 100;
          this.sim.setPlateRate(this.plateRate);
        },
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
      onWorld: (info, colors, plateCells) => this.onWorld(info, colors, plateCells),
      onRecomposed: (patches, plateCells, angles) => this.onRecomposed(patches, plateCells, angles),
      onProgress: (stage, fraction) => this.showProgress(stage, fraction),
      onPatch: (patches, brushMs) => this.onPatch(patches, brushMs),
      onClock: (tick, speed, ticksPerSecond, geologyMs, recompositions, memoryMb, angles) => {
        this.stats.memoryMb = memoryMb;
        if (angles.length) {
          this.motion.received = angles;
          this.motion.receivedAt = performance.now();
        }
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

  private onWorld(info: WorldInfo, colors: Uint8Array, plateCells: Uint8Array): void {
    this.worldTotalMs = performance.now() - this.worldRequestedAt;
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
  }

  /** As placas andaram: textura nova composta nos ângulos `angles`; o desenho suave continua dali. */
  private onRecomposed(patches: Patch[], plateCells: Uint8Array, angles: number[]): void {
    if (!this.info || !this.renderer) return;
    for (const p of patches) applyPatch(this.colors, this.info.n, p);
    // A composição atual vira a anterior e as duas se misturam por FADE_MS (sem salto na troca).
    this.renderer.recomposed(plateCells);
    this.motion.prevAngles = this.motion.baseAngles;
    this.motion.baseAngles = angles;
    this.motion.fadeStart = performance.now();
    this.requestDraw();
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
    const since = (performance.now() - m.receivedAt) / 1000;
    const u = m.uniforms;
    let changed = false;
    let maxDelta = 0;
    for (let k = 0; k < info.plates.length; k++) {
      const rate = MAX_PLATE_RATE * this.plateRate * (info.plates[k]?.speed ?? 0) * ticksPerSecond;
      const shown = extrapolateAngle(m.received[k] ?? 0, rate, since, m.shown[k] ?? 0);
      if (shown !== m.shown[k]) changed = true;
      m.shown[k] = shown;
      const base = m.baseAngles[k] ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(shown - base));
      u.total[k * 2] = Math.cos(shown);
      u.total[k * 2 + 1] = Math.sin(shown);
      const plate = info.plates[k];
      if (plate) u.center.set(rotate(plate.center, plate.axis, shown), k * 3);
      u.base[k * 2] = Math.cos(base);
      u.base[k * 2 + 1] = Math.sin(base);
      const prev = m.prevAngles[k] ?? base;
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
      memoryMb: this.stats.memoryMb,
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
