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

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range');
}

export class KeyControls {
  private held = new Set<Key>();

  constructor(target: Window & typeof globalThis, onPress: () => void) {
    target.addEventListener('keydown', (e) => {
      // Só a caixa de texto fica com as setas: num deslizante (pincel, temperatura) o foco ficava preso e o zoom parava (A2).
      if (!(KEYS as readonly string[]).includes(e.key) || isTextField(e.target)) return;
      e.preventDefault();
      this.held.add(e.key as Key);
      onPress();
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.key as Key));
    // Janela perdeu o foco com a tecla apertada: o keyup nunca chega.
    target.addEventListener('blur', () => this.held.clear());
    // Trocar de tela cheia ou esconder a página também pode engolir o keyup: tecla presa cancelava a outra seta.
    target.document.addEventListener('visibilitychange', () => this.held.clear());
    target.document.addEventListener('fullscreenchange', () => this.held.clear());
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
    if (turn && !camera.turnView(turn * dt)) {
      const dx = -turn * KEY_TURN_RATE * camera.radius() * dt;
      camera.drag(cx, cy, cx + dx, cy);
    }
    return zoom !== 0 || turn !== 0;
  }
}
