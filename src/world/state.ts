import { newArray } from '../core/shared';
import { CubeSphere } from './cubesphere';
import type { Plate } from './plates';

/** Gelo pintado/apagado pelo jogador vence o clima; `Auto` segue a temperatura. */
export const IceMode = {
  Auto: 0,
  Painted: 1,
  Erased: 2,
} as const;
export type IceMode = (typeof IceMode)[keyof typeof IceMode];

export interface WorldParams {
  /** Texto digitado pelo jogador (ou o número) que originou a semente. */
  seedText: string;
  seed: number;
  /** Resolução da face do cube-sphere (N × N por face). */
  n: number;
  /** Nível do mar em metros (elevação acima disso é terra). */
  seaLevel: number;
  /** Fração alvo de terra na geração (0–1). */
  landFraction: number;
}

/**
 * Estado completo do planeta, em arrays tipados (um valor por célula).
 * A simulação escreve aqui; a renderização só lê.
 */
export class WorldState {
  readonly params: WorldParams;
  readonly grid: CubeSphere;
  readonly cellCount: number;
  /** Metros, relativos ao nível de referência (o nível do mar fica em `seaLevel`). */
  readonly elevation: Float32Array;
  /** °C, média anual. */
  readonly temperature: Float32Array;
  /** mm por ano. */
  readonly precipitation: Float32Array;
  /** Código de bioma (`Biome` em biomes.ts). */
  readonly biome: Uint8Array;
  /** 1 = coberto de gelo. */
  readonly ice: Uint8Array;
  /** `IceMode` de cada célula. */
  readonly iceMode: Uint8Array;
  /** Variação regional do clima gerada pela semente, em [-1, 1]: temperatura e chuva. */
  readonly tempNoise: Float32Array;
  readonly rainNoise: Float32Array;
  /** Placa de cada célula (índice em `plates`). */
  readonly plate: Uint8Array;
  /** Tipo de crosta (`Crust` em plates.ts). */
  readonly crust: Uint8Array;
  /** Tipo de fronteira de placa (`Boundary` em plates.ts); 0 = interior da placa. */
  readonly boundary: Uint8Array;
  plates: Plate[] = [];
  /**
   * Braços que falharam na quebra da Pangeia (geração v3): células de cada traçado. A tectônica cava
   * o vale (aulacógeno) quando as placas começam a andar.
   */
  aulacogens: number[][] = [];
  /** Distância (em células) até a água mais próxima; 0 na água. Usada pela umidade. */
  readonly waterDistance: Uint16Array;
  /** Jazida mineral de cada célula (T6, código em `resources.ts`); 0 = nenhuma. */
  readonly deposit: Uint8Array;
  /** Nível do mar atual (m): desce nas eras glaciais (T7). A geologia usa o nível de referência fixo. */
  seaLevel: number;
  /** Desvio da temperatura global (°C, ciclo glacial + controle do jogador), na média do planeta (T7). */
  climateOffset = 0;

  constructor(params: WorldParams, grid: CubeSphere = new CubeSphere(params.n)) {
    if (grid.n !== params.n) throw new Error('Grade com resolução diferente dos parâmetros');
    this.params = params;
    this.grid = grid;
    this.cellCount = grid.cellCount;
    this.seaLevel = params.seaLevel;
    this.elevation = newArray(Float32Array, this.cellCount);
    this.temperature = newArray(Float32Array, this.cellCount);
    this.precipitation = newArray(Float32Array, this.cellCount);
    this.biome = newArray(Uint8Array, this.cellCount);
    this.ice = newArray(Uint8Array, this.cellCount);
    this.iceMode = newArray(Uint8Array, this.cellCount);
    this.tempNoise = newArray(Float32Array, this.cellCount);
    this.rainNoise = newArray(Float32Array, this.cellCount);
    this.plate = newArray(Uint8Array, this.cellCount);
    this.crust = newArray(Uint8Array, this.cellCount);
    this.boundary = newArray(Uint8Array, this.cellCount);
    this.waterDistance = newArray(Uint16Array, this.cellCount);
    this.deposit = newArray(Uint8Array, this.cellCount);
  }

  isWater(i: number): boolean {
    return (this.elevation[i] as number) <= this.seaLevel;
  }

  /** Altura acima do nível do mar (negativa = profundidade). */
  heightAboveSea(i: number): number {
    return (this.elevation[i] as number) - this.seaLevel;
  }

  /**
   * Altura acima do nível de referência (o mar da geração). A geologia (crosta continental ou
   * oceânica) usa esta: o mar baixando numa era glacial não muda as placas.
   */
  heightAboveBase(i: number): number {
    return (this.elevation[i] as number) - this.params.seaLevel;
  }

  landFraction(): number {
    let land = 0;
    for (let i = 0; i < this.cellCount; i++) if (!this.isWater(i)) land++;
    return land / this.cellCount;
  }
}
