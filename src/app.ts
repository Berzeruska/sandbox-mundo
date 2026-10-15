import { seedFrom } from './core/rng';
import { PointerInput, type InputMode, type PaintPhase } from './input/pointer';
import { applyBrush, Tool } from './input/tools';
import { Camera } from './render/camera';
import { buildColors } from './render/colors';
import { dirtyRects } from './render/dirty';
import { GlobeRenderer } from './render/globe-renderer';
import { Overlay } from './render/overlay';
import { Hud } from './ui/hud';
import { createWorld } from './world/create';
import { CubeSphere, type Vec3 } from './world/cubesphere';
import type { WorldState } from './world/state';

/** Resolução padrão da face do planeta (ver docs/01-arquitetura.md). */
export const DEFAULT_N = 256;
const MAX_PIXEL_RATIO = 2;
const DEFAULT_BRUSH = 6;
/**
 * Espera antes de começar a pintar (ms). Se o segundo dedo chegar antes, é pinça e nada é pintado;
 * sem isso, todo zoom por pinça no modo pintar deixaria um borrão onde o primeiro dedo encostou.
 */
const PAINT_DELAY_MS = 80;

/** Liga simulação, câmera, entrada, interface e renderização. A simulação não sabe que o App existe. */
export class App {
  readonly camera = new Camera();
  readonly renderer: GlobeRenderer;
  readonly overlay: Overlay;
  readonly input: PointerInput;
  readonly hud: Hud;
  world: WorldState;
  colors: Uint8Array;
  mode: InputMode = 'move';
  tool: Tool = Tool.Raise;
  brushSize = DEFAULT_BRUSH;
  private grid: CubeSphere;
  private needsDraw = true;
  private lastTime = 0;
  /** Posição do pincel na tela (mouse por cima ou dedo pintando), ou null. */
  private brushScreen: { x: number; y: number } | null = null;
  private painting = false;
  private paintStartedAt = 0;
  private paintApplied = false;

  constructor(root: HTMLElement, seedText: string) {
    const canvas = document.createElement('canvas');
    canvas.id = 'globe';
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'overlay';
    root.append(canvas, overlayCanvas);

    this.grid = new CubeSphere(DEFAULT_N);
    this.world = this.generate(seedText);
    this.colors = new Uint8Array(this.world.cellCount * 4);
    buildColors(this.world, this.colors);
    this.renderer = new GlobeRenderer(canvas, this.world.params.n, this.colors);
    this.overlay = new Overlay(overlayCanvas);
    this.camera.setCellAngle(this.grid.cellAngle);
    this.camera.lookAt(landCenter(this.world));

    this.input = new PointerInput(canvas, this.camera, {
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
        onModeToggle: () => this.setMode(this.mode === 'move' ? 'paint' : 'move'),
        onTool: (tool) => {
          this.tool = tool;
          this.hud.setTool(tool);
          this.setMode('paint');
        },
        onBrushSize: (size) => {
          this.brushSize = size;
          this.requestDraw();
        },
      },
      this.brushSize,
    );
    this.hud.setTool(this.tool);
    this.hud.setMode(this.mode);
  }

  private generate(seedText: string): WorldState {
    return createWorld(
      { seedText, seed: seedFrom(seedText), n: this.grid.n, seaLevel: 0, landFraction: 0.3 },
      this.grid,
    );
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    this.painting = false;
    this.hud.setMode(mode);
    this.requestDraw();
  }

  requestDraw(): void {
    this.needsDraw = true;
  }

  private onPaint(sx: number, sy: number, phase: PaintPhase): void {
    this.brushScreen = { x: sx, y: sy };
    if (phase === 'start') {
      this.painting = true;
      this.paintStartedAt = performance.now();
      this.paintApplied = false;
    } else if (phase === 'end') {
      // Toque rápido (soltou antes da espera): aplica uma vez, com efeito visível.
      if (this.painting && !this.paintApplied) this.applyBrushAtScreen(1 / 20);
      this.painting = false;
    } else if (phase === 'cancel') {
      this.painting = false;
    }
    this.requestDraw();
  }

  private applyBrushAtScreen(dt: number): void {
    if (!this.brushScreen) return;
    const p = this.camera.pick(this.brushScreen.x, this.brushScreen.y);
    if (!p) return;
    const { region } = applyBrush(this.world, this.tool, p, this.brushSize, dt);
    buildColors(this.world, this.colors, region);
    this.renderer.upload(dirtyRects(this.grid, region));
    this.needsDraw = true;
  }

  /** Um quadro: ajusta tamanho, avança animações e pincel, e desenha se algo mudou. */
  frame(time: number): void {
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (this.renderer.resize(ratio)) {
      this.camera.setViewport(this.renderer.canvas.width, this.renderer.canvas.height);
      this.overlay.resize(this.renderer.canvas.width, this.renderer.canvas.height);
      this.needsDraw = true;
    }
    if (this.camera.update(dt)) this.needsDraw = true;
    if (this.input.update(dt)) this.needsDraw = true;
    if (this.painting && performance.now() - this.paintStartedAt >= PAINT_DELAY_MS) {
      this.applyBrushAtScreen(this.paintApplied ? dt : 1 / 20);
      this.paintApplied = true;
    }

    if (this.needsDraw) {
      this.renderer.draw(this.camera);
      this.drawOverlay();
      this.needsDraw = false;
    }
  }

  private drawOverlay(): void {
    this.overlay.clear();
    if (this.mode !== 'paint' || !this.brushScreen) return;
    const p = this.camera.pick(this.brushScreen.x, this.brushScreen.y);
    if (p) this.overlay.drawCap(this.camera, p, this.brushSize * this.grid.cellAngle);
  }

  start(): void {
    const loop = (time: number): void => {
      this.frame(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/** Direção média da terra firme: onde a câmera começa olhando. */
export function landCenter(world: WorldState): Vec3 {
  const { positions } = world.grid;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < world.cellCount; i++) {
    if (world.isWater(i)) continue;
    x += positions[i * 3] as number;
    y += positions[i * 3 + 1] as number;
    z += positions[i * 3 + 2] as number;
  }
  const len = Math.hypot(x, y, z);
  return len > 1e-9 ? [x / len, y / len, z / len] : [0, 0, 1];
}
