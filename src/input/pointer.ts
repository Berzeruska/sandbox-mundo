import { quatIdentity, quatMultiply, type Quat } from '../core/quat';
import type { Camera } from '../render/camera';

export type InputMode = 'move' | 'paint';
/** `cancel` = virou pinça: a pincelada é descartada se ainda não começou. */
export type PaintPhase = 'start' | 'move' | 'end' | 'cancel';

export interface InputHandlers {
  getMode(): InputMode;
  onCameraChange(): void;
  onPaint(sx: number, sy: number, phase: PaintPhase): void;
  /** Mouse passando por cima sem apertar (null = saiu do canvas). */
  onHover(sx: number, sy: number): void;
  onLeave(): void;
}

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

type Action = 'none' | 'rotate' | 'paint' | 'pinch';

/** Quanto tempo de movimento recente (ms) entra no cálculo da inércia. */
export const INERTIA_WINDOW = 80;
const TAP_MAX_MS = 300;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_ZOOM = 2.5;
const ZOOM_ANIM_SECONDS = 0.25;

/**
 * Inércia ao soltar: compõe as rotações feitas nos últimos INERTIA_WINDOW ms e devolve a rotação
 * total e o tempo que ela levou (para virar velocidade). Sem movimento recente, devolve null.
 * Função pura (tempos entram como parâmetro), testada sem depender do relógio.
 */
export function inertiaFromHistory(
  history: readonly { t: number; r: Quat }[],
  now: number,
): { rotation: Quat; seconds: number } | null {
  const recent = history.filter((h) => h.t >= now - INERTIA_WINDOW);
  const first = recent[0];
  if (recent.length < 2 || !first) return null;
  let rotation = quatIdentity();
  for (const h of recent) rotation = quatMultiply(rotation, h.r);
  return { rotation, seconds: Math.max(1000 / 120, now - first.t) / 1000 };
}

/**
 * Mouse e toque com Pointer Events (o mesmo código nos dois).
 * - Modo mover: um dedo/botão gira; pinça dá zoom e gira; roda dá zoom no cursor; toque duplo aproxima.
 * - Modo pintar: um dedo/botão esquerdo pinta; pinça continua dando zoom; botão direito do mouse gira.
 * Coordenadas entregues em pixels do canvas (dispositivo).
 */
export class PointerInput {
  private pointers = new Map<number, PointerState>();
  private action: Action = 'none';
  private history: { t: number; r: Quat }[] = [];
  private pinch = { dist: 1, midX: 0, midY: 0 };
  private lastTap = { t: -Infinity, x: 0, y: 0 };
  private zoomAnim: { x: number; y: number; logLeft: number; rate: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private handlers: InputHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.handlers.onLeave();
    });
  }

  /** Avança animações (zoom do toque duplo). Retorna true se a câmera mudou. */
  update(dt: number): boolean {
    const a = this.zoomAnim;
    if (!a) return false;
    const step = Math.min(a.logLeft, a.rate * dt);
    this.camera.zoomAt(a.x, a.y, Math.exp(step));
    a.logLeft -= step;
    if (a.logLeft <= 1e-6) this.zoomAnim = null;
    return true;
  }

  private toCanvas(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  private onDown = (e: PointerEvent): void => {
    if (this.pointers.size >= 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toCanvas(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y, startTime: e.timeStamp });
    this.camera.stopSpin();
    this.zoomAnim = null;
    this.history = [];

    if (this.pointers.size === 1) {
      const paints = this.handlers.getMode() === 'paint' && (e.pointerType !== 'mouse' || e.button === 0);
      this.action = paints ? 'paint' : 'rotate';
      if (paints) this.handlers.onPaint(p.x, p.y, 'start');
    } else {
      if (this.action === 'paint') this.handlers.onPaint(p.x, p.y, 'cancel');
      this.action = 'pinch';
      this.pinch = this.measurePinch();
    }
  };

  private onMove = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    const p = this.toCanvas(e);
    if (e.pointerType === 'mouse') this.handlers.onHover(p.x, p.y);
    if (!ptr) return;
    const prevX = ptr.x;
    const prevY = ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;

    if (this.action === 'rotate') {
      const r = this.camera.drag(prevX, prevY, p.x, p.y);
      this.remember(e.timeStamp, r);
      this.handlers.onCameraChange();
    } else if (this.action === 'paint') {
      this.handlers.onPaint(p.x, p.y, 'move');
    } else if (this.action === 'pinch' && this.pointers.size === 2) {
      const now = this.measurePinch();
      this.camera.drag(this.pinch.midX, this.pinch.midY, now.midX, now.midY);
      this.camera.zoomAt(now.midX, now.midY, now.dist / this.pinch.dist);
      this.pinch = now;
      this.handlers.onCameraChange();
    }
  };

  private onUp = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    const p = this.toCanvas(e);

    if (this.action === 'paint') {
      this.handlers.onPaint(p.x, p.y, 'end');
      this.action = 'none';
    } else if (this.action === 'pinch') {
      // Sobrou um dedo: ele passa a girar, sem pular.
      this.action = this.pointers.size === 1 ? 'rotate' : 'none';
      this.history = [];
    } else if (this.action === 'rotate' && this.pointers.size === 0) {
      this.startInertia(e.timeStamp);
      this.detectTap(ptr, p.x, p.y, e.timeStamp);
      this.action = 'none';
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.toCanvas(e);
    const scale = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
    this.zoomAnim = null;
    this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * scale));
    this.handlers.onCameraChange();
  };

  private measurePinch(): { dist: number; midX: number; midY: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return this.pinch;
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  private remember(t: number, r: Quat): void {
    this.history.push({ t, r });
    while (this.history.length > 0 && (this.history[0] as { t: number }).t < t - INERTIA_WINDOW) this.history.shift();
  }

  /** Soma os movimentos dos últimos instantes e transforma em velocidade de giro. */
  private startInertia(now: number): void {
    const spin = inertiaFromHistory(this.history, now);
    if (spin) this.camera.setSpinFrom(spin.rotation, spin.seconds);
  }

  private detectTap(ptr: PointerState, x: number, y: number, t: number): void {
    const slop = 12 * (window.devicePixelRatio || 1);
    const isTap = t - ptr.startTime < TAP_MAX_MS && Math.hypot(x - ptr.startX, y - ptr.startY) < slop;
    if (!isTap) return;
    const near = Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < slop * 4;
    if (t - this.lastTap.t < DOUBLE_TAP_MS && near) {
      this.camera.stopSpin();
      const log = Math.log(DOUBLE_TAP_ZOOM);
      this.zoomAnim = { x, y, logLeft: log, rate: log / ZOOM_ANIM_SECONDS };
      this.lastTap.t = -Infinity;
    } else {
      this.lastTap = { t, x, y };
    }
  }
}
