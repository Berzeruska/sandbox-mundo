import { Biome } from './biomes';

/**
 * Espécies do M3 (`docs/04-ecologia.md` e a tabela de `docs/M3-especificacao.md`). A ordem é a mesma dos modelos da maquete: o número da espécie vale nos dois lados.
 * Só dados: quem vive onde, quem come quem e em que quantidade. A dinâmica está em `ecology.ts`.
 */
export const SPECIES_IDS = ['rena', 'loboArtico', 'lebre', 'cervo', 'alce', 'javali', 'lobo', 'urso', 'bisao', 'antilope', 'zebra', 'elefante', 'leao', 'capivara', 'macaco', 'onca', 'jacare', 'camelo', 'cabra', 'aguia', 'cardume', 'baleia', 'cachalote', 'tubarao', 'lula', 'lulaGigante', 'dragao', 'kraken', 'baleiaBranca'] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];
export const SPECIES_COUNT = SPECIES_IDS.length;

export type Diet = 'plantas' | 'onivoro' | 'carne' | 'plancton';
export type Temper = 'arisco' | 'cacador' | 'bravo' | 'manso';

export interface SpeciesInfo {
  id: SpeciesId;
  name: string;
  biomes: readonly number[];
  diet: Diet;
  /** Presas (só quem caça). */
  prey: readonly SpeciesId[];
  /** Tamanho típico do grupo. */
  group: readonly [number, number];
  /** Densidade: indivíduos que 16 células do melhor bioma sustentam. */
  density: number;
  /** Crescimento por ano com comida sobrando. */
  growth: number;
  /** Peso como presa: quanta carne um indivíduo dá (lebre 0,2; elefante 4). */
  meat: number;
  /** Preparado para o M4 (sem uso no M3). */
  tame: boolean;
  temper: Temper;
  /** Classe mítica: só deus põe no mundo; não entra nos números. */
  mythic?: boolean;
}

const B = Biome;
const SEA = [B.ShallowOcean, B.DeepOcean], DEEP = [B.DeepOcean], DESERTS = [B.HotDesert, B.ColdDesert];
const s = (id: SpeciesId, name: string, biomes: readonly number[], diet: Diet, prey: readonly SpeciesId[], group: readonly [number, number], density: number, growth: number, meat: number, tame: boolean, temper: Temper): SpeciesInfo => ({ id, name, biomes, diet, prey, group, density, growth, meat, tame, temper });

export const SPECIES: readonly SpeciesInfo[] = [
  s('rena', 'Rena', [B.Tundra, B.Taiga], 'plantas', [], [3, 8], 8, 0.34, 1, true, 'arisco'),
  s('loboArtico', 'Lobo-ártico', [B.Tundra, B.Ice], 'carne', ['rena', 'lebre'], [2, 5], 1.0, 0.3, 0.5, true, 'cacador'),
  s('lebre', 'Lebre', [B.Tundra, B.Taiga], 'plantas', [], [1, 3], 14, 0.9, 0.2, false, 'arisco'),
  s('cervo', 'Cervo', [B.TemperateForest, B.Grassland], 'plantas', [], [2, 6], 8, 0.36, 1, false, 'arisco'),
  s('alce', 'Alce', [B.Taiga, B.TemperateForest], 'plantas', [], [1, 2], 2.5, 0.24, 2.5, false, 'bravo'),
  s('javali', 'Javali', [B.TemperateForest, B.TropicalForest], 'onivoro', [], [2, 6], 6, 0.6, 0.8, true, 'bravo'),
  s('lobo', 'Lobo', [B.Taiga, B.TemperateForest], 'carne', ['cervo', 'lebre', 'javali'], [3, 6], 1.2, 0.32, 0.5, true, 'cacador'),
  s('urso', 'Urso', [B.Taiga, B.TemperateForest], 'onivoro', [], [1, 1], 0.6, 0.2, 2, false, 'bravo'),
  s('bisao', 'Bisão', [B.Grassland, B.Steppe], 'plantas', [], [4, 12], 10, 0.3, 3, true, 'bravo'),
  s('antilope', 'Antílope', [B.Savanna, B.Grassland, B.Steppe], 'plantas', [], [4, 12], 10, 0.42, 0.7, false, 'arisco'),
  s('zebra', 'Zebra', [B.Savanna], 'plantas', [], [4, 10], 9, 0.34, 1.6, false, 'arisco'),
  s('elefante', 'Elefante', [B.Savanna], 'plantas', [], [2, 6], 2.5, 0.12, 4, true, 'bravo'),
  s('leao', 'Leão', [B.Savanna], 'carne', ['zebra', 'antilope'], [2, 6], 1.0, 0.3, 1, false, 'cacador'),
  s('capivara', 'Capivara', [B.Swamp, B.TropicalForest], 'plantas', [], [3, 8], 8, 0.6, 0.6, false, 'manso'),
  s('macaco', 'Macaco', [B.TropicalForest], 'onivoro', [], [3, 10], 10, 0.4, 0.2, false, 'arisco'),
  s('onca', 'Onça', [B.TropicalForest], 'carne', ['capivara', 'macaco', 'javali'], [1, 1], 0.5, 0.28, 1, false, 'cacador'),
  s('jacare', 'Jacaré', [B.Swamp], 'carne', ['capivara'], [1, 3], 1.2, 0.3, 1, false, 'cacador'),
  s('camelo', 'Camelo', DESERTS, 'plantas', [], [2, 5], 4, 0.2, 2, true, 'manso'),
  s('cabra', 'Cabra-montesa', [B.Mountain, B.SnowyPeak], 'plantas', [], [2, 6], 6, 0.34, 0.6, true, 'arisco'),
  s('aguia', 'Águia', [B.Mountain, B.SnowyPeak], 'carne', ['lebre', 'cabra'], [1, 1], 0.5, 0.26, 0.1, true, 'cacador'),
  s('cardume', 'Cardume', SEA, 'plancton', [], [6, 12], 60, 1.0, 0.3, false, 'arisco'),
  s('baleia', 'Baleia', DEEP, 'plancton', [], [1, 3], 0.8, 0.14, 6, false, 'manso'),
  s('cachalote', 'Cachalote', DEEP, 'carne', ['lula', 'lulaGigante'], [1, 3], 0.5, 0.2, 5, false, 'bravo'),
  s('tubarao', 'Tubarão', SEA, 'carne', ['cardume'], [1, 2], 0.7, 0.3, 1, false, 'cacador'),
  s('lula', 'Lula', SEA, 'carne', ['cardume'], [2, 6], 2, 0.6, 0.3, false, 'arisco'),
  s('lulaGigante', 'Lula-gigante', DEEP, 'carne', ['cardume'], [1, 1], 0.4, 0.26, 2, false, 'bravo'),
  { ...s('dragao', 'Dragão', [], 'carne', ['elefante', 'bisao', 'alce', 'zebra', 'cervo', 'rena', 'camelo', 'antilope'], [1, 1], 0, 0, 0, false, 'bravo'), mythic: true },
  { ...s('kraken', 'Kraken', DEEP, 'carne', ['cachalote', 'lulaGigante', 'tubarao', 'baleia'], [1, 1], 0, 0, 0, false, 'bravo'), mythic: true },
  { ...s('baleiaBranca', 'Baleia branca colossal', DEEP, 'carne', ['lulaGigante', 'lula', 'tubarao', 'cachalote'], [1, 1], 0, 0, 0, false, 'bravo'), mythic: true },
];

export function speciesIndex(id: SpeciesId): number { return SPECIES_IDS.indexOf(id); }
export function isSeaSpecies(sp: number): boolean { const b = (SPECIES[sp] as SpeciesInfo).biomes; return b.length > 0 && b.every((x) => x === B.ShallowOcean || x === B.DeepOcean); }

/** Quanto de planta cada bioma sustenta, de 0 a 1 (`docs/04-ecologia.md`, capacidade de suporte). */
export const PLANT_CAPACITY: readonly number[] = (() => {
  const c = new Array<number>(16).fill(0);
  c[B.TropicalForest] = 1; c[B.TemperateForest] = 0.85; c[B.Swamp] = 0.8; c[B.Taiga] = 0.7; c[B.Grassland] = 0.55; c[B.Savanna] = 0.5;
  c[B.Steppe] = 0.3; c[B.Tundra] = 0.2; c[B.Mountain] = 0.15; c[B.Beach] = 0.05; c[B.HotDesert] = 0.04; c[B.ColdDesert] = 0.04; c[B.SnowyPeak] = 0.03;
  return c;
})();
