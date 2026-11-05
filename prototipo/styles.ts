/** Opções do guia de estilo do portão do M3 (`docs/M3-portao.md`). Tudo original; nada copiado (regra 8). */
export type RGB = readonly [number, number, number];

export interface Style {
  id: string;
  name: string;
  blurb: string;
  /** Cor por bioma, na ordem de `Biome` (`src/world/biomes.ts`). */
  biome: readonly RGB[];
  sun: readonly [number, number, number];
  sunColor: RGB;
  sky: RGB;
  ground: RGB;
  background: RGB;
  side: RGB;
  sideLow: RGB;
  water: RGB;
  tree: 'cone' | 'round' | 'block';
  leaves: readonly RGB[];
  trunk: RGB;
  roof: 'gable' | 'flat';
  roofs: readonly RGB[];
  walls: readonly RGB[];
  road: RGB;
  /** Altura de cada degrau do relevo (em células). */
  step: number;
  /** Quanto a cor de cada célula varia, para não parecer um tabuleiro. */
  speckle: number;
}

const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const biomes = (...h: number[]): RGB[] => h.map(rgb);

export const STYLES: readonly Style[] = [
  {
    id: 'maquete',
    name: 'A — Maquete viva',
    blurb: 'Cores vivas, sol da manhã, sombra suave. Pinheiros em cone, telhados vermelhos.',
    biome: biomes(0x1d4f9a, 0x2f7ec2, 0xe9d79a, 0xf2f6fa, 0xa8ae8a, 0x4f8a5c, 0x57a54a, 0x8fc65a, 0xc9c273, 0xedcb82, 0xc6bfa6, 0xc6bd62, 0x3f9a45, 0x5f8a58, 0x9a9184, 0xf1f3f6),
    sun: [-0.55, 0.72, -0.42],
    sunColor: [0.72, 0.67, 0.56],
    sky: [0.46, 0.5, 0.58],
    ground: [0.4, 0.36, 0.3],
    background: [0.53, 0.72, 0.85],
    side: [0.56, 0.44, 0.32],
    sideLow: [0.36, 0.28, 0.22],
    water: [0.2, 0.52, 0.8],
    tree: 'cone',
    leaves: [rgb(0x2f8a3e), rgb(0x3f9c46), rgb(0x27763a), rgb(0x57a84a)],
    trunk: rgb(0x6b4a30),
    roof: 'gable',
    roofs: [rgb(0xc8503a), rgb(0xb5442f), rgb(0xd46a43), rgb(0x8f5a3c)],
    walls: [rgb(0xf0e6d2), rgb(0xe6d6b8), rgb(0xd8d8d0)],
    road: rgb(0xb3a68e),
    step: 0.5,
    speckle: 0.05,
  },
  {
    id: 'papel',
    name: 'B — Papel pintado',
    blurb: 'Tons pastel, luz difusa, quase sem sombra dura. Árvores redondas, telhados claros.',
    biome: biomes(0x7fb1d6, 0xa2cfe4, 0xf3e7c4, 0xfafcfd, 0xcbd0b6, 0x9cbf9f, 0xa6cf9b, 0xcbe0a3, 0xe3dcab, 0xf4e0b0, 0xe0dac8, 0xe3d99d, 0x8fc391, 0xa8c4a2, 0xc9c2b8, 0xfafbfc),
    sun: [-0.35, 0.85, -0.38],
    sunColor: [0.42, 0.41, 0.38],
    sky: [0.56, 0.58, 0.6],
    ground: [0.48, 0.46, 0.43],
    background: [0.9, 0.9, 0.85],
    side: [0.8, 0.74, 0.65],
    sideLow: [0.68, 0.62, 0.55],
    water: [0.58, 0.8, 0.9],
    tree: 'round',
    leaves: [rgb(0x8cc48a), rgb(0xa2d09a), rgb(0x79b583), rgb(0xb4d89d)],
    trunk: rgb(0xa58f78),
    roof: 'gable',
    roofs: [rgb(0xf0b7a0), rgb(0xe8c9a0), rgb(0xb7cfe0), rgb(0xe0a8a8)],
    walls: [rgb(0xfdf8ee), rgb(0xf5eedd)],
    road: rgb(0xe6dcc8),
    step: 0.4,
    speckle: 0.03,
  },
  {
    id: 'madeira',
    name: 'C — Brinquedo de madeira',
    blurb: 'Blocos grandes, degraus altos, tudo com cara de peça de madeira pintada.',
    biome: biomes(0x2b6b8f, 0x3f8fa8, 0xe8c98f, 0xefe9dc, 0xb3a57f, 0x5b7f4a, 0x6f9a48, 0xa8b95a, 0xcbb066, 0xe2b872, 0xc8b28e, 0xc9a955, 0x568f40, 0x6c8551, 0xa68f70, 0xeee6d8),
    sun: [-0.6, 0.68, -0.35],
    sunColor: [0.7, 0.62, 0.48],
    sky: [0.48, 0.46, 0.44],
    ground: [0.42, 0.34, 0.26],
    background: [0.75, 0.63, 0.47],
    side: [0.72, 0.54, 0.34],
    sideLow: [0.55, 0.39, 0.24],
    water: [0.24, 0.55, 0.68],
    tree: 'block',
    leaves: [rgb(0x5f9440), rgb(0x76a848), rgb(0x4d7f3a), rgb(0x8ab04c)],
    trunk: rgb(0x8a5f36),
    roof: 'flat',
    roofs: [rgb(0xc9583a), rgb(0xe0a23c), rgb(0x3f7fa0), rgb(0x7f9a50)],
    walls: [rgb(0xe8cfa2), rgb(0xdcb985)],
    road: rgb(0xc7a878),
    step: 0.75,
    speckle: 0.04,
  },
  {
    id: 'dourada',
    name: 'D — Hora dourada',
    blurb: 'Sol baixo, sombras longas e azuladas, contraste de cinema.',
    biome: biomes(0x173f7d, 0x28699f, 0xe6c58a, 0xe9e6ea, 0x9c9a78, 0x3f7350, 0x4f8f42, 0x93b64f, 0xc4ae62, 0xe6b86f, 0xbca88f, 0xc2a350, 0x35843f, 0x4f7a4e, 0x8a7a70, 0xeae2e0),
    sun: [-0.78, 0.4, -0.48],
    sunColor: [1.15, 0.8, 0.46],
    sky: [0.36, 0.42, 0.62],
    ground: [0.3, 0.26, 0.28],
    background: [0.95, 0.72, 0.5],
    side: [0.52, 0.36, 0.28],
    sideLow: [0.3, 0.2, 0.2],
    water: [0.22, 0.45, 0.72],
    tree: 'cone',
    leaves: [rgb(0x2c7a3c), rgb(0x3b8c40), rgb(0x23663a), rgb(0x6a9a3e)],
    trunk: rgb(0x5a3c2a),
    roof: 'gable',
    roofs: [rgb(0xb04632), rgb(0x8f3f30), rgb(0xc66a38), rgb(0x6f4a3a)],
    walls: [rgb(0xeed8b4), rgb(0xdcc29c)],
    road: rgb(0xa8926e),
    step: 0.5,
    speckle: 0.05,
  },
  {
    id: 'atlas',
    name: 'E — Atlas militar',
    blurb: 'Paleta sóbria de mapa, luz fria, cidades cinzentas de telhado plano.',
    biome: biomes(0x2a4258, 0x3f6078, 0xc9bd96, 0xdfe4e6, 0x8f947c, 0x4a6650, 0x5a7a4c, 0x8a9a62, 0xa8a272, 0xc4b080, 0xa39d88, 0xa89c60, 0x4a7346, 0x5a6e50, 0x7f7c74, 0xdce0e2),
    sun: [-0.5, 0.75, -0.45],
    sunColor: [0.72, 0.74, 0.76],
    sky: [0.42, 0.46, 0.5],
    ground: [0.32, 0.32, 0.31],
    background: [0.28, 0.32, 0.35],
    side: [0.42, 0.4, 0.36],
    sideLow: [0.28, 0.27, 0.25],
    water: [0.25, 0.38, 0.5],
    tree: 'cone',
    leaves: [rgb(0x46683f), rgb(0x537546), rgb(0x3b5a3a), rgb(0x678050)],
    trunk: rgb(0x4f4436),
    roof: 'flat',
    roofs: [rgb(0x8a8c8c), rgb(0x767a7c), rgb(0x9a9890), rgb(0x6c6f70)],
    walls: [rgb(0xb4b2a8), rgb(0x9e9e96)],
    road: rgb(0x7a7a72),
    step: 0.45,
    speckle: 0.03,
  },
];
