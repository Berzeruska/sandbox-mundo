import type { Vec3 } from '../world/cubesphere';
import { DISASTER_ICONS, entryText, MAX_TOASTS, TOAST_MS, type LogEntry } from './disaster-log';

/**
 * Avisos dos desastres grandes (T12; R2: no canto inferior esquerdo, sem lista). Tocar no aviso leva a
 * câmera até o lugar.
 */
export class DisasterToasts {
  private root: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private onGo: (point: Vec3) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'dis-toasts';
    parent.append(this.root);
  }

  show(e: LogEntry): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dis-toast';
    b.title = 'Ir até lá';
    b.append(icon(e), document.createTextNode(entryText(e)));
    b.addEventListener('click', () => {
      this.onGo(e.point);
      b.remove();
    });
    this.root.prepend(b);
    while (this.root.children.length > MAX_TOASTS) this.root.lastElementChild?.remove();
    window.setTimeout(() => b.remove(), TOAST_MS);
  }

  clear(): void {
    this.root.innerHTML = '';
  }
}

function icon(e: LogEntry): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'dis-icon';
  s.textContent = DISASTER_ICONS[e.kind] ?? '⚠️';
  return s;
}
