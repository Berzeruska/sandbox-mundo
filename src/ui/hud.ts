import { MAX_BRUSH, MIN_BRUSH, TOOL_INFO, type Tool } from '../input/tools';
import type { InputMode } from '../input/pointer';
import { SPEEDS, speedLabel, type Speed } from '../core/time';

export interface HudCallbacks {
  onModeToggle(): void;
  onTool(tool: Tool): void;
  onBrushSize(size: number): void;
  onSpeed(speed: Speed): void;
}

function button(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hud-btn';
  const i = document.createElement('span');
  i.className = 'hud-icon';
  i.textContent = icon;
  const l = document.createElement('span');
  l.className = 'hud-label';
  l.textContent = label;
  b.append(i, l);
  b.addEventListener('click', onClick);
  return b;
}

/** Interface na tela (HTML simples por cima do globo). */
export class Hud {
  readonly root: HTMLDivElement;
  private modeBtn: HTMLButtonElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private sizeInput: HTMLInputElement;
  private sizeValue: HTMLSpanElement;
  private dateText: HTMLDivElement;
  private speedBtns = new Map<Speed, HTMLButtonElement>();
  private lastDate = '';

  constructor(parent: HTMLElement, cb: HudCallbacks, initialSize: number) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const tools = document.createElement('div');
    tools.className = 'hud-bar hud-tools';
    this.modeBtn = button('✋', 'Mover', () => cb.onModeToggle());
    this.modeBtn.classList.add('hud-mode');
    tools.append(this.modeBtn);
    for (const info of TOOL_INFO) {
      const b = button(info.icon, info.label, () => cb.onTool(info.tool));
      this.toolBtns.set(info.tool, b);
      tools.append(b);
    }

    const size = document.createElement('label');
    size.className = 'hud-size';
    this.sizeInput = document.createElement('input');
    this.sizeInput.type = 'range';
    this.sizeInput.min = String(MIN_BRUSH);
    this.sizeInput.max = String(MAX_BRUSH);
    this.sizeInput.value = String(initialSize);
    this.sizeInput.setAttribute('aria-label', 'Tamanho do pincel');
    this.sizeValue = document.createElement('span');
    this.sizeValue.className = 'hud-size-value';
    this.sizeValue.textContent = String(initialSize);
    this.sizeInput.addEventListener('input', () => {
      this.sizeValue.textContent = this.sizeInput.value;
      cb.onBrushSize(Number(this.sizeInput.value));
    });
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'hud-label';
    sizeLabel.textContent = 'Pincel';
    size.append(sizeLabel, this.sizeInput, this.sizeValue);
    tools.append(size);

    const time = document.createElement('div');
    time.className = 'hud-bar hud-time';
    this.dateText = document.createElement('div');
    this.dateText.className = 'hud-date';
    time.append(this.dateText);
    for (const speed of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hud-btn hud-speed';
      b.textContent = speedLabel(speed);
      b.setAttribute('aria-label', speed === 0 ? 'Pausar' : `Velocidade ${speedLabel(speed)}`);
      b.addEventListener('click', () => cb.onSpeed(speed));
      this.speedBtns.set(speed, b);
      time.append(b);
    }

    this.root.append(time, tools);
    parent.append(this.root);
  }

  setMode(mode: InputMode): void {
    const icon = this.modeBtn.querySelector('.hud-icon');
    const label = this.modeBtn.querySelector('.hud-label');
    if (icon) icon.textContent = mode === 'move' ? '✋' : '🖌️';
    if (label) label.textContent = mode === 'move' ? 'Mover' : 'Pintar';
    this.modeBtn.classList.toggle('active', mode === 'paint');
    this.root.classList.toggle('painting', mode === 'paint');
  }

  setDate(text: string): void {
    if (text === this.lastDate) return;
    this.lastDate = text;
    this.dateText.textContent = text;
  }

  setSpeed(speed: Speed): void {
    for (const [s, b] of this.speedBtns) b.classList.toggle('selected', s === speed);
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolBtns) b.classList.toggle('selected', t === tool);
  }
}
