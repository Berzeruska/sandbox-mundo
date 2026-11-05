import type { Camera } from '../render/camera';

/**
 * Teclado do notebook (pedido do usuário, 2026-10-17): seta para cima aproxima, para baixo afasta,
 * esquerda e direita giram o globo. Segurar a tecla continua o movimento, na mesma velocidade na tela
 * em qualquer zoom.
 */
/** Zoom por segundo com a tecla segurada (×e^ZOOM_RATE). */
export const KEY_ZOOM_RATE = 1.6;
/** Giro por segundo, em raios do globo na tela (~0,9 rad/s de longe; de perto, a mesma velocidade na tela). */
export const KEY_TURN_RATE = 0.9;

const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type Key = (typeof KEYS)[number];

/** Direção pedida pelas teclas seguradas: zoom (+1 aproxima) e giro (+1 = olhar para a direita). */
export function keyAxes(held: ReadonlySet<string>): { zoom: number; turn: number } {
  return {
    zoom: (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0),
    turn: (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0),
  };
}

export class KeyControls {
  private held = new Set<Key>();

  constructor(target: Window, onPress: () => void) {
    target.addEventListener('keydown', (e) => {
      if (!(KEYS as readonly string[]).includes(e.key) || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.held.add(e.key as Key);
      onPress();
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.key as Key));
    // Janela perdeu o foco com a tecla apertada: o keyup nunca chega.
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Move a câmera pelo tempo `dt` (s). Retorna true se mexeu. */
  update(camera: Camera, dt: number): boolean {
    if (!this.held.size || dt <= 0) return false;
    const { zoom, turn } = keyAxes(this.held);
    const cx = camera.centerX();
    const cy = camera.centerY();
    if (zoom) camera.zoomAt(cx, cy, Math.exp(zoom * KEY_ZOOM_RATE * dt));
    // Como arrastar a tela pelo centro (olhar para a direita = puxar o planeta para a esquerda): a
    // mesma velocidade aparente em qualquer zoom.
    if (turn) {
      const dx = -turn * KEY_TURN_RATE * camera.radius() * dt;
      camera.drag(cx, cy, cx + dx, cy);
    }
    return zoom !== 0 || turn !== 0;
  }
}
