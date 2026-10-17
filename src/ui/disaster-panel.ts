import type { Vec3 } from '../world/cubesphere';
import { DISASTER_ICONS, entryText, MAX_TOASTS, TOAST_MS, type DisasterLog, type LogEntry } from './disaster-log';

/**
 * Tela dos desastres (T12): avisos curtos no alto (só os grandes) e a lista completa num painel. Tocar
 * num aviso ou numa linha leva a câmera até o lugar.
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

export class DisasterListPanel {
  readonly root: HTMLDivElement;
  private list: HTMLDivElement;
  private dirty = true;

  constructor(
    parent: HTMLElement,
    private log: DisasterLog,
    private onGo: (point: Vec3) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'panel dis-panel hidden';
    const head = document.createElement('div');
    head.className = 'panel-row dis-head';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Desastres';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel-btn';
    close.textContent = 'Fechar';
    close.addEventListener('click', () => this.root.classList.add('hidden'));
    head.append(title, close);
    this.list = document.createElement('div');
    this.list.className = 'dis-list';
    this.root.append(head, this.list);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
    if (this.visible) this.render();
  }

  /** Chegou desastre novo: a lista é refeita (só se estiver aberta; senão, ao abrir). */
  changed(): void {
    this.dirty = true;
    if (this.visible) this.render();
  }

  private render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.list.innerHTML = '';
    if (!this.log.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'dis-empty';
      empty.textContent = 'Nenhum desastre ainda.';
      this.list.append(empty);
      return;
    }
    for (const e of this.log.entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dis-row';
      row.classList.toggle('big', e.notable);
      row.append(icon(e), document.createTextNode(entryText(e)));
      row.addEventListener('click', () => this.onGo(e.point));
      this.list.append(row);
    }
  }
}

function icon(e: LogEntry): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'dis-icon';
  s.textContent = DISASTER_ICONS[e.kind] ?? '⚠️';
  return s;
}
