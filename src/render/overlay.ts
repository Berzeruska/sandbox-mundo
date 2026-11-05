import type { Vec3 } from '../world/cubesphere';
import type { Camera } from './camera';

/** Canvas 2D por cima do globo, para marcações (por enquanto, o contorno do pincel). */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Contorno de um círculo na superfície do planeta (segue a curvatura e some atrás do globo). */
  drawCap(camera: Camera, center: Vec3, angle: number): void {
    const ctx = this.ctx;
    // Base tangente no centro do pincel.
    let ax = center[2];
    let az = -center[0];
    let ay = 0;
    if (Math.hypot(ax, az) < 1e-6) [ax, ay, az] = [1, 0, 0];
    const alen = Math.hypot(ax, ay, az);
    ax /= alen;
    ay /= alen;
    az /= alen;
    const bx = center[1] * az - center[2] * ay;
    const by = center[2] * ax - center[0] * az;
    const bz = center[0] * ay - center[1] * ax;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const steps = 64;
    ctx.beginPath();
    let penDown = false;
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * Math.PI * 2;
      const ct = Math.cos(t) * s;
      const st = Math.sin(t) * s;
      const p: Vec3 = [center[0] * c + ax * ct + bx * st, center[1] * c + ay * ct + by * st, center[2] * c + az * ct + bz * st];
      const q = camera.worldToScreen(p);
      if (!q.visible) {
        penDown = false;
        continue;
      }
      if (penDown) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
      penDown = true;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.stroke();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }
}
