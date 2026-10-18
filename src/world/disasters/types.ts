import type { Vec3 } from '../cubesphere';

/** Tipos de desastre do M2 (`docs/M2-especificacao.md`, tabela de desastres). */
export const DisasterKind = {
  Quake: 0,
  Tsunami: 1,
  Volcano: 2,
  Drought: 3,
  Flood: 4,
  Hurricane: 5,
  Fire: 6,
  /** Raio (R3): desastre novo; o que cai em vegetação acende um incêndio. */
  Lightning: 7,
} as const;
export type DisasterKind = (typeof DisasterKind)[keyof typeof DisasterKind];

export const DISASTER_NAMES: Record<DisasterKind, string> = {
  0: 'Terremoto',
  1: 'Tsunami',
  2: 'Erupção',
  3: 'Seca',
  4: 'Enchente',
  5: 'Furacão',
  6: 'Incêndio',
  7: 'Raio',
};

/**
 * Frequência dos desastres naturais (T11; padrão "raro", decisão aprovada na especificação: um desastre
 * notável a cada ~1–2 min em 1×). O número multiplica a taxa de todos os desastres naturais; os
 * provocados pelo jogador não dependem dela.
 */
export const FREQUENCIES: readonly { label: string; factor: number }[] = [
  { label: 'Nenhum', factor: 0 },
  { label: 'Raro', factor: 1 },
  { label: 'Às vezes', factor: 2.5 },
  { label: 'Frequente', factor: 6 },
  { label: 'Muitos', factor: 15 },
];
export const DEFAULT_FREQUENCY = 1;

/**
 * Um desastre que aconteceu (vai para a tela: animação, aviso e lista). Tudo que a animação precisa
 * vai junto; a simulação já aplicou os efeitos.
 */
export interface DisasterEvent {
  id: number;
  kind: DisasterKind;
  tick: number;
  /** Ponto da esfera onde aconteceu (unitário). */
  point: Vec3;
  /** Magnitude (terremoto), índice de explosividade (erupção), categoria (furacão) ou área relativa. */
  magnitude: number;
  /** Grande: aviso na tela (T12). */
  notable: boolean;
  /** Provocado pelo jogador. */
  manual: boolean;
  /** Texto curto, ex.: "Terremoto M 7,8". */
  label: string;
  /** Raio da área atingida (rad), para a animação. */
  radius: number;
  /**
   * Pontos animados (xyz por ponto) e o instante relativo (0–1) de cada um: frente da onda do tsunami,
   * trilha do furacão.
   */
  path?: Float32Array;
  times?: Float32Array;
  /** Força em cada ponto da trilha (furacão: categoria). */
  strength?: Float32Array;
}

/** Texto de magnitude com vírgula decimal. */
export function decimal(v: number, digits = 1): string {
  return v.toFixed(digits).replace('.', ',');
}

/** Área de `cells` células (km²) num planeta do tamanho da Terra, em texto ("12 mil km²"). */
export function areaLabel(cells: number, cellCount: number): string {
  const km2 = (cells * 510e6) / cellCount;
  if (km2 >= 1e6) return `${decimal(km2 / 1e6)} milhão de km²`.replace('milhão', km2 >= 2e6 ? 'milhões' : 'milhão');
  if (km2 >= 1e4) return `${Math.round(km2 / 1e3)} mil km²`;
  return `${Math.round(km2 / 100) * 100} km²`;
}
