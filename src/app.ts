import { seedFrom } from './core/rng';
import { Camera } from './render/camera';
import { buildColors } from './render/colors';
import { GlobeRenderer } from './render/globe-renderer';
import { createWorld } from './world/create';
import { CubeSphere, type Vec3 } from './world/cubesphere';
import type { WorldState } from './world/state';

/** Resolução padrão da face do planeta (ver docs/01-arquitetura.md). */
export const DEFAULT_N = 256;
const MAX_PIXEL_RATIO = 2;

/** Liga simulação, câmera e renderização. A simulação não sabe que o App existe. */
export class App {
  readonly camera = new Camera();
  readonly renderer: GlobeRenderer;
  world: WorldState;
  colors: Uint8Array;
  private grid: CubeSphere;
  private needsDraw = true;

  constructor(canvas: HTMLCanvasElement, seedText: string) {
    this.grid = new CubeSphere(DEFAULT_N);
    this.world = this.generate(seedText);
    this.colors = new Uint8Array(this.world.cellCount * 4);
    buildColors(this.world, this.colors);
    this.renderer = new GlobeRenderer(canvas, this.world.params.n, this.colors);
    this.camera.lookAt(landCenter(this.world));
  }

  private generate(seedText: string): WorldState {
    return createWorld(
      { seedText, seed: seedFrom(seedText), n: this.grid.n, seaLevel: 0, landFraction: 0.3 },
      this.grid,
    );
  }

  requestDraw(): void {
    this.needsDraw = true;
  }

  /** Um quadro: ajusta tamanho e desenha se algo mudou. */
  frame(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (this.renderer.resize(ratio)) {
      this.camera.setViewport(this.renderer.canvas.width, this.renderer.canvas.height);
      this.needsDraw = true;
    }
    if (this.needsDraw) {
      this.renderer.draw(this.camera);
      this.needsDraw = false;
    }
  }

  start(): void {
    const loop = (): void => {
      this.frame();
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
