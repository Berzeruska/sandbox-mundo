import { SPEEDS, speedLabel, type Speed } from '../core/time';
import { MAX_BRUSH, MIN_BRUSH } from '../input/tools';
import { DEFAULT_FREQUENCY, FREQUENCIES, type DisasterKind } from '../world/disasters/types';
import {
  CATEGORIES,
  DEFAULT_STRENGTH,
  INITIAL_MENU,
  isOn,
  itemById,
  itemsOf,
  openMenu,
  closeMenu,
  selectCategory,
  selectItem,
  SPEED_CARD,
  STRENGTHS,
  toggleMenu,
  type MenuEffect,
  type MenuState,
} from './menu-state';

import { SPECIES, type SpeciesInfo } from '../world/species';
import { TRAIT_RANGE, TRAITS } from '../world/ecology';
import { speciesIcon } from './species-icon';

/** Quantos há no mundo, em poucas letras: 950, 12 mil, 1,2 mi. */
export function countLabel(n: number): string {
  if (n < 0.5) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace('.', ',')} mil`;
  return `${(n / 1e6).toFixed(1).replace('.', ',')} mi`;
}

export interface HudCallbacks {
  onSpeed(speed: Speed): void;
  onTogglePause(): void;
  onBrushSize(size: number): void;
  /** Controle "Placas" (0 a 100%). */
  onPlateRate(percent: number): void;
  /** Controle de temperatura global (°C, T7). */
  onClimateControl(degrees: number): void;
  /** Frequência dos desastres naturais (índice de FREQUENCIES, T11). */
  onDisasterFrequency(level: number): void;
  onNorthUp(): void;
  /** Ação do menu (ex.: 'newWorld', 'debug'). */
  onAction(action: string): void;
  /** Interruptor do menu (ex.: 'platesLayer'). */
  onToggle(id: string, on: boolean): void;
  /** A visão ligada mudou (uma por vez; null: nenhuma). */
  onView(id: string | null): void;
  /** A ferramenta ativa (ou o menu) mudou. */
  onMenuChange(state: MenuState): void;
  /** Espécie escolhida no cartão "Vida" (-1: nenhuma). */
  onLifeSpecies?(species: number): void;
  /** Característica da espécie mudada por deus (1 = normal). */
  onLifeTrait?(species: number, trait: number, value: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Interface na tela (layout aprovado em docs/img/m2-t1-esboco-menu.png).
 * Fechado: data + velocidade em cima, bússola no canto, e embaixo só o cartão da ferramenta ativa,
 * a pausa e o botão do menu. Aberto: painel por categorias sobe de baixo, com a pausa e o fechar
 * no mesmo lugar para o polegar.
 * O acabamento visual fica para o Marco 8 (Embelezamento).
 */
export class Hud {
  readonly root: HTMLDivElement;
  state: MenuState = INITIAL_MENU;
  private speed: Speed = 1;
  private brushSize: number;
  private platePercent: number;
  private frequency = DEFAULT_FREQUENCY;
  private climateDegrees = 0;
  /** Força escolhida por desastre (o último escolhido fica). */
  private strengths = new Map<number, number>(Object.entries(DEFAULT_STRENGTH).map(([k, v]) => [Number(k), v as number]));
  private lastDate = '';
  /** Vida (M3): espécie escolhida, totais do mundo e características. */
  lifeSpecies = -1;
  private lifeTotals: Float32Array | null = null;
  private lifeTraits: Float32Array | null = null;

  private dateText: HTMLSpanElement;
  private speedBadge: HTMLSpanElement;
  private dim: HTMLDivElement;
  private sheet: HTMLDivElement;
  private tabs: HTMLDivElement;
  private grid: HTMLDivElement;
  private card: HTMLDivElement;
  private pauseBtn: HTMLButtonElement;
  private menuBtn: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private cb: HudCallbacks,
    initialBrushSize: number,
    initialPlatePercent: number,
  ) {
    this.brushSize = initialBrushSize;
    this.platePercent = initialPlatePercent;
    this.root = el('div', 'hud');

    const chip = el('div', 'hud-chip');
    this.dateText = el('span', 'hud-date');
    this.speedBadge = el('span', 'hud-speed-badge');
    chip.append(this.dateText, this.speedBadge);

    const north = btn('hud-north', 'Norte para cima', () => cb.onNorthUp());
    north.title = 'Norte para cima';
    north.textContent = '🧭';

    this.dim = el('div', 'hud-dim');
    this.dim.addEventListener('pointerdown', () => this.apply(closeMenu(this.state)));

    this.sheet = el('div', 'hud-sheet');
    this.tabs = el('div', 'hud-tabs');
    this.grid = el('div', 'hud-grid');
    this.sheet.append(el('div', 'hud-handle'), this.tabs, this.grid);

    const dock = el('div', 'hud-dock');
    this.card = el('div', 'hud-card');
    this.card.addEventListener('click', (e) => {
      // Tocar no cartão (fora dos controles dele) abre o menu na categoria da ferramenta.
      if ((e.target as HTMLElement).closest('input, button')) return;
      this.apply(openMenu(this.state));
    });
    this.pauseBtn = btn('hud-big hud-pause', 'Pausar', () => cb.onTogglePause());
    this.pauseBtn.title = 'Pausar';
    this.menuBtn = btn('hud-big hud-menu', 'Ferramentas', () => this.apply(toggleMenu(this.state)));
    this.menuBtn.title = 'Ferramentas';
    dock.append(this.card, this.pauseBtn, this.menuBtn);

    this.root.append(chip, north, this.dim, this.sheet, dock);
    parent.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.open) this.apply(closeMenu(this.state));
    });
    this.render();
  }

  /** Fecha o menu (o "Medir desempenho" mede o globo sem o menu por cima). */
  closeMenu(): void {
    if (this.state.open) this.apply(closeMenu(this.state));
  }

  setDate(text: string): void {
    if (text === this.lastDate) return;
    this.lastDate = text;
    this.dateText.textContent = text;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.render();
  }

  private apply(state: MenuState, effect: MenuEffect = { type: 'none' }): void {
    this.state = state;
    this.render();
    if (effect.type === 'speed') this.cb.onSpeed(effect.speed);
    if (effect.type === 'action') this.cb.onAction(effect.action);
    if (effect.type === 'toggle') this.cb.onToggle(effect.id, effect.on);
    if (effect.type === 'view') this.cb.onView(effect.id);
    this.cb.onMenuChange(state);
  }

  private choose(id: string): void {
    const { state, effect } = selectItem(this.state, id);
    this.apply(state, effect);
  }

  private setBrush(size: number): void {
    this.brushSize = size;
    for (const v of this.root.querySelectorAll<HTMLElement>('.hud-brush-value')) v.textContent = String(size);
    for (const r of this.root.querySelectorAll<HTMLInputElement>('.hud-brush-range')) r.value = String(size);
    this.cb.onBrushSize(size);
  }

  private brushSlider(): HTMLElement {
    const wrap = el('span', 'hud-brush');
    const range = el('input', 'hud-brush-range');
    range.type = 'range';
    range.min = String(MIN_BRUSH);
    range.max = String(MAX_BRUSH);
    range.value = String(this.brushSize);
    range.setAttribute('aria-label', 'Tamanho do pincel');
    range.addEventListener('input', () => this.setBrush(Number(range.value)));
    wrap.append(range, el('span', 'hud-brush-value', String(this.brushSize)));
    return wrap;
  }

  /** Controle de velocidade das placas (0 congela a geologia). */
  /** As placas mudaram sem o jogador mexer (o arquipélago ficou pronto): o controle acompanha. */
  setPlatePercent(percent: number): void {
    this.platePercent = percent;
    for (const r of this.root.querySelectorAll<HTMLInputElement>('.hud-plate-range')) r.value = String(percent);
    for (const v of this.root.querySelectorAll<HTMLElement>('.hud-plate-value')) v.textContent = `${percent}%`;
  }

  private plateSlider(): HTMLElement {
    const wrap = el('span', 'hud-brush');
    const range = el('input', 'hud-brush-range hud-plate-range');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(this.platePercent);
    range.setAttribute('aria-label', 'Velocidade das placas');
    const value = el('span', 'hud-brush-value hud-plate-value', `${this.platePercent}%`);
    range.addEventListener('input', () => {
      this.platePercent = Number(range.value);
      for (const v of this.root.querySelectorAll<HTMLElement>('.hud-plate-value')) v.textContent = `${this.platePercent}%`;
      this.cb.onPlateRate(this.platePercent);
    });
    wrap.append(range, value);
    return wrap;
  }

  /** Força escolhida para provocar o desastre (magnitude ou categoria), ou undefined se ele não tem. */
  strengthOf(kind: DisasterKind): number | undefined {
    return STRENGTHS[kind] ? this.strengths.get(kind) : undefined;
  }

  /** Fileira de força do desastre (R2): M 6 · 7 · 8 · 9 · 9,5, ou Ciclone 1 · 2 · Furacão 3 · 4 · 5. */
  private strengthChoices(kind: DisasterKind): HTMLElement | null {
    const choices = STRENGTHS[kind];
    if (!choices) return null;
    const wrap = el('span', 'hud-freq hud-strength');
    for (const c of choices) {
      const b = btn('hud-speed hud-strength-choice', `${c.label}${c.sub ? ` ${c.sub}` : ''}`, () => {
        this.strengths.set(kind, c.value);
        for (const o of wrap.querySelectorAll<HTMLElement>('.hud-strength-choice')) o.classList.toggle('selected', o === b);
      });
      b.append(el('span', '', c.label));
      if (c.sub) b.append(el('small', '', c.sub));
      b.classList.toggle('selected', this.strengths.get(kind) === c.value);
      wrap.append(b);
    }
    return wrap;
  }

  /** Frequência dos desastres naturais: Nenhum, Raro, Às vezes, Frequente, Muitos (T11). */
  private frequencyChoices(): HTMLElement {
    const wrap = el('span', 'hud-freq');
    FREQUENCIES.forEach((f, level) => {
      const b = btn('hud-speed hud-freq-choice', `Frequência ${f.label}`, () => {
        this.frequency = level;
        for (const c of this.root.querySelectorAll<HTMLElement>('.hud-freq-choice')) c.classList.toggle('selected', c.dataset.level === String(level));
        this.cb.onDisasterFrequency(level);
      });
      b.dataset.level = String(level);
      b.textContent = f.label;
      b.classList.toggle('selected', level === this.frequency);
      wrap.append(b);
    });
    return wrap;
  }

  /** Controle de temperatura global, −10 a +10 °C (T7). Manda ao soltar (refazer o clima custa). */
  private climateSlider(): HTMLElement {
    const wrap = el('span', 'hud-brush');
    const range = el('input', 'hud-brush-range hud-climate-range');
    range.type = 'range';
    range.min = '-10';
    range.max = '10';
    range.step = '1';
    range.value = String(this.climateDegrees);
    range.setAttribute('aria-label', 'Temperatura global');
    const label = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} °C`;
    const value = el('span', 'hud-brush-value hud-climate-value', label(this.climateDegrees));
    range.addEventListener('input', () => {
      this.climateDegrees = Number(range.value);
      for (const v of this.root.querySelectorAll<HTMLElement>('.hud-climate-value')) v.textContent = label(this.climateDegrees);
      // Manda já ao arrastar: o clima anda até o valor aos poucos (sem salto ao soltar).
      this.cb.onClimateControl(this.climateDegrees);
    });
    wrap.append(range, value);
    return wrap;
  }

  /** Totais do ano (a grade do cartão "Vida" mostra quantos há de cada espécie). */
  setLife(totals: Float32Array, traits: Float32Array): void {
    this.lifeTotals = totals;
    this.lifeTraits = traits;
    for (const e of this.root.querySelectorAll<HTMLElement>('.hud-species-count')) e.textContent = countLabel(totals[Number(e.dataset.species)] ?? 0);
  }

  private speciesName(): string { return this.lifeSpecies >= 0 ? (SPECIES[this.lifeSpecies] as SpeciesInfo).name : ''; }

  /** Grade das espécies: o ícone é o próprio modelo; tocar escolhe (e mostra no globo onde ela vive). */
  private speciesGrid(): HTMLElement {
    const wrap = el('div', 'hud-species');
    SPECIES.forEach((sp, i) => {
      const b = btn('hud-species-tile', sp.name, () => {
        this.lifeSpecies = this.lifeSpecies === i ? -1 : i;
        this.cb.onLifeSpecies?.(this.lifeSpecies);
        this.render();
      });
      b.classList.toggle('on', i === this.lifeSpecies);
      b.classList.toggle('mythic', sp.mythic === true);
      const count = el('small', 'hud-species-count', countLabel(this.lifeTotals?.[i] ?? 0));
      count.dataset.species = String(i);
      b.append(speciesIcon(i), el('span', '', sp.name), count);
      wrap.append(b);
    });
    return wrap;
  }

  /** As cinco características da espécie escolhida, de 50% a 200%. */
  private traitSliders(): HTMLElement {
    const wrap = el('span', 'hud-traits'), s = this.lifeSpecies;
    TRAITS.forEach((name, t) => {
      const row = el('label', 'hud-trait'), range = el('input', 'hud-brush-range');
      const now = Math.round((this.lifeTraits?.[s * TRAITS.length + t] ?? 1) * 100);
      range.type = 'range'; range.min = String(TRAIT_RANGE[0] * 100); range.max = String(TRAIT_RANGE[1] * 100); range.step = '10'; range.value = String(now);
      range.setAttribute('aria-label', name);
      const value = el('span', 'hud-brush-value', `${now}%`);
      range.addEventListener('input', () => {
        value.textContent = `${range.value}%`;
        if (this.lifeTraits) this.lifeTraits[s * TRAITS.length + t] = Number(range.value) / 100;
        this.cb.onLifeTrait?.(s, t, Number(range.value) / 100);
      });
      row.append(el('span', '', name), range, value);
      wrap.append(row);
    });
    return wrap;
  }

  private render(): void {
    const paused = this.speed === 0;
    this.speedBadge.textContent = paused ? 'pausado' : speedLabel(this.speed);
    this.speedBadge.classList.toggle('paused', paused);
    this.pauseBtn.innerHTML = '';
    this.pauseBtn.append(el('span', 'hud-big-icon', paused ? '▶' : '⏸'), el('small', '', paused ? 'seguir' : 'pausa'));
    this.pauseBtn.setAttribute('aria-label', paused ? 'Continuar' : 'Pausar');
    this.pauseBtn.title = paused ? 'Continuar' : 'Pausar';

    const open = this.state.open;
    this.root.classList.toggle('menu-open', open);
    this.menuBtn.innerHTML = '';
    this.menuBtn.append(el('span', 'hud-big-icon', open ? '✕' : '☰'), el('small', '', open ? 'fechar' : 'menu'));
    this.menuBtn.setAttribute('aria-label', open ? 'Fechar ferramentas' : 'Ferramentas');

    this.renderCard();
    if (open) this.renderSheet();
  }

  private renderCard(): void {
    const card = this.card;
    card.innerHTML = '';
    if (this.state.active === SPEED_CARD) {
      card.classList.add('speeds');
      for (const speed of SPEEDS.filter((s) => s !== 0)) {
        const b = btn('hud-speed', `Velocidade ${speedLabel(speed)}`, () => this.cb.onSpeed(speed));
        b.textContent = speedLabel(speed);
        b.classList.toggle('selected', speed === this.speed);
        card.append(b);
      }
      return;
    }
    card.classList.remove('speeds');
    const item = itemById(this.state.active);
    if (!item) return;
    card.append(el('span', 'hud-card-icon', item.icon));
    const name = el('span', 'hud-card-name', item.label);
    if (item.brush !== undefined) {
      name.append(el('small', '', 'pincel'));
      card.append(name, this.brushSlider());
    } else if (item.id === 'temperature') {
      name.textContent = 'Temperatura';
      name.append(el('small', '', 'global, somada ao ciclo'));
      card.append(name, this.climateSlider());
    } else if (item.disaster !== undefined) {
      name.append(el('small', '', 'toque no globo'));
      card.append(name);
      const row = this.strengthChoices(item.disaster);
      if (row) card.append(row);
    } else if (item.id === 'lifePlace') {
      name.append(el('small', '', this.lifeSpecies >= 0 ? `toque para pôr: ${this.speciesName()}` : 'escolha a espécie no menu Vida'));
      card.append(name);
    } else if (item.id === 'lifeKill') {
      name.append(el('small', '', `toque para matar: ${this.lifeSpecies >= 0 ? this.speciesName() : 'todas as espécies'}`));
      card.append(name, this.brushSlider());
    } else if (item.id === 'lifeFollow') {
      name.append(el('small', '', 'aproxime e toque num animal'));
      card.append(name);
    } else if (item.id === 'lifeTraits') {
      name.textContent = this.lifeSpecies >= 0 ? this.speciesName() : 'Mudar';
      name.append(el('small', '', this.lifeSpecies >= 0 ? 'vale para a espécie inteira' : 'escolha a espécie no menu Vida'));
      card.append(name);
      if (this.lifeSpecies >= 0) card.append(this.traitSliders());
    } else if (item.id === 'disasterFreq') {
      name.textContent = 'Desastres';
      name.append(el('small', '', 'frequência'));
      card.append(name, this.frequencyChoices());
    } else if (item.id === 'plateSpeed') {
      name.textContent = 'Placas';
      name.append(el('small', '', this.platePercent === 0 ? 'congeladas' : 'velocidade'));
      card.append(name, this.plateSlider());
    } else {
      name.append(el('small', '', 'girar e aproximar'));
      card.append(name);
    }
  }

  private renderSheet(): void {
    this.tabs.innerHTML = '';
    for (const c of CATEGORIES) {
      const t = btn('hud-tab', c.label, () => this.apply(selectCategory(this.state, c.id)));
      t.classList.toggle('on', c.id === this.state.category);
      t.append(el('span', 'hud-tab-icon', c.icon), el('span', '', c.label));
      this.tabs.append(t);
    }

    this.grid.innerHTML = '';
    for (const item of itemsOf(this.state.category)) {
      const tile = btn('hud-tile', item.label, () => this.choose(item.id));
      const selected =
        item.kind === 'speed'
          ? this.state.active === SPEED_CARD && item.speed === this.speed
          : item.kind === 'toggle'
            ? isOn(this.state, item.id)
            : item.id === this.state.active;
      tile.classList.toggle('on', selected);
      tile.classList.toggle('soon', !item.available);
      tile.disabled = !item.available;
      tile.append(el('span', 'hud-tile-icon', item.icon), el('span', '', item.label));
      if (!item.available) tile.append(el('span', 'hud-soon', 'em breve'));
      this.grid.append(tile);
    }
    if (this.state.category === 'relevo') {
      const row = el('div', 'hud-row');
      row.append(el('span', '', 'Pincel'), this.brushSlider());
      this.grid.append(row);
    }
    if (this.state.category === 'geologia') {
      const row = el('div', 'hud-row');
      row.append(el('span', '', 'Placas'), this.plateSlider());
      this.grid.append(row);
    }
    if (this.state.category === 'vida') this.grid.append(this.speciesGrid());
    if (this.state.category === 'desastres') {
      const row = el('div', 'hud-row');
      row.append(el('span', '', 'Frequência'), this.frequencyChoices());
      this.grid.append(row);
    }
  }
}
