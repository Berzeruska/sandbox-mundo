import { WORLD_KINDS } from './menu-state';
import type { WorldKind } from '../world/state';
/** Painéis da interface: depuração e "novo mundo". HTML simples, sem framework. */

export interface DebugStats {
  fps: number;
  frameMs: number;
  cells: number;
  n: number;
  seedText: string;
  seed: number;
  kindLabel: string;
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
  /** Memória aproximada do worker (MB). */
  memoryMb: number;
  /** Desenho completo ou simplificado (com o motivo). */
  drawing: string;
  version: string;
  /** Memória compartilhada entre a tela e o worker (teste da correção 2). */
  sharedMemory: string;
  /** Ciclo de Wilson: fase, supercontinentes e rupturas (G2). */
  cycle: string;
  /** Temperatura global (ciclo glacial + controle) e nível do mar (T7). */
  climate: string;
  /** Registro de travadas: resumo e as últimas (`stalls.ts`). */
  stalls: string[];
}

/** Painel durante a medição: escondido (só o andamento) ou aberto, com ou sem o desfoque antigo. */
export type PanelMode = 'hidden' | 'blur' | 'plain';

export class DebugPanel {
  readonly root: HTMLDivElement;
  private body: HTMLPreElement;
  private spinBtn: HTMLButtonElement;
  private benchBtn: HTMLButtonElement;
  private benchStatus: HTMLDivElement;
  private report: HTMLTextAreaElement;
  private copyBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, onToggleSpin: () => void, onBenchmark: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'panel debug-panel hidden';
    this.body = document.createElement('pre');
    const row = document.createElement('div');
    row.className = 'panel-row';
    this.spinBtn = document.createElement('button');
    this.spinBtn.type = 'button';
    this.spinBtn.className = 'panel-btn';
    this.spinBtn.addEventListener('click', onToggleSpin);
    this.setSpinning(false);
    this.benchBtn = document.createElement('button');
    this.benchBtn.type = 'button';
    this.benchBtn.className = 'panel-btn primary';
    this.benchBtn.textContent = 'Medir desempenho';
    this.benchBtn.addEventListener('click', onBenchmark);
    row.append(this.benchBtn, this.spinBtn);
    this.benchStatus = document.createElement('div');
    this.benchStatus.className = 'bench-status';
    this.benchStatus.hidden = true;
    this.report = document.createElement('textarea');
    this.report.className = 'bench-report';
    this.report.readOnly = true;
    this.report.hidden = true;
    this.copyBtn = document.createElement('button');
    this.copyBtn.type = 'button';
    this.copyBtn.className = 'panel-btn';
    this.copyBtn.textContent = 'Copiar relatório';
    this.copyBtn.hidden = true;
    this.copyBtn.addEventListener('click', () => void this.copy());
    this.root.append(this.body, row, this.benchStatus, this.report, this.copyBtn);
    parent.append(this.root);
  }

  /** Durante a medição: só a linha de andamento (o resto do painel não se atualiza nem pesa). */
  setBenchmarkRunning(status: string | null, panel: PanelMode = 'hidden'): void {
    const running = status !== null;
    this.benchBtn.disabled = running;
    this.root.classList.toggle('benchmarking', running && panel === 'hidden');
    // Diagnóstico: o desfoque por trás do painel, como era até a D2, para comparar no aparelho.
    this.root.classList.toggle('legacy-blur', running && panel === 'blur');
    this.benchStatus.hidden = !running;
    if (running) {
      this.benchStatus.textContent = status;
      this.report.hidden = true;
      this.copyBtn.hidden = true;
    }
  }

  showReport(text: string): void {
    this.report.value = text;
    this.report.hidden = false;
    this.copyBtn.hidden = false;
    this.copyBtn.textContent = 'Copiar relatório';
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.report.value);
    } catch {
      // Sem permissão de área de transferência (http na rede local): seleciona e copia à moda antiga.
      this.report.focus();
      this.report.select();
      document.execCommand('copy');
    }
    this.copyBtn.textContent = 'Copiado ✓';
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  setSpinning(on: boolean): void {
    this.spinBtn.textContent = on ? 'Parar giro' : 'Girar (fps)';
  }

  update(s: DebugStats): void {
    // Linhas curtas: o painel não pode cobrir o globo no celular (pedido do usuário, 2026-10-15).
    const hz = s.minGapMs > 0 ? Math.round(1000 / s.minGapMs) : 0;
    this.body.textContent = [
      `fps     ${s.fps.toFixed(0)} (tela ~${hz} Hz) · ${s.frameMs.toFixed(2)} ms/quadro`,
      `quadros ${s.minGapMs.toFixed(1)}–${s.maxGapMs.toFixed(1)} ms · zoom ${s.zoom.toFixed(2)}× · célula ${s.cellPixels.toFixed(1)} px`,
      `mundo   ${s.seedText} (${s.seed}) · ${s.kindLabel} · ${s.cells.toLocaleString('pt-BR')} células, N ${s.n}`,
      `geração ${s.generationTotalMs.toFixed(0)} ms (worker ${s.generationMs.toFixed(0)}): ${Object.entries(s.stagesMs).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}`,
      `worker  ${s.ticksPerSecond.toFixed(0)} passos/s · pincel ${s.brushMs.toFixed(1)} ms · ~${s.memoryMb.toFixed(0)} MB`,
      `placas  ${s.recompositions} recomposições · última ${s.geologyMs.toFixed(0)} ms`,
      `ciclo   ${s.cycle}`,
      `clima   ${s.climate}`,
      `desenho ${s.drawing} · versão ${s.version}`,
      `memória compartilhada ${s.sharedMemory}`,
      ...s.stalls,
    ].join('\n');
  }
}

export class NewWorldDialog {
  readonly root: HTMLDivElement;
  private input: HTMLInputElement;
  private kind: WorldKind = 'standard';
  private cards!: HTMLDivElement;
  private about!: HTMLDivElement;
  private title!: HTMLDivElement;
  private cancelBtn!: HTMLButtonElement;
  /** Primeira abertura: ainda não há mundo, então a escolha é obrigatória (sem cancelar). */
  private required = false;

  constructor(parent: HTMLElement, onCreate: (seedText: string, kind: WorldKind) => void) {
    this.root = document.createElement('div');
    this.root.className = 'panel world-panel hidden';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Novo mundo';
    this.title = title;
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
      onCreate(text, this.kind);
    };
    createBtn.addEventListener('click', submit);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape' && !this.required) this.hide();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'panel-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => this.hide());
    this.cancelBtn = cancelBtn;
    row.append(randomBtn, cancelBtn, createBtn);

    // Tipo de mundo (decisão do usuário, 2026-11-04: opção 2, cartões com miniatura).
    const cards = document.createElement('div');
    cards.className = 'world-kinds';
    const about = document.createElement('div');
    about.className = 'world-kind-about';
    for (const info of WORLD_KINDS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'world-kind';
      card.dataset.kind = info.kind;
      const img = document.createElement('img');
      img.src = `./tipos/${info.kind}.png`;
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = info.label;
      card.append(img, name);
      card.addEventListener('click', () => this.select(info.kind));
      cards.append(card);
    }
    this.cards = cards;
    this.about = about;
    this.select('standard');
    this.root.append(title, label, cards, about, row);
    parent.append(this.root);
  }

  private select(kind: WorldKind): void {
    this.kind = kind;
    for (const c of this.cards.children) c.classList.toggle('selected', (c as HTMLElement).dataset.kind === kind);
    this.about.textContent = WORLD_KINDS.find((k) => k.kind === kind)?.about ?? '';
  }

  show(currentSeed: string, kind: WorldKind = 'standard'): void {
    this.select(kind);
    this.input.value = currentSeed;
    this.root.classList.remove('hidden');
    this.input.focus();
    this.input.select();
  }

  /**
   * Primeira abertura (item 3 do teste da `2d9a2156`): a mesma tela, à frente de tudo, antes de nascer o
   * primeiro mundo. Sem foco no campo da semente, para o teclado de toque não subir por cima dos cartões.
   */
  showFirst(seed: string, kind: WorldKind): void {
    this.required = true;
    this.title.textContent = 'Escolha o seu mundo';
    this.cancelBtn.hidden = true;
    this.root.parentElement?.classList.add('choosing-world');
    this.select(kind);
    this.input.value = seed;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    if (this.required) {
      this.required = false;
      this.title.textContent = 'Novo mundo';
      this.cancelBtn.hidden = false;
      this.root.parentElement?.classList.remove('choosing-world');
    }
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
