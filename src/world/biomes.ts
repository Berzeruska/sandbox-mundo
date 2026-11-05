/** Biomas do jogo (lista de docs/03-mundo-geologia.md). O número é o que fica guardado por célula. */
export const Biome = {
  DeepOcean: 0,
  ShallowOcean: 1,
  Beach: 2,
  Ice: 3,
  Tundra: 4,
  Taiga: 5,
  TemperateForest: 6,
  Grassland: 7,
  Steppe: 8,
  HotDesert: 9,
  ColdDesert: 10,
  Savanna: 11,
  TropicalForest: 12,
  Swamp: 13,
  Mountain: 14,
  SnowyPeak: 15,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export interface BiomeInfo {
  name: string;
  /** Cor do pixel (RGB). */
  color: readonly [number, number, number];
  /** Intensidade da textura de detalhe desenhada pelo shader (0 = liso). Só visual. */
  detail: number;
}

/** Paleta única e consultável, indexada pelo código do bioma. */
export const BIOME_INFO: readonly BiomeInfo[] = [
  { name: 'Oceano profundo', color: [22, 52, 110], detail: 0.03 },
  { name: 'Oceano raso', color: [44, 98, 160], detail: 0.04 },
  { name: 'Praia', color: [226, 210, 150], detail: 0.05 },
  { name: 'Gelo', color: [236, 244, 250], detail: 0.08 },
  { name: 'Tundra', color: [150, 158, 128], detail: 0.07 },
  { name: 'Taiga', color: [56, 96, 70], detail: 0.12 },
  { name: 'Floresta temperada', color: [46, 118, 48], detail: 0.12 },
  { name: 'Campo', color: [138, 186, 80], detail: 0.06 },
  { name: 'Estepe', color: [184, 178, 112], detail: 0.06 },
  { name: 'Deserto quente', color: [232, 200, 128], detail: 0.06 },
  { name: 'Deserto frio', color: [172, 154, 132], detail: 0.06 },
  { name: 'Savana', color: [204, 178, 74], detail: 0.07 },
  { name: 'Floresta tropical', color: [18, 98, 40], detail: 0.12 },
  { name: 'Pântano', color: [76, 104, 72], detail: 0.1 },
  { name: 'Montanha', color: [124, 112, 100], detail: 0.12 },
  { name: 'Pico nevado', color: [222, 226, 232], detail: 0.05 },
];

export const BIOME_COUNT = BIOME_INFO.length;

/** Abaixo desta profundidade (m) o oceano é profundo. */
export const SHALLOW_DEPTH = 200;
/** Altura (m acima do mar) a partir da qual é montanha. */
export const MOUNTAIN_HEIGHT = 2000;
/** Altura (m) a partir da qual montanha fria vira pico nevado. */
export const PEAK_HEIGHT = 3200;
/**
 * Chuva mínima (mm/ano) para haver neve e geleira na montanha (T7, pedido do usuário: neve depende da
 * altura, da latitude e da chuva). Montanha alta e seca fica rocha.
 */
export const SNOW_MIN_PRECIP = 250;
/** Até esta altura (m), terra encostada na água pode ser praia. */
export const BEACH_HEIGHT = 25;
/** Pântano só em terra baixa (m). */
export const SWAMP_MAX_HEIGHT = 300;
/** Baixada quente e úmida vira pântano/mangue: altura máxima (m), chuva mínima e temperatura mínima. */
export const WETLAND_MAX_HEIGHT = 60;
export const WETLAND_MIN_PRECIP = 1600;
export const WETLAND_MIN_TEMP = 12;

/**
 * Bioma climático da terra firme, só por temperatura (°C) × precipitação (mm/ano).
 * Inspirado no diagrama de Whittaker.
 */
export function classifyClimate(temp: number, precip: number): Biome {
  if (temp < -2) return precip < 80 ? Biome.ColdDesert : Biome.Tundra;
  if (temp < 4) return precip < 150 ? Biome.ColdDesert : Biome.Taiga;
  if (temp < 18) {
    if (precip < 180) return Biome.ColdDesert;
    if (precip < 450) return Biome.Steppe;
    if (precip < 900) return Biome.Grassland;
    if (precip < 2200) return Biome.TemperateForest;
    return Biome.Swamp;
  }
  if (precip < 300) return Biome.HotDesert;
  if (precip < 1300) return Biome.Savanna;
  if (precip < 2500) return Biome.TropicalForest;
  return Biome.Swamp;
}

export interface CellClimate {
  /** Metros acima do nível do mar (negativo = profundidade). */
  height: number;
  temp: number;
  precip: number;
  ice: boolean;
  /** Encostada em alguma célula de água. */
  nearWater: boolean;
}

/** Bioma final de uma célula, considerando água, gelo, relevo e clima. */
export function classifyCell(c: CellClimate): Biome {
  if (c.ice) return Biome.Ice;
  if (c.height <= 0) return -c.height > SHALLOW_DEPTH ? Biome.DeepOcean : Biome.ShallowOcean;
  if (c.height >= PEAK_HEIGHT && c.temp < 0 && c.precip >= SNOW_MIN_PRECIP) return Biome.SnowyPeak;
  if (c.height >= MOUNTAIN_HEIGHT) return Biome.Mountain;
  if (c.nearWater && c.height <= BEACH_HEIGHT && c.temp > 0) return Biome.Beach;
  if (c.height <= WETLAND_MAX_HEIGHT && c.precip >= WETLAND_MIN_PRECIP && c.temp >= WETLAND_MIN_TEMP) {
    return Biome.Swamp;
  }
  const b = classifyClimate(c.temp, c.precip);
  if (b === Biome.Swamp && c.height > SWAMP_MAX_HEIGHT) {
    return c.temp < 18 ? Biome.TemperateForest : Biome.TropicalForest;
  }
  return b;
}
