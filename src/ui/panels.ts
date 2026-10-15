/** Painéis da interface: depuração e "novo mundo". HTML simples, sem framework. */

export interface DebugStats {
  fps: number;
  frameMs: number;
  cells: number;
  n: number;
  seedText: string;
  seed: number;
  generationMs: number;
  /** Do pedido até o globo aparecer (ms), medido na thread principal. */
  generationTotalMs: number;
  stagesMs: Record<string, number>;
  /** Menor e maior intervalo entre quadros no último meio segundo (ms). */
  minGapMs: number;
  maxGapMs: number;
  zoom: number;
  cellPixels: number;
  /** Passos de simulação por segundo no worker. */
  ticksPerSecond: number;
  /** Tempo da última pincelada no worker (ms). */
  brushMs: number;
  /** Última recomposição das placas, com clima e cores (ms), e quantas já houve. */
  geologyMs: number;
  recompositions: number;
}

export class DebugPanel {
  readonly root: HTMLDivElement;
  private body: HTMLPreElement;
  private spinBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, onToggleSpin: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'panel debug-panel hidden';
    this.body = document.createElement('pre');
    this.spinBtn = document.createElement('button');
    this.spinBtn.type = 'button';
    this.spinBtn.className = 'panel-btn';
    this.spinBtn.addEventListener('click', onToggleSpin);
    this.setSpinning(false);
    this.root.append(this.body, this.spinBtn);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  setSpinning(on: boolean): void {
    this.spinBtn.textContent = on ? 'Parar giro de teste' : 'Girar sem parar (medir fps)';
  }

  update(s: DebugStats): void {
    this.body.textContent = [
      `fps          ${s.fps.toFixed(0)}   (tela ~${s.minGapMs > 0 ? Math.round(1000 / s.minGapMs) : 0} Hz)`,
      `ms/quadro    ${s.frameMs.toFixed(2)}`,
      `intervalo    mín ${s.minGapMs.toFixed(1)} · máx ${s.maxGapMs.toFixed(1)} ms`,
      `células      ${s.cells.toLocaleString('pt-BR')} (6 × ${s.n}²)`,
      `semente      ${s.seedText} (${s.seed})`,
      `geração      ${s.generationTotalMs.toFixed(0)} ms total (worker ${s.generationMs.toFixed(0)})`,
      `  etapas     ${Object.entries(s.stagesMs).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}`,
      `zoom         ${s.zoom.toFixed(2)}× · célula ${s.cellPixels.toFixed(1)} px`,
      `worker       ${s.ticksPerSecond.toFixed(0)} passos/s · pincel ${s.brushMs.toFixed(1)} ms`,
      `placas       ${s.recompositions} recomposições · última ${s.geologyMs.toFixed(0)} ms`,
    ].join('\n');
  }
}

export class NewWorldDialog {
  readonly root: HTMLDivElement;
  private input: HTMLInputElement;

  constructor(parent: HTMLElement, onCreate: (seedText: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'panel world-panel hidden';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Novo mundo';
    const label = document.createElement('label');
    label.className = 'panel-label';
    label.textContent = 'Semente (número ou palavra)';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'panel-input';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    label.append(this.input);

    const row = document.createElement('div');
    row.className = 'panel-row';
    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.className = 'panel-btn';
    randomBtn.textContent = '🎲 Aleatória';
    randomBtn.addEventListener('click', () => {
      this.input.value = randomSeedText();
    });
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'panel-btn primary';
    createBtn.textContent = 'Criar';
    const submit = (): void => {
      const text = this.input.value.trim() || randomSeedText();
      this.hide();
      onCreate(text);
    };
    createBtn.addEventListener('click', submit);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') this.hide();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'panel-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => this.hide());
    row.append(randomBtn, cancelBtn, createBtn);

    this.root.append(title, label, row);
    parent.append(this.root);
  }

  show(currentSeed: string): void {
    this.input.value = currentSeed;
    this.root.classList.remove('hidden');
    this.input.focus();
    this.input.select();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.input.blur();
  }

  toggle(currentSeed: string): void {
    if (this.root.classList.contains('hidden')) this.show(currentSeed);
    else this.hide();
  }
}

/**
 * Semente nova para o botão "aleatória". Usa o sorteio do navegador porque é a escolha do
 * jogador, não a simulação: o mundo em si continua 100% determinado pela semente.
 */
export function randomSeedText(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] as number) % 1_000_000);
}
