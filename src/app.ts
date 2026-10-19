import { isolationReloads } from './ui/isolation';
import { quatFromAxisAngle, quatMultiply, quatNormalize } from './core/quat';
import { Clock, formatDate, type Speed } from './core/time';
import { STALL_KEEP, StallLog } from './ui/stalls';
import { PaintGate, TAP_HOLD_MS } from './input/paint-gate';
import { KeyControls } from './input/keys';
import { DisasterFx } from './render/disaster-fx';
import { isToast, toEntry } from './ui/disaster-log';
import { DisasterToasts } from './ui/disaster-panel';
import { CellState, STATE_NAMES } from './world/disasters/ground';
import { droughtHeat } from './world/disasters/drought';
import { MAX_DUST, MAX_STORMS } from './render/shaders';
import { DEFAULT_FREQUENCY, DisasterKind, FREQUENCIES, type DisasterEvent } from './world/disasters/types';
import { STORM_FLOATS } from './sim/protocol';
import { feltRadius } from './world/disasters/quakes';
import { SHAKE_MAGNITUDE } from './world/disasters/meteor';
import type { Vec3 } from './world/cubesphere';
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
import { BiomeLegend, DepositTip, ResourceLegend } from './ui/resource-legend';
import { BIOME_LAYER_COLORS, NO_LAYERS, STRESS_COLORS, type Layers } from './render/colors';
import { depositLabel, isHiddenOil } from './world/resources';
import { activeBrush, activeDisaster, inputModeOf } from './ui/menu-state';
import { DebugPanel, NewWorldDialog, type PanelMode } from './ui/panels';
import { ErrorScreen } from './ui/error-screen';
import { CYCLE_PHASES, emptyWork, FrameRecorder, formatReport, workDelta, type FirstLoad, type GenerationResult, type GpuSample, type ScenarioResult, type WorkCounters } from './ui/benchmark';

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
/** Duração do voo da câmera até um desastre (ms). */
const FLY_MS = 800;

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
  /** Travadas da tela e da data (painel Dados e relatório). */
  private readonly stalls = new StallLog();
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
  /** Temperatura global (desvio, °C) e nível do mar (m) do mundo mostrado, e o controle do jogador (T7). */
  private climate = { offset: 0, seaLevel: 0 };
  private climateControl = 0;
  /** Camadas ligadas no menu e o filtro da legenda de recursos (T6). */
  private layers: Layers = { ...NO_LAYERS };
  private legend!: ResourceLegend;
  private biomeLegend!: BiomeLegend;
  private stressLegend!: BiomeLegend;
  /** Lista e avisos de desastres (T12) e o voo da câmera até um deles. */
  private toasts!: DisasterToasts;
  private flight: { from: Vec3; to: Vec3; start: number } | null = null;
  /** Ferramenta de desastre ativa (tocar no globo provoca), ou null. */
  private disasterTool: DisasterKind | null = null;
  private tip!: DepositTip;
  /** Onde o dedo encostou (para saber se andou: com a camada de recursos, andar = pincelada). */
  private pressAt: { x: number; y: number } | null = null;
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
  /** Animações dos desastres na camada de cima (T8–T10) e se ainda há algo dela na tela. */
  private fx = new DisasterFx();
  /** O "Medir desempenho" está medindo a GPU (desenhos seguidos): não conta como travada. */
  private gpuMeasuring = false;
  /** Frequência dos desastres naturais escolhida (o "Medir desempenho" volta para ela). */
  private disasterFrequency = DEFAULT_FREQUENCY;
  /** Furacões andando (R8), pela identidade: o que está no desenho e para onde vai. */
  private storms = new Map<number, { kind: number; shown: { p: Vec3; radius: number; power: number }; target: { p: Vec3; radius: number; power: number } }>();
  /** Tremor da tela do terremoto em curso (R5): início, duração (ms) e força (px). */
  private shake: { start: number; ms: number; amp: number } | null = null;
  private fxShown = false;
  /** Nuvens ligadas no menu Clima (o desenho nasce depois do primeiro mundo). */
  private cloudsOn = true;
  /** Setas do teclado: aproximar, afastar e girar (notebook). */
  private keys = new KeyControls(window, () => this.camera.stopSpin());

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
      // Toque curto (modo Mover) seleciona: mostra o que há no ponto (pedido do usuário, 2026-10-17).
      // Com uma ferramenta de desastre (T11), provoca o desastre ali.
      onTap: (sx, sy) => {
        const p = this.disasterTool !== null ? this.camera.pick(sx, sy) : null;
        if (p && this.disasterTool !== null) this.provoke(this.disasterTool, p);
        else void this.showDepositAt(sx, sy);
      },
      onHover: (sx, sy) => {
        this.brushScreen = { x: sx, y: sy };
        if (this.mode === 'paint') this.requestDraw();
      },
      onLeave: () => {
        this.brushScreen = null;
        this.requestDraw();
      },
      // O giro de teste ("Girar (fps)") para no toque, como a inércia: com ele ligado, segurar o
      // pincel arrastava o globo por baixo do dedo e o morro virava uma listra.
      onPress: () => {
        if (!this.stressSpin || this.bench) return;
        this.stressSpin = false;
        this.debug.setSpinning(false);
      },
    });

    this.hud = new Hud(
      root,
      {
        onMenuChange: (state) => {
          this.disasterTool = activeDisaster(state);
          const brush = activeBrush(state);
          if (brush !== null) this.tool = brush;
          this.setMode(inputModeOf(state));
        },
        onBrushSize: (size) => {
          this.brushSize = size;
          this.requestDraw();
        },
        onPlateRate: (percent) => this.setPlateRate(percent / 100),
        onDisasterFrequency: (level) => {
          this.disasterFrequency = level;
          this.sim.setDisasterFrequency(level);
        },
        onClimateControl: (degrees) => {
          this.climateControl = degrees;
          this.sim.setClimateControl(degrees);
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
          if (id === 'cloudsLayer') {
            if (this.renderer) this.renderer.clouds = on ? 1 : 0;
            this.cloudsOn = on;
            this.requestDraw();
          }
        },
        // Uma visão por vez (decisão do usuário, 2026-10-19): ligar uma desliga as outras.
        onView: (id) => {
          const resources = id === 'resourcesLayer';
          this.layers = { ...this.layers, plates: id === 'platesLayer', biomes: id === 'biomesLayer', stress: id === 'stressLayer', resources };
          if (!resources) this.tip.hide();
          if (this.renderer) this.renderer.resourcesLayer = resources;
          this.legend.show(resources);
          this.biomeLegend.show(this.layers.biomes);
          this.stressLegend.show(this.layers.stress);
          this.sim.setLayers(this.layers);
          this.requestDraw();
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
    this.legend = new ResourceLegend(this.hud.root, (mask) => {
      this.layers = { ...this.layers, resourceMask: mask };
      this.sim.setLayers(this.layers);
    });
    this.tip = new DepositTip(this.hud.root);
    // Legenda dos biomas: oceanos e gelo primeiro, depois a terra do frio ao quente.
    const order = [Biome.Ice, Biome.Tundra, Biome.Taiga, Biome.TemperateForest, Biome.Grassland, Biome.Steppe, Biome.ColdDesert, Biome.HotDesert, Biome.Savanna, Biome.TropicalForest, Biome.Swamp, Biome.Mountain, Biome.SnowyPeak, Biome.Beach];
    this.biomeLegend = new BiomeLegend(
      this.hud.root,
      order.map((b) => BIOME_INFO[b]?.name ?? ''),
      order.map((b) => BIOME_LAYER_COLORS[b] ?? [0, 0, 0]),
    );
    this.toasts = new DisasterToasts(this.hud.root, (p) => this.flyTo(p));
    // Camada "Ver tensão" (T11): a escala de cores das fronteiras.
    this.stressLegend = new BiomeLegend(this.hud.root, ['Tensão baixa', 'média', 'alta: terremoto perto'], STRESS_COLORS);
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
      onWorld: (info, colors, plateCells, deposits) => this.onWorld(info, colors, plateCells, deposits),
      onRecomposed: (patches, plateCells, angles, plates, deposits) => this.onRecomposed(patches, plateCells, angles, plates, deposits),
      onProgress: (stage, fraction) => {
        this.lastGenerationSignal = performance.now();
        this.showProgress(stage, fraction);
      },
      onPatch: (patches, brushMs, deposits) => this.onPatch(patches, brushMs, deposits),
      onDisasters: (events) => this.onDisasters(events),
      onStorms: (storms) => this.onStorms(storms),
      onClock: (tick, speed, ticksPerSecond, geologyMs, memoryMb, angles, work, climate) => {
        this.climate = climate;
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
        this.stalls.clock(performance.now(), Date.now(), speed !== 0 && this.loadingEl.hidden === true, work.waitMs, work.recompositions, this.stallContext());
      },
    });
    // Página escondida (outro app por cima): o intervalo até voltar não é travada.
    document.addEventListener('visibilitychange', () => this.stalls.restart());
    this.newWorld(seedText);
  }

  /** Pede ao worker outro planeta. O globo atual continua na tela (e girável) enquanto ele nasce. */
  newWorld(seedText: string): void {
    this.showProgress('', 0);
    this.loadingEl.hidden = false;
    this.worldRequestedAt = performance.now();
    this.lastGenerationSignal = this.worldRequestedAt;
    this.fx.clear();
    this.toasts?.clear();
    this.storms.clear();
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

  private onWorld(info: WorldInfo, colors: Uint8Array, plateCells: Uint8Array, deposits: Uint8Array): void {
    const receiveStart = performance.now();
    this.worldTotalMs = receiveStart - this.worldRequestedAt;
    this.firstLoad ??= { pageToGlobeMs: receiveStart, requestToGlobeMs: this.worldTotalMs, workerMs: info.generationMs, stagesMs: info.stagesMs };
    this.lastGenerationSignal = performance.now();
    this.info = info;
    this.colors = colors;
    if (!this.renderer) {
      this.renderer = new GlobeRenderer(this.canvas, info.n, colors);
      this.renderer.clouds = this.cloudsOn ? 1 : 0;
    } else this.renderer.setWorld(info.n, colors);
    this.renderer.setPlates(plateCells);
    this.renderer.setDeposits(deposits);
    this.renderer.resourcesLayer = this.layers.resources;
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
  private onRecomposed(patches: Patch[], plateCells: Uint8Array, angles: number[], plates: PlateMotionInfo[], deposits: Uint8Array): void {
    if (!this.info || !this.renderer) return;
    // Eixo, velocidade e centro de cada placa nesta composição (o eixo muda quando placas se soldam).
    this.info.plates = plates;
    const receiveStart = performance.now();
    for (const p of patches) applyPatch(this.colors, this.info.n, p);
    // A composição atual vira a anterior e as duas se misturam por FADE_MS (sem salto na troca). O
    // renderizador guarda antes a imagem da atual, com os eixos de agora: só depois entram os novos.
    this.renderer.recomposed(plateCells, deposits);
    const u = this.motion.uniforms;
    plates.forEach((p, k) => u.axis.set([...p.axis, p.speed], k * 4));
    this.motion.prevAngles = this.motion.baseAngles;
    this.motion.baseAngles = angles;
    this.motion.fadeStart = performance.now();
    this.requestDraw();
    const receivedAt = performance.now();
    this.stalls.noteRecomposition(receivedAt, receivedAt - receiveStart);
    this.bench?.receive.push(receivedAt - receiveStart);
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

  /** Furacões que a simulação mandou (R8): o alvo de cada um, pela identidade. */
  private onStorms(data: Float32Array): void {
    const seen = new Set<number>();
    for (let k = 0; k + STORM_FLOATS <= data.length; k += STORM_FLOATS) {
      const id = data[k] as number;
      seen.add(id);
      const target = {
        p: [data[k + 1] as number, data[k + 2] as number, data[k + 3] as number] as Vec3,
        radius: data[k + 4] as number,
        power: data[k + 5] as number,
      };
      const kind = data[k + 6] as number;
      const s = this.storms.get(id);
      if (s) s.target = target;
      else this.storms.set(id, { kind, shown: { ...target, p: [...target.p] as Vec3 }, target });
    }
    for (const id of [...this.storms.keys()]) if (!seen.has(id)) this.storms.delete(id);
    this.requestDraw();
  }

  /**
   * Furacões no desenho: cada um anda suave até a última posição recebida (a simulação manda uma por
   * laço; em 1× seriam saltos de uma célula). Devolve quantos.
   */
  private updateStorms(dt: number): number {
    const r = this.renderer;
    if (!r) return 0;
    const a = 1 - Math.exp(-dt * 15);
    let n = 0;
    let dust = 0;
    for (const s of this.storms.values()) {
      if (s.kind === 0 ? n >= MAX_STORMS : dust >= MAX_DUST) continue;
      const sh = s.shown;
      const t = s.target;
      let x = sh.p[0] + (t.p[0] - sh.p[0]) * a;
      let y = sh.p[1] + (t.p[1] - sh.p[1]) * a;
      let z = sh.p[2] + (t.p[2] - sh.p[2]) * a;
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      sh.p = [x, y, z];
      sh.radius += (t.radius - sh.radius) * a;
      sh.power += (t.power - sh.power) * a;
      if (s.kind === 1) {
        // Tempestade de areia (C12).
        r.dust.set([x, y, z, sh.radius], dust * 4);
        r.dustPower[dust] = sh.power;
        dust++;
        continue;
      }
      r.storms.set([x, y, z, sh.radius], n * 4);
      r.stormPower[n] = sh.power;
      n++;
    }
    r.dustCount = dust;
    return n + dust;
  }

  /** Desastres que aconteceram: animação, aviso (só os grandes naturais) e lista. */
  private onDisasters(events: DisasterEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      this.fx.add(e, now);
      if (e.kind === DisasterKind.Quake) this.startShake(e, now);
      // Meteoro grande e gigante tremem a tela quando batem (~1 s depois de entrar, em 1×).
      if (e.kind === DisasterKind.Meteor && SHAKE_MAGNITUDE[e.magnitude]) this.startShake({ ...e, magnitude: SHAKE_MAGNITUDE[e.magnitude] as number }, now + 1000);
    }
    for (const e of events) if (isToast(e)) this.toasts.show(toEntry(e));
  }

  /**
   * O jogador provoca um desastre (com a força escolhida no cartão). A velocidade não muda: o jogo nunca
   * muda as escolhas do jogador sozinho (decisão do usuário, 2026-10-19, revertendo a volta para 1×).
   */
  private provoke(kind: DisasterKind, point: Vec3): void {
    this.sim.triggerDisaster(kind, point, this.hud.strengthOf(kind));
  }

  /**
   * A tela treme no terremoto (só a câmera): 0,5–2 s e até ~14 px pela magnitude, menos quanto mais
   * longe o epicentro está do centro da tela; fora da vista, quase nada.
   */
  private startShake(e: DisasterEvent, now: number): void {
    const k = Math.max(0, Math.min(1, (e.magnitude - 6) / 3.5));
    const c = this.camera.centerPoint();
    const dist = Math.acos(Math.max(-1, Math.min(1, c[0] * e.point[0] + c[1] * e.point[1] + c[2] * e.point[2])));
    const near = Math.max(0, 1 - dist / Math.max(1e-3, feltRadius(e.magnitude)));
    const seen = this.camera.worldToScreen(e.point).visible ? 1 : 0.3;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const amp = (2 + 12 * k) * near * seen * ratio;
    if (amp < 0.5) return;
    const ms = 500 + 1500 * k;
    if (this.shake && this.shake.amp * (1 - (now - this.shake.start) / this.shake.ms) > amp) return;
    this.shake = { start: now, ms, amp };
  }

  /** Um quadro do tremor; devolve true enquanto treme. */
  private updateShake(now: number): boolean {
    const s = this.shake;
    if (!s) return false;
    if (now < s.start) return false;
    const t = (now - s.start) / s.ms;
    if (t >= 1) {
      this.shake = null;
      this.camera.shakeX = 0;
      this.camera.shakeY = 0;
      return true;
    }
    const a = s.amp * (1 - t) * (1 - t);
    this.camera.shakeX = a * (0.6 * Math.sin(now * 0.09) + 0.4 * Math.sin(now * 0.157 + 1.3));
    this.camera.shakeY = a * (0.6 * Math.sin(now * 0.113 + 2.1) + 0.4 * Math.sin(now * 0.071 + 0.4));
    return true;
  }

  /** Leva a câmera até um ponto do planeta, suave (~0,8 s). */
  private flyTo(point: Vec3): void {
    this.camera.stopSpin();
    this.flight = { from: this.camera.centerPoint(), to: point, start: performance.now() };
    this.requestDraw();
  }

  /** Um quadro do voo da câmera (interpolação na esfera, com aceleração suave). */
  private updateFlight(): boolean {
    const f = this.flight;
    if (!f) return false;
    const u = Math.min(1, (performance.now() - f.start) / FLY_MS);
    const t = u * u * (3 - 2 * u);
    const p: Vec3 = [f.from[0] + (f.to[0] - f.from[0]) * t, f.from[1] + (f.to[1] - f.from[1]) * t, f.from[2] + (f.to[2] - f.from[2]) * t];
    if (Math.hypot(p[0], p[1], p[2]) > 1e-6) this.camera.lookAt(p);
    if (u >= 1) this.flight = null;
    return true;
  }

  private onPatch(patches: Patch[], brushMs: number, deposits?: Uint8Array): void {
    if (!this.info || !this.renderer) return;
    for (const p of patches) applyPatch(this.colors, this.info.n, p);
    this.renderer.upload(patches);
    if (deposits) this.renderer.setDeposits(deposits);
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
    const resources = this.layers.resources;
    if (phase === 'start') {
      // Com a camada de recursos, espera mais: toque curto mostra o nome da jazida (opção a do usuário).
      this.paintGate.start(performance.now(), resources ? TAP_HOLD_MS : undefined);
      this.pressAt = { x: sx, y: sy };
    } else if (phase === 'move') {
      const slop = 12 * (window.devicePixelRatio || 1);
      if (this.pressAt && Math.hypot(sx - this.pressAt.x, sy - this.pressAt.y) > slop) this.paintGate.move();
    } else if (phase === 'cancel') this.paintGate.cancel();
    // Toque rápido (soltou antes da espera): aplica uma vez, com efeito visível; com a camada de
    // recursos, se tocou numa jazida, mostra o nome e não pinta.
    else if (phase === 'end' && this.paintGate.end()) {
      if (resources) {
        void this.showDepositAt(sx, sy).then((found) => {
          if (found) return;
          this.brushScreen = { x: sx, y: sy };
          this.applyBrushAtScreen(1 / 20);
        });
      } else this.applyBrushAtScreen(1 / 20);
    }
    this.requestDraw();
  }

  /** Nome da jazida no ponto tocado (pixels do canvas), num balão. Retorna se achou uma. */
  private async showDepositAt(sx: number, sy: number): Promise<boolean> {
    const p = this.camera.pick(sx, sy);
    if (!p) return false;
    const cell = await this.sim.query(p);
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width / this.canvas.width;
    if (cell.deposit && this.layers.resources) {
      this.tip.show(depositLabel(cell.deposit), rect.left + sx * k, rect.top + sy * k);
      return true;
    }
    // Sem a camada de recursos: o bioma e, se houver jazida à vista (não escondida, não sob o gelo),
    // ela também. No modo pintar (Rebaixar) só a camada de recursos mostra; o resto pinta.
    if (this.mode !== 'move') return false;
    let name = BIOME_INFO[cell.biome]?.name ?? '';
    // Depois de um desastre: o estado e a vegetação ("Floresta temperada · queimada · vegetação 20%").
    if (!cell.water && !cell.ice) {
      const state = STATE_NAMES[cell.state];
      if (state) name += ` · ${state}`;
      if (cell.state === CellState.Heat) name += ` +${Math.round(droughtHeat(cell.level))} °C`;
      if (cell.cover < 0.995 || state) name += ` · vegetação ${Math.round(cell.cover * 100)}%`;
    }
    const visible = cell.deposit && !isHiddenOil(cell.deposit) && !cell.ice;
    this.tip.show(visible ? `${name} · ${depositLabel(cell.deposit)}` : name, rect.left + sx * k, rect.top + sy * k);
    return false;
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
    if (!document.hidden && this.loadingEl.hidden && !this.gpuMeasuring) this.stalls.frame(time, Date.now(), this.stallContext());
    else this.stalls.restart();
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
    if (this.keys.update(this.camera, dt)) this.needsDraw = true;
    if (this.updateFlight()) this.needsDraw = true;
    if (this.updateShake(performance.now())) this.needsDraw = true;
    if (this.input.update(dt)) this.needsDraw = true;
    if (this.updateMotion()) this.needsDraw = true;
    const gate = this.paintGate.frame(performance.now());
    if (gate !== 'none') this.applyBrushAtScreen(gate === 'first' ? 1 / 20 : dt);

    if (this.stressSpin) {
      // Mesma velocidade na tela em qualquer zoom (de perto, girar 0,6 rad/s passaria voando).
      const r = quatFromAxisAngle([0, 1, 0], (dt * 0.6) / this.camera.zoom);
      this.camera.setOrientation(quatNormalize(quatMultiply(this.camera.orientation, r)));
      this.needsDraw = true;
    }

    // Nuvens andando (só com o tempo correndo e de longe) e furacões: o globo é redesenhado.
    if (this.renderer) {
      const r = this.renderer;
      const running = this.clock.speed !== 0;
      if (running) r.cloudTime += dt;
      const before = r.stormCount + r.dustCount;
      const moving = this.updateStorms(dt);
      if (moving || before) this.needsDraw = true;
      r.stormCount = moving - r.dustCount;
      if (running && r.clouds > 0 && this.camera.cellPixels() < 4) this.needsDraw = true;
    }
    const drew = this.needsDraw;
    if (this.needsDraw) {
      renderer.draw(this.camera, this.motion.uniforms);
      this.drawOverlay();
      this.needsDraw = false;
    } else if (this.fx.active || this.fxShown) {
      // Animação de desastre correndo com o globo parado: só a camada de cima é redesenhada.
      this.drawOverlay();
    }
    const workMs = performance.now() - workStart;
    this.stalls.frameWork(workMs);
    this.bench?.recorder?.frame(time, workMs, drew);
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

  /** Velocidade e placas agora, para cada travada registrada. */
  private stallContext(): string {
    const speed = this.clock.speed;
    const time = speed === 0 ? 'pausado' : speed === 'max' ? 'máx' : `${speed}×`;
    return `${time} · placas ${Math.round(this.plateRate * 100)}%${this.mode === 'paint' ? ' · pincel' : ''}`;
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
      sharedMemory: `${this.sim.sharedMemory} · recargas p/ isolar ${isolationReloads()}`,
      cycle: `${CYCLE_PHASES[this.work.cyclePhase] ?? '—'} · ${this.work.supercontinents} supercontinentes · ${this.work.ruptures} rupturas`,
      climate: `${signed(this.climate.offset)} °C (controle ${signed(this.climateControl)}) · mar ${signed(this.climate.seaLevel, 0)} m`,
      stalls: this.stalls.lines(4, clockTime),
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
    const steps = 14;
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const status = (step: number, name: string, panel: PanelMode = 'hidden') =>
      this.debug.setBenchmarkRunning(`Medindo ${step}/${steps}: ${name}… (${Math.round((performance.now() - startedAt) / 1000)} s)`, panel);
    const scenarios: ScenarioResult[] = [];
    // Memória da página inteira: o navegador só responde depois de uma limpeza de memória (até ~20 s).
    const pageMemory = measurePageMemory();
    const gpu: GpuSample[] = [];
    const measureGpu = async (label: string): Promise<void> => {
      const r = this.renderer;
      if (!r) return;
      await wait(300);
      // Os desenhos seguidos da medição seguram a tela por um instante: não é travada do jogo (C1).
      this.gpuMeasuring = true;
      const m = await r.measureDraw(this.camera, this.motion.uniforms, 40);
      this.gpuMeasuring = false;
      gpu.push({ label, ms: m.ms, method: m.method });
      this.stalls.restart();
    };
    // Transição suave (0,35 s depois de cada recomposição): espera uma de verdade e mede com os valores
    // dela, no meio da mistura.
    const measureFade = async (label: string): Promise<void> => {
      const r = this.renderer;
      if (!r) return;
      const u = this.motion.uniforms;
      const until = performance.now() + 8000;
      while (!(u.fade > 0.02 && u.fade < 0.5) && performance.now() < until) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!(u.fade < 1)) return;
      this.gpuMeasuring = true;
      const m = await r.measureDraw(this.camera, { ...u, fade: 0.5 }, 40);
      this.gpuMeasuring = false;
      gpu.push({ label, ms: m.ms, method: m.method });
      this.stalls.restart();
    };
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
      this.sim.resetWorst();
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
      // De perto (zoom máximo, células quadradas e divisas alisadas): o desenho mais pesado por pixel.
      await scenario(3, 'de perto, girando', 6000, () => {
        this.camera.zoom = this.camera.maxZoom;
      });
      // GPU do globo (meta ≤ 8 ms por quadro): longe com nuvens e de perto, parado.
      status(4, 'GPU do globo');
      spin(false);
      this.camera.zoom = 1;
      await measureGpu('longe');
      this.camera.zoom = this.camera.maxZoom;
      await measureGpu('de perto');
      await scenario(5, 'tempo 20×, placas paradas', 8000, () => {
        spin(false);
        this.camera.zoom = 1;
        this.setPlateRate(0);
        this.setSpeed(20);
      });
      await scenario(6, '  idem, painel c/ desfoque', 8000, () => undefined, 'blur');
      await scenario(7, 'tempo 20×, placas 100%', 12_000, () => this.setPlateRate(1));
      await scenario(8, '  idem, painel c/ desfoque', 10_000, () => undefined, 'blur');
      await scenario(9, '  idem, painel s/ desfoque', 10_000, () => undefined, 'plain');
      await scenario(10, '  idem, de perto', 10_000, () => {
        this.camera.zoom = this.camera.maxZoom;
      });
      await measureGpu('de perto com placas andando');
      await measureFade('de perto na transição');
      // Distância média (células de ~5 px): bordas orgânicas e vista de perto ao mesmo tempo, o
      // desenho mais caro por pixel (RG, 2026-10-18).
      this.camera.zoom = Math.min(this.camera.maxZoom, 5 / (this.camera.baseRadius() * this.camera.cellAngle));
      await measureGpu('meio com placas andando');
      await measureFade('meio na transição');
      // Deriva longa: continua a mesma deriva por mais 1 min (o planeta passa de ~1,5 min de deriva
      // a 20×, quando os continentes começam a colidir e se soldar).
      await scenario(11, 'deriva longa c/ colisões', 60_000, () => {
        this.camera.zoom = 1;
      });
      // Ruptura forçada (G2): o maior bloco soldado racha agora; mede a recomposição que vem junto.
      await scenario(12, 'ruptura forçada', 10_000, () => this.sim.forceRupture());
      // Tudo acontecendo (R9): desastres em "Muitos" a 20× com as placas a 100% (fogo, lava, furacões,
      // secas, enchentes e tsunamis andando passo a passo; o chão repintado a cada laço).
      await scenario(13, 'desastres "Muitos", 20×', 20_000, () => this.sim.setDisasterFrequency(FREQUENCIES.length - 1));
      this.camera.zoom = 1;
      await measureGpu('longe com desastres "Muitos"');
      this.sim.setDisasterFrequency(this.disasterFrequency);
      bench.panelOpen = false;
      // Geração: o mesmo mundo de novo (também desfaz a deriva da medição).
      status(14, 'geração de mundo');
      this.setSpeed(0);
      this.setPlateRate(before.plateRate);
      await wait(500);
      const receiveMs = await new Promise<number>((resolve) => {
        bench.onWorld = resolve;
        this.newWorld(seedText);
      });
      const info = this.info as WorldInfo;
      gen = { totalMs: this.worldTotalMs, workerMs: info.generationMs, stagesMs: info.stagesMs, helperShare: info.helperShare, receiveMs };
    } finally {
      spin(before.spin);
      this.sim.setDisasterFrequency(this.disasterFrequency);
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
        sharedMemory: `${this.sim.sharedMemory} (recargas p/ isolar ${isolationReloads()})`,
        screen: `tela ${screen.width}×${screen.height} @${(window.devicePixelRatio || 1).toFixed(2)} · desenho ${canvas.width}×${canvas.height} · ~${this.stats.lastMinGap > 0 ? Math.round(1000 / this.stats.lastMinGap) : 0} Hz`,
        userAgent: navigator.userAgent,
      },
      scenarios,
      gen,
      this.firstLoad,
      this.stalls.lines(STALL_KEEP, clockTime),
      gpu,
      { dataMb: this.stats.memoryMb, ...(await pageMemory) },
    );
    this.debug.showReport(report);
    this.updateDebug();
  }

  private drawOverlay(): void {
    this.overlay.clear();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.fxShown = this.fx.active;
    if (this.fx.active) this.fx.draw(this.overlay.context, this.camera, performance.now(), dpr);
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

/** Hora do relógio de parede (hh:mm:ss) de uma travada. */
function clockTime(wall: number): string {
  return new Date(wall).toLocaleTimeString('pt-BR', { hour12: false });
}

/** Guarda a semente na URL: o link compartilhado abre o mesmo mundo. */
export function setSeedInUrl(seedText: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seedText);
  window.history.replaceState(null, '', url);
}

/** Número com sinal, em português (vírgula decimal): "+1,5", "−3,2", "0". */
function signed(v: number, digits = 1): string {
  const r = Number(v.toFixed(digits));
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits).replace('.', ',')}`;
}

/**
 * Memória da página inteira (com os workers), se o navegador informa: a medida completa do Chrome com
 * a página isolada; senão só a memória do JavaScript da tela (Chrome); o Firefox não informa.
 */
async function measurePageMemory(): Promise<{ pageMb: number | null; pageHow: string }> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    memory?: { usedJSHeapSize: number };
  };
  try {
    if (perf.measureUserAgentSpecificMemory && globalThis.crossOriginIsolated) {
      const r = await perf.measureUserAgentSpecificMemory();
      return { pageMb: r.bytes / 1e6, pageHow: 'medida do navegador, com os workers' };
    }
  } catch {
    // Cai para a medida mais simples.
  }
  if (perf.memory) return { pageMb: perf.memory.usedJSHeapSize / 1e6, pageHow: 'só o JavaScript da tela' };
  return { pageMb: null, pageHow: 'este navegador não informa' };
}
