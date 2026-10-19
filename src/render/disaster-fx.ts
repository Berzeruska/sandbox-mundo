import type { Vec3 } from '../world/cubesphere';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';
import type { Camera } from './camera';

/**
 * Animações dos desastres na camada sobreposta (canvas 2D por cima do globo). Correm em tempo real,
 * independente da velocidade do jogo: a 20× um ano passa em 0,05 s e nada seria visto. Os efeitos de
 * verdade (relevo, marcas) a simulação já aplicou.
 */

interface Fx {
  e: DisasterEvent;
  /** Início (ms, relógio da página) e duração. */
  start: number;
  ms: number;
}

/** Duração das animações (ms). */
const FX_MS: Record<number, number> = {
  // Incêndio (R3), seca e enchente (R4) aparecem nas próprias células, sem animação por cima; o raio é
  // um clarão rápido.
  [DisasterKind.Lightning]: 450,
};
/** Raio: duração do clarão (ms) dentro da animação. */
const FLASH_MS = 300;
/** Animações ao mesmo tempo, no máximo (em "Muitos" a 20× chegam várias por segundo). */
const MAX_FX = 24;

export class DisasterFx {
  private list: Fx[] = [];

  add(e: DisasterEvent, now: number): void {
    const ms = FX_MS[e.kind];
    if (!ms) return;
    this.list.push({ e, start: now, ms });
    if (this.list.length > MAX_FX) this.list.shift();
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  clear(): void {
    this.list = [];
  }

  /** Desenha tudo no instante `now`; tira o que acabou. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, now: number, dpr: number): void {
    this.list = this.list.filter((f) => now - f.start < f.ms);
    for (const f of this.list) {
      if (f.e.kind === DisasterKind.Lightning) drawLightning(ctx, camera, f.e, now - f.start, f.e.id, dpr);
    }
  }
}

/**
 * Raio (R3): um risco em zigue-zague descendo do alto até o ponto e um clarão branco em volta (0,3 s).
 * O desenho é fixo por raio (sorteado pelo id), não muda de um quadro para outro.
 */
function drawLightning(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, ms: number, id: number, dpr: number): void {
  const c = camera.worldToScreen(e.point);
  if (!c.visible || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
  const fade = Math.max(0, 1 - ms / FLASH_MS);
  // Tamanho pelo zoom: de longe um risquinho junto do chão (antes 220 px fixos: parecia cair do espaço).
  const cell = camera.cellPixels();
  const scale = Math.max(0.08, Math.min(1, cell / 40));
  const boltAlpha = ms < FLASH_MS ? 1 : Math.max(0, 1 - (ms - FLASH_MS) / 150);
  // Clarão: brilho radial em volta do ponto.
  if (fade > 0) {
    const r = Math.max(8 * dpr, 60 * dpr * scale);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0, `rgba(255, 255, 255, ${(0.85 * fade).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  }
  // Zigue-zague: de ~220 px acima até o ponto, com desvios sorteados pelo id.
  let h = (Math.imul(id, 2654435761) >>> 0) || 1;
  const rnd = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const top = Math.max(14 * dpr, 220 * dpr * scale);
  let x = c.x + (rnd() - 0.5) * 80 * dpr * scale;
  let y = c.y - top;
  const pts: [number, number][] = [[x, y]];
  while (y < c.y - 12 * dpr) {
    y += Math.max(3 * dpr, (18 + 16 * rnd()) * dpr * scale);
    x += (rnd() - 0.5) * 34 * dpr * scale + (c.x - x) * 0.22;
    pts.push([x, Math.min(y, c.y)]);
  }
  pts.push([c.x, c.y]);
  ctx.lineJoin = 'round';
  for (const [w, color] of [
    [8, `rgba(170, 205, 255, ${(0.45 * boltAlpha).toFixed(3)})`],
    [2.5, `rgba(255, 255, 255, ${boltAlpha.toFixed(3)})`],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w * dpr * Math.max(0.5, scale);
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
}

/** Contorno de um círculo de raio `angle` (rad) na superfície (some atrás do globo). */
export function strokeCap(ctx: CanvasRenderingContext2D, camera: Camera, center: Vec3, angle: number, style: string, width: number): void {
  pathCap(ctx, camera, center, angle);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** Caminho (beginPath…) do círculo de raio `angle` na superfície, só a parte visível. */
function pathCap(ctx: CanvasRenderingContext2D, camera: Camera, center: Vec3, angle: number): void {
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
  const steps = 48;
  ctx.beginPath();
  let penDown = false;
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * Math.PI * 2;
    const ct = Math.cos(t) * s;
    const st = Math.sin(t) * s;
    const q = camera.worldToScreen([center[0] * c + ax * ct + bx * st, center[1] * c + ay * ct + by * st, center[2] * c + az * ct + bz * st]);
    if (!q.visible) {
      penDown = false;
      continue;
    }
    if (penDown) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
    penDown = true;
  }
}
