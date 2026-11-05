import { ALL_RESOURCES, groupMask, RESOURCE_GROUPS, RESOURCE_INFO, type Resource, type ResourceGroup } from '../world/resources';

/**
 * Legenda da camada "Ver recursos" (T6): filtro por grupo e por tipo, cada tipo com a cor dele.
 * Tocar num grupo mostra só ele (e abre os tipos dele); tocar num tipo mostra só ele; tocar de novo
 * volta ao grupo; "Todos" mostra tudo.
 */
export interface LegendState {
  group: ResourceGroup | null;
  type: Resource | null;
}

export const LEGEND_ALL: LegendState = { group: null, type: null };

/** Tipos mostrados (bit = código do tipo). */
export function legendMask(state: LegendState): number {
  if (state.type) return (1 << state.type) >>> 0;
  if (state.group) return groupMask(state.group);
  return ALL_RESOURCES;
}

export function selectGroup(state: LegendState, group: ResourceGroup | null): LegendState {
  if (group === null || (state.group === group && !state.type)) return LEGEND_ALL;
  return { group, type: null };
}

export function selectType(state: LegendState, type: Resource): LegendState {
  if (state.type === type) return { group: state.group, type: null };
  return { group: RESOURCE_INFO[type]?.group ?? state.group, type };
}

const css = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** O pedaço da tela: fica logo acima da barra de baixo enquanto a camada está ligada. */
export class ResourceLegend {
  readonly root: HTMLDivElement;
  private groups: HTMLDivElement;
  private types: HTMLDivElement;
  private state: LegendState = LEGEND_ALL;

  constructor(
    parent: HTMLElement,
    private onMask: (mask: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'res-legend';
    this.root.hidden = true;
    this.groups = document.createElement('div');
    this.groups.className = 'res-row';
    this.types = document.createElement('div');
    this.types.className = 'res-row res-types';
    this.root.append(this.types, this.groups);
    parent.append(this.root);
    this.render();
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  private set(state: LegendState): void {
    this.state = state;
    this.render();
    this.onMask(legendMask(state));
  }

  private chip(label: string, selected: boolean, onClick: () => void, color?: readonly [number, number, number]): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `res-chip${selected ? ' on' : ''}`;
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'res-dot';
      dot.style.background = css(color);
      b.append(dot);
    }
    b.append(label);
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    const s = this.state;
    this.groups.replaceChildren(
      this.chip('Todos', !s.group && !s.type, () => this.set(LEGEND_ALL)),
      ...RESOURCE_GROUPS.map((g) => this.chip(g.label, s.group === g.id, () => this.set(selectGroup(this.state, g.id)))),
    );
    const group = s.group;
    this.types.hidden = !group;
    if (!group) {
      this.types.replaceChildren();
      return;
    }
    this.types.replaceChildren(
      ...RESOURCE_INFO.filter((r) => r.id && r.group === group).map((r) =>
        this.chip(r.name, s.type === r.id, () => this.set(selectType(this.state, r.id)), r.color),
      ),
    );
  }
}

/** Balão com o nome da jazida tocada (some sozinho). */
export class DepositTip {
  private el: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'res-tip';
    this.el.hidden = true;
    parent.append(this.el);
  }

  /** `x`, `y` em pixels CSS da página. */
  show(text: string, x: number, y: number, ms = 3000): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.el.hidden = true), ms);
  }

  hide(): void {
    this.el.hidden = true;
  }
}

/** Legenda da camada "Ver biomas" (T7): a cor de cada bioma, só para ler (tocar no mapa mostra o nome). */
export class BiomeLegend {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, names: readonly string[], colors: readonly (readonly [number, number, number])[]) {
    this.root = document.createElement('div');
    this.root.className = 'res-legend';
    this.root.hidden = true;
    const row = document.createElement('div');
    row.className = 'res-row';
    names.forEach((name, k) => {
      const chip = document.createElement('span');
      chip.className = 'res-chip';
      const dot = document.createElement('span');
      dot.className = 'res-dot';
      const c = colors[k] ?? [0, 0, 0];
      dot.style.background = css(c);
      chip.append(dot, name);
      row.append(chip);
    });
    this.root.append(row);
    parent.append(this.root);
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }
}
