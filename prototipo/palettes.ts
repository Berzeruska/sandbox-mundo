import { Biome } from '../src/world/biomes';
import { RESOURCE_INFO } from '../src/world/resources';
import type { LightStyle } from './chunks';
import type { Palette } from './detail';
import type { RGB } from './styles';

/**
 * Item 1.3: as cores da "Hora dourada" com a luz de meio-dia da "Maquete viva", biomas mais fortes e saturados, vivos como o
 * verde do cacto. Seis opções para escolher; nenhuma entra no jogo antes da escolha.
 */
export const NOON: LightStyle = {
  sun: [-0.55, 0.72, -0.42],
  sunColor: [0.72, 0.67, 0.56],
  sky: [0.46, 0.5, 0.58],
  ground: [0.4, 0.36, 0.3],
  background: [0.53, 0.72, 0.85],
};

const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

export interface PaletteOption { id: string; name: string; blurb: string; hex: readonly number[]; leaves: Partial<Record<number, readonly number[]>> }

/** Ordem de `Biome`: mar fundo, mar raso, praia, gelo, tundra, taiga, floresta, campo, estepe, deserto, deserto frio, savana, tropical, pântano, montanha, pico. */
export const PALETTES: readonly PaletteOption[] = [
  {
    id: 'p1', name: '1 — Dourada forte', blurb: 'As cores da D com a saturação aumentada por igual. A mais fiel ao que você escolheu.',
    hex: [0x0f3f92, 0x1a70bc, 0xf2c97c, 0xeef0f4, 0xa6a35f, 0x1f7d4a, 0x3b9c2a, 0x9bc92f, 0xd4b13f, 0xf5b04c, 0xcdac7c, 0xd3a22f, 0x1e8f2f, 0x47823d, 0x8f7560, 0xf2eeee],
    leaves: { [Biome.Taiga]: [0x17693d, 0x1f7d4a, 0x155f39], [Biome.TemperateForest]: [0x2f8a26, 0x3f9f2c, 0x28801f], [Biome.TropicalForest]: [0x168a2c, 0x1fa036, 0x107a26], [Biome.Savanna]: [0x5f9a28, 0x6faa2c], [Biome.HotDesert]: [0x7fb83a, 0x6fa832] },
  },
  {
    id: 'p2', name: '2 — Verde-cacto', blurb: 'Todos os verdes puxados para o do cacto; desertos e secos em ouro.',
    hex: [0x0b4aa8, 0x1488d8, 0xffd67a, 0xf1f6fb, 0xb4b354, 0x239a55, 0x62c22c, 0xa6e22e, 0xe4cb36, 0xffb739, 0xdcc07a, 0xe6ac20, 0x28b53a, 0x5e9e30, 0x9a7a5c, 0xf8f6f6],
    leaves: { [Biome.Taiga]: [0x1b8a49, 0x239a55, 0x187c44], [Biome.TemperateForest]: [0x4fae22, 0x62c22c, 0x469e20], [Biome.TropicalForest]: [0x1fa030, 0x28b53a, 0x198f2c], [Biome.Savanna]: [0x7cb82a, 0x8cc832], [Biome.HotDesert]: [0x8ccb3a, 0x7fbe34] },
  },
  {
    id: 'p3', name: '3 — Cartaz', blurb: 'Cada bioma com um matiz só dele, o mais separado possível do vizinho.',
    hex: [0x0a3a9c, 0x12a0dc, 0xffe08a, 0xf4f8ff, 0x9c8fa8, 0x0f8a78, 0x2fa82c, 0xb2dc26, 0xf0d020, 0xff9a26, 0xc8a890, 0xe8b018, 0x0c9a50, 0x6a8a1c, 0xa06a50, 0xffffff],
    leaves: { [Biome.Taiga]: [0x0c7a6a, 0x0f8a78, 0x0a6a5e], [Biome.TemperateForest]: [0x249a22, 0x2fa82c, 0x1f8c1e], [Biome.TropicalForest]: [0x0a8a46, 0x0c9a50, 0x08783e], [Biome.Savanna]: [0x7ea818, 0x90b81c], [Biome.HotDesert]: [0x8ccb3a, 0x7fbe34] },
  },
  {
    id: 'p4', name: '4 — Quente e frio', blurb: 'Clima na cara: frio azulado, temperado verde, seco e quente puxado ao vermelho.',
    hex: [0x08389a, 0x1878c8, 0xf8c070, 0xe6f4ff, 0x8fa8a0, 0x1a8088, 0x3ca63a, 0x98cf34, 0xdcb030, 0xf98a30, 0xb8b0a8, 0xe89a20, 0x1c9c34, 0x3a8a58, 0x8a6a68, 0xeaf4ff],
    leaves: { [Biome.Taiga]: [0x156f76, 0x1a8088, 0x12636a], [Biome.TemperateForest]: [0x329430, 0x3ca63a, 0x2c882a], [Biome.TropicalForest]: [0x188a2c, 0x1c9c34, 0x147a28], [Biome.Savanna]: [0x7aa42a, 0x8ab42e], [Biome.HotDesert]: [0x8ccb3a, 0x7fbe34] },
  },
  {
    id: 'p5', name: '5 — Folha-mestra viva', blurb: 'Tirada das suas folhas (folha-mestra e grade de 16 biomas), com a saturação aumentada.',
    hex: [0x113f8c, 0x2a8cc4, 0xf5cd82, 0xf0f2f6, 0x9c9a4a, 0x2e8a30, 0x5ab81e, 0x96d81c, 0xdcbe2e, 0xfaa53c, 0xd0b888, 0xc4b420, 0x38a828, 0x5c9428, 0x8e6c50, 0xf6f6f8],
    leaves: { [Biome.Taiga]: [0x1f7a30, 0x2a8a36, 0x186c2a], [Biome.TemperateForest]: [0x2f9628, 0x3ca82e, 0x288a24], [Biome.TropicalForest]: [0x2f9c22, 0x3eb02a, 0x278c1e], [Biome.Savanna]: [0x4f9a26, 0x5faa2c], [Biome.HotDesert]: [0x7fc23a, 0x6fb232] },
  },
  {
    id: 'p6', name: '6 — Mapa de guerra', blurb: 'Chapada e escura nas matas, como a sua referência C do 2D: contraste alto entre floresta e campo.',
    hex: [0x0a3480, 0x1660b0, 0xeec070, 0xe8eef8, 0x8e9060, 0x0f5a34, 0x167a26, 0x4aa82a, 0xc8b034, 0xfbae40, 0xb8a078, 0xd09a20, 0x0a7026, 0x34702c, 0x7c6c64, 0xfafafa],
    leaves: { [Biome.Taiga]: [0x0c4e2c, 0x0f5a34, 0x0a4426], [Biome.TemperateForest]: [0x126a20, 0x167a26, 0x0f5e1c], [Biome.TropicalForest]: [0x08601f, 0x0a7026, 0x06521a], [Biome.Savanna]: [0x3a8a24, 0x4a9a2a], [Biome.HotDesert]: [0x6fae32, 0x60a02c] },
  },
];

export function paletteOf(option: PaletteOption): Palette {
  const biome = option.hex.map(rgb);
  const leaves: Partial<Record<number, readonly RGB[]>> = {};
  for (const [k, v] of Object.entries(option.leaves)) leaves[Number(k)] = (v as readonly number[]).map(rgb);
  return {
    biome,
    deep: biome[Biome.DeepOcean] as RGB,
    shallow: biome[Biome.ShallowOcean] as RGB,
    side: rgb(0x9a6a42),
    sideLow: rgb(0x6a4630),
    road: rgb(0xb8a688),
    roofs: [rgb(0xc8503a), rgb(0xb5442f), rgb(0xd46a43), rgb(0x8f5a3c)],
    walls: [rgb(0xf0e6d2), rgb(0xe6d6b8), rgb(0xd8d8d0)],
    trunk: rgb(0x6b4a30),
    leaves,
    resources: RESOURCE_INFO.map((r) => [(r.color[0] as number) / 255, (r.color[1] as number) / 255, (r.color[2] as number) / 255] as RGB),
  };
}

/** Pares de biomas que costumam encostar um no outro no mundo. */
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [Biome.Tundra, Biome.Taiga], [Biome.Taiga, Biome.TemperateForest], [Biome.TemperateForest, Biome.Grassland], [Biome.Grassland, Biome.Steppe],
  [Biome.Steppe, Biome.HotDesert], [Biome.HotDesert, Biome.Savanna], [Biome.Savanna, Biome.TropicalForest], [Biome.TropicalForest, Biome.Swamp],
  [Biome.Grassland, Biome.Savanna], [Biome.Steppe, Biome.ColdDesert], [Biome.Mountain, Biome.Taiga], [Biome.TemperateForest, Biome.Swamp],
];

function lab(c: RGB): [number, number, number] {
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = f(c[0]), g = f(c[1]), b = f(c[2]);
  const g3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = g3((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505), y = g3(0.2126 * r + 0.7152 * g + 0.0722 * b), z = g3((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Distância perceptiva entre vizinhos (a menor e a média; maior = mais diferente) e saturação média dos biomas de terra. */
export function paletteMetrics(hex: readonly number[]): { minDelta: number; pair: string; meanDelta: number; saturation: number } {
  const names = ['mar fundo', 'mar raso', 'praia', 'gelo', 'tundra', 'taiga', 'floresta', 'campo', 'estepe', 'deserto', 'deserto frio', 'savana', 'tropical', 'pântano', 'montanha', 'pico'];
  let min = Infinity, sum = 0, pair = '';
  for (const [a, b] of NEIGHBORS) {
    const la = lab(rgb(hex[a] as number)), lb = lab(rgb(hex[b] as number));
    const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    sum += d;
    if (d < min) { min = d; pair = `${names[a]}/${names[b]}`; }
  }
  let sat = 0;
  for (let b = 4; b < 14; b++) {
    const c = lab(rgb(hex[b] as number));
    sat += Math.hypot(c[1], c[2]);
  }
  return { minDelta: +min.toFixed(1), pair, meanDelta: +(sum / NEIGHBORS.length).toFixed(1), saturation: +(sat / 10).toFixed(1) };
}
