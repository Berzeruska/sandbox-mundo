import { Biome } from '../world/biomes';
import { biomeRgb } from './flora';
import { sequence } from './hash';
import { limb, lump, mixRgb, Model, rgb, type Rgb, type V3 } from './models';

/**
 * Plantas das folhas em `docs/img/referencias/plantas/`, nos quatro estados. Forma e pose vêm das folhas (com as correções do `LEIAME.md`:
 * arbusto e musgo queimados e secos do complemento-1, flores do complemento-1, cacto baixo seco do complemento-2). A cor verde vem do globo do M2.
 */
export const PLANT_STATES = ['young', 'adult', 'dry', 'burned'] as const;
export type PlantState = (typeof PLANT_STATES)[number];
export const SPECIES = ['pine', 'snowPine', 'tundraShrub', 'moss', 'oak', 'midTree', 'shrub', 'tallGrass', 'flowers', 'tropical', 'palm', 'acacia', 'baobab', 'savannaGrass', 'cactusTall', 'cactusLow', 'desertShrub', 'mangrove', 'reedClump'] as const;
export type Species = (typeof SPECIES)[number];

const GRASS = biomeRgb(Biome.Grassland), FOREST = biomeRgb(Biome.TemperateForest), TAIGA = biomeRgb(Biome.Taiga), TROPICAL = biomeRgb(Biome.TropicalForest), SWAMP = biomeRgb(Biome.Swamp), SAVANNA = biomeRgb(Biome.Savanna);
const LEAF = mixRgb(FOREST, GRASS, 0.26), LEAF_LIGHT = mixRgb(FOREST, GRASS, 0.42), PINE = mixRgb(TAIGA, FOREST, 0.55), TROP = mixRgb(TROPICAL, GRASS, 0.3), ACACIA = mixRgb(FOREST, GRASS, 0.36);
const BARK = rgb(128, 84, 54), DRY_WOOD = rgb(150, 122, 92), PALE_WOOD = rgb(186, 158, 118), CHAR = rgb(40, 34, 34), CHAR_WARM = rgb(58, 42, 36), DRY_GRASS = rgb(190, 158, 108), SNOW = rgb(240, 243, 247);
const CACTUS = rgb(84, 142, 72), CACTUS_PALE = rgb(170, 158, 134);

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Galhos secos: tronco e ramos que se dividem. */
function branches(m: Model, seed: number, o: { base: V3; height: number; r: number; color: Rgb; levels: number; spread: number; lean?: number; upward?: number }): void {
  const rand = sequence(seed * 37 + 11);
  const grow = (a: V3, dir: V3, len: number, r: number, level: number): void => {
    const b: V3 = [a[0] + dir[0] * len, a[1] + dir[1] * len, a[2] + dir[2] * len];
    limb(m, a, b, r, r * 0.62, o.color, level === o.levels ? 5 : 4, 0.82, 0.96);
    if (level <= 0) return;
    const kids = level === o.levels ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const t = rand() * 6.283, out = o.spread * (0.7 + rand() * 0.6), up = (o.upward ?? 0.8) + rand() * 0.25;
      const dx = dir[0] * 0.5 + Math.cos(t) * out, dy = dir[1] * 0.5 + up, dz = dir[2] * 0.5 + Math.sin(t) * out, l = Math.hypot(dx, dy, dz);
      grow(b, [dx / l, dy / l, dz / l], len * (0.58 + rand() * 0.14), r * 0.62, level - 1);
    }
  };
  grow(o.base, [o.lean ?? 0, 1, 0], o.height * 0.46, o.r, o.levels);
}

function tier(m: Model, y0: number, y1: number, r0: number, r1: number, color: Rgb, seed: number, under: Rgb): void {
  const rand = sequence(seed), sides = 8, a0 = rand() * 6.28;
  const rim: V3[] = [];
  for (let i = 0; i < sides; i++) { const t = a0 + (i / sides) * 6.283, rr = r0 * (0.92 + rand() * 0.16); rim.push([Math.cos(t) * rr, y0, Math.sin(t) * rr]); }
  const inside: V3 = [0, (y0 + y1) / 2, 0];
  for (let i = 0; i < sides; i++) {
    const p = rim[i] as V3, q = rim[(i + 1) % sides] as V3;
    const t0 = a0 + (i / sides) * 6.283, t1 = a0 + ((i + 1) / sides) * 6.283, c = shade(color, 0.92 + rand() * 0.16);
    if (r1 <= 0.001) m.tri(p, q, [0, y1, 0], c, inside, [0.76, 0.76, 1]);
    else {
      const p2: V3 = [Math.cos(t0) * r1, y1, Math.sin(t0) * r1], q2: V3 = [Math.cos(t1) * r1, y1, Math.sin(t1) * r1];
      m.tri(p, q, q2, c, inside, [0.76, 0.76, 1]);
      m.tri(p, q2, p2, c, inside, [0.76, 1, 1]);
    }
    m.tri(p, q, [0, y0 + 0.05, 0], under, [0, y0 + 1, 0], [0.6, 0.6, 0.6]);
  }
}

function pineModel(seed: number, h: number, tiers: number, snowy: boolean): Float32Array {
  const m = new Model();
  limb(m, [0, 0, 0], [0, h * 0.25, 0], 0.07 * h, 0.05 * h, rgb(112, 72, 48), 5, 0.72, 0.9);
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers, y0 = h * (0.19 + f * 0.7), y1 = y0 + (h * 0.81 / tiers) * 1.05, r0 = h * 0.31 * (1 - f * 0.8), r1 = k === tiers - 1 ? 0 : r0 * 0.42;
    const c = snowy ? SNOW : shade(PINE, 0.92 + f * 0.2);
    tier(m, y0, y1, r0, r1, c, seed * 7 + k * 13, snowy ? shade(PINE, 0.85) : shade(PINE, 0.55));
    if (snowy) tier(m, y0 - 0.1, y0 + 0.06, r0 * 1.02, r0 * 0.98, PINE, seed * 3 + k, shade(PINE, 0.6));
  }
  return m.build();
}

function plates(m: Model, seed: number, o: { center: V3; ring: number; count: number; r: number; flat: number; color: Rgb; wood: Rgb; from: V3; lift?: number }): void {
  const rand = sequence(seed * 53 + 3);
  lump(m, [o.center[0], o.center[1] + o.flat * 0.5, o.center[2]], [o.r * 1.1, o.flat, o.r * 1.1], o.color, seed * 13 + 7, { detail: 1, rough: 0.08, tone: 0.08, low: 0.55 });
  for (let k = 0; k < o.count; k++) {
    const t = (k / o.count) * 6.283 + rand() * 0.6, d = o.ring * (0.82 + rand() * 0.3);
    const p: V3 = [o.center[0] + Math.cos(t) * d, o.center[1] - rand() * (o.lift ?? 0.4), o.center[2] + Math.sin(t) * d];
    limb(m, o.from, p, 0.07 * o.r + 0.04, 0.04, o.wood, 4, 0.86, 0.9);
    const r = o.r * (0.68 + rand() * 0.28);
    lump(m, p, [r, o.flat * 0.85, r], shade(o.color, 0.96 + rand() * 0.12), seed * 29 + k, { rough: 0.1, tone: 0.08, low: 0.56 });
  }
}

function bladeTuft(m: Model, seed: number, count: number, height: number, width: number, color: Rgb, lean = 0.45): void {
  const rand = sequence(seed * 41 + 3);
  for (let k = 0; k < count; k++) {
    const t = rand() * 6.283, l = lean * (0.3 + rand() * 0.8), h = height * (0.6 + rand() * 0.5), cx = Math.cos(t), cz = Math.sin(t);
    m.blade([cx * 0.1 - cz * width, 0, cz * 0.1 + cx * width], [cx * 0.1 + cz * width, 0, cz * 0.1 - cx * width], [cx * l * height, h, cz * l * height], shade(color, 0.82 + rand() * 0.34), [0.72, 0.72, 1]);
  }
}

function flatPatch(m: Model, seed: number, r: number, h: number, color: Rgb): void {
  const rand = sequence(seed * 61 + 1), sides = 9;
  const rim: V3[] = [];
  for (let i = 0; i < sides; i++) { const t = (i / sides) * 6.283, rr = r * (0.68 + rand() * 0.5); rim.push([Math.cos(t) * rr, 0, Math.sin(t) * rr]); }
  const top: V3 = [0, h, 0];
  for (let i = 0; i < sides; i++) m.tri(rim[i] as V3, rim[(i + 1) % sides] as V3, top, shade(color, 0.92 + rand() * 0.16), [0, -1, 0], [0.86, 0.86, 1]);
}

function blossoms(m: Model, seed: number, stem: Rgb, colors: readonly Rgb[]): void {
  const rand = sequence(seed * 71 + 9);
  for (let k = 0; k < 12; k++) {
    const t = rand() * 6.283, d = 0.1 + rand() * 0.55, h = 0.3 + rand() * 0.26, x = Math.cos(t) * d, z = Math.sin(t) * d;
    limb(m, [x * 0.5, 0, z * 0.5], [x, h, z], 0.022, 0.016, stem, 3, 0.8, 1);
    const c = colors[Math.floor(rand() * colors.length)] as Rgb, r = 0.075 + rand() * 0.035;
    lump(m, [x, h + 0.02, z], [r, r * 0.55, r], c, seed * 5 + k, { rough: 0.05, tone: 0.06, low: 0.85 });
  }
}

function palm(m: Model, seed: number, h: number, frond: Rgb, trunk: Rgb, fronds = 9): void {
  const rand = sequence(seed * 83 + 2);
  const lean = 0.18 * h, seg = 5;
  const at = (f: number): V3 => [lean * f * f, h * f, 0];
  for (let k = 0; k < seg; k++) limb(m, at(k / seg), at((k + 1) / seg), 0.09 * h * (1 - (k / seg) * 0.45) * 0.72, 0.09 * h * (1 - ((k + 1) / seg) * 0.45) * 0.72, shade(trunk, 0.94 + (k % 2) * 0.1), 5, 0.84, 0.96);
  const top = at(1);
  for (let k = 0; k < fronds; k++) {
    const t = (k / fronds) * 6.283 + rand() * 0.3, cx = Math.cos(t), cz = Math.sin(t), len = h * (0.42 + rand() * 0.12), w = h * 0.075;
    const mid: V3 = [top[0] + cx * len * 0.55, top[1] + h * 0.07, top[2] + cz * len * 0.55], tip: V3 = [top[0] + cx * len, top[1] - h * 0.16, top[2] + cz * len];
    const sx = -cz * w, sz = cx * w;
    const c = shade(frond, 0.9 + rand() * 0.22);
    m.blade(top, [mid[0] + sx, mid[1], mid[2] + sz], [mid[0] - sx, mid[1], mid[2] - sz], c, [0.8, 1, 1]);
    m.blade([mid[0] + sx, mid[1], mid[2] + sz], [mid[0] - sx, mid[1], mid[2] - sz], tip, c, [1, 1, 0.92]);
  }
}

function bottle(m: Model, h: number, r: number, color: Rgb): void {
  const profile = [0.82, 1, 0.98, 0.84, 0.6, 0.42];
  for (let k = 0; k + 1 < profile.length; k++) limb(m, [0, (k / 5) * h, 0], [0, ((k + 1) / 5) * h, 0], (profile[k] as number) * r, (profile[k + 1] as number) * r, color, 8, 0.82 + k * 0.03, 0.86 + k * 0.03);
}

function saguaro(m: Model, seed: number, tall: number, color: Rgb): void {
  const r = tall * 0.105, side = seed % 2 === 0 ? 1 : -1;
  limb(m, [0, 0, 0], [0, tall, 0], r, r * 0.72, color, 6, 0.78, 1);
  limb(m, [0, tall * 0.42, 0], [side * tall * 0.22, tall * 0.48, 0], r * 0.5, r * 0.46, color, 5, 0.88, 0.92);
  limb(m, [side * tall * 0.22, tall * 0.46, 0], [side * tall * 0.22, tall * 0.76, 0], r * 0.46, r * 0.36, color, 5, 0.92, 1);
  limb(m, [0, tall * 0.55, 0], [-side * tall * 0.19, tall * 0.6, 0.05], r * 0.42, r * 0.4, color, 5, 0.88, 0.92);
  limb(m, [-side * tall * 0.19, tall * 0.58, 0.05], [-side * tall * 0.19, tall * 0.88, 0.05], r * 0.4, r * 0.3, color, 5, 0.92, 1);
}

function pads(m: Model, seed: number, color: Rgb, s: number): void {
  lump(m, [0, 0.42 * s, 0], [0.36 * s, 0.46 * s, 0.36 * s], color, seed * 3 + 2, { detail: 1, rough: 0.05, tone: 0.08, low: 0.7, foot: 0 });
  lump(m, [0.38 * s, 0.5 * s, 0.05 * s], [0.16 * s, 0.2 * s, 0.16 * s], color, seed * 3 + 3, { rough: 0.06, tone: 0.08, low: 0.75 });
  lump(m, [-0.36 * s, 0.42 * s, 0], [0.13 * s, 0.17 * s, 0.13 * s], color, seed * 3 + 4, { rough: 0.06, tone: 0.08, low: 0.75 });
}

function columns(m: Model, seed: number, color: Rgb, s: number): void {
  const rand = sequence(seed * 97 + 1);
  for (let k = 0; k < 5; k++) {
    const t = k === 0 ? 0 : rand() * 6.283, d = k === 0 ? 0 : 0.22 * s + rand() * 0.12 * s, h = k === 0 ? 0.92 * s : (0.35 + rand() * 0.42) * s, x = Math.cos(t) * d, z = Math.sin(t) * d;
    limb(m, [x, 0, z], [x * 1.1, h, z * 1.1], 0.1 * s, 0.075 * s, color, 6, 0.78, 1);
  }
}

function mangroveRoots(m: Model, seed: number, wood: Rgb, s: number): void {
  const rand = sequence(seed * 89 + 5);
  for (let k = 0; k < 7; k++) {
    const t = (k / 7) * 6.283 + rand() * 0.4, r = (0.42 + rand() * 0.3) * s, cx = Math.cos(t), cz = Math.sin(t);
    limb(m, [0, 0.62 * s, 0], [cx * r * 0.6, 0.3 * s, cz * r * 0.6], 0.05 * s, 0.038 * s, wood, 4, 0.86, 0.82);
    limb(m, [cx * r * 0.6, 0.3 * s, cz * r * 0.6], [cx * r, -0.05, cz * r], 0.038 * s, 0.025 * s, wood, 4, 0.82, 0.7);
  }
}

function build(species: Species, state: PlantState, seed: number): Float32Array {
  const m = new Model();
  const burned = state === 'burned', dry = state === 'dry', young = state === 'young';
  const wood = burned ? CHAR : DRY_WOOD;
  switch (species) {
    case 'pine':
    case 'snowPine':
      if (young) return pineModel(seed, 2.1 + (seed % 2) * 0.3, 3, species === 'snowPine');
      if (state === 'adult') return pineModel(seed, 4 + (seed % 3) * 0.32, 4 + (seed % 2), species === 'snowPine');
      branches(m, seed, { base: [0, 0, 0], height: 4, r: 0.2, color: burned ? CHAR_WARM : rgb(136, 96, 62), levels: 2, spread: 0.55, upward: 1.2 });
      break;
    case 'tundraShrub':
      if (young || state === 'adult') {
        const rand = sequence(seed * 5 + 1), color = young ? mixRgb(PINE, GRASS, 0.25) : mixRgb(rgb(160, 164, 118), GRASS, 0.1);
        for (let k = 0; k < 7; k++) { const t = rand() * 6.283, d = 0.14 + rand() * 0.38, h = 0.34 + rand() * 0.34; limb(m, [Math.cos(t) * d * 0.3, 0, Math.sin(t) * d * 0.3], [Math.cos(t) * d, h, Math.sin(t) * d], 0.075, 0.04, color, 4, 0.76, 1); }
      } else branches(m, seed, { base: [0, 0, 0], height: 1.25, r: 0.06, color: burned ? CHAR : PALE_WOOD, levels: 3, spread: 1.05, upward: 0.45 });
      break;
    case 'moss':
      flatPatch(m, seed, young ? 0.5 : 0.72, 0.13, burned ? rgb(52, 40, 36) : dry ? rgb(196, 176, 134) : young ? mixRgb(GRASS, FOREST, 0.2) : mixRgb(GRASS, rgb(200, 220, 96), 0.55));
      break;
    case 'oak':
      if (young) {
        limb(m, [0, 0, 0], [0, 0.85, 0], 0.09, 0.06, BARK, 5, 0.76, 0.95);
        lump(m, [0, 1.15, 0], [0.42, 0.42, 0.42], LEAF, seed + 3, { rough: 0.1, low: 0.6 });
        lump(m, [0.28, 0.8, 0.1], [0.2, 0.2, 0.2], LEAF, seed + 4, { rough: 0.1, low: 0.6 });
      } else if (state === 'adult') {
        const rand = sequence(seed * 31 + 5);
        limb(m, [0, 0, 0], [0, 1.2, 0], 0.34, 0.24, BARK, 6, 0.75, 0.95);
        limb(m, [0, 1, 0], [0.7, 1.75, 0.2], 0.17, 0.08, BARK, 4, 0.8, 0.8);
        limb(m, [0, 1, 0], [-0.65, 1.8, -0.2], 0.17, 0.08, BARK, 4, 0.8, 0.8);
        lump(m, [0, 2.05, 0], [1.15, 0.85, 1.15], LEAF, seed * 3 + 1, { detail: 1, rough: 0.1, tone: 0.09, low: 0.58 });
        for (let k = 0; k < 6; k++) { const t = (k / 6) * 6.283 + rand() * 0.5, d = 0.78 + rand() * 0.32, r = 0.5 + rand() * 0.24; lump(m, [Math.cos(t) * d, 1.62 + rand() * 0.75, Math.sin(t) * d], [r, r * 0.82, r], shade(LEAF, 0.94 + rand() * 0.14), seed * 11 + k, { rough: 0.12, tone: 0.09, low: 0.6 }); }
      } else if (dry) branches(m, seed, { base: [0, 0, 0], height: 2.9, r: 0.3, color: wood, levels: 3, spread: 0.95, upward: 0.65 });
      else {
        // Queimado grande vira toco (`temperado.png`).
        limb(m, [0, 0, 0], [0, 0.72, 0], 0.5, 0.26, CHAR_WARM, 6, 0.8, 1);
        limb(m, [0, 0.6, 0], [0.16, 1.05, 0.05], 0.14, 0.03, CHAR, 4, 0.9, 1);
        limb(m, [0, 0.6, 0], [-0.18, 0.95, -0.04], 0.13, 0.03, CHAR, 4, 0.9, 1);
        limb(m, [0, 0.1, 0], [0.62, -0.02, 0.2], 0.16, 0.05, CHAR, 4, 0.9, 0.8);
        limb(m, [0, 0.1, 0], [-0.5, -0.02, 0.36], 0.16, 0.05, CHAR, 4, 0.9, 0.8);
      }
      break;
    case 'midTree':
      if (young) {
        limb(m, [0, 0, 0], [0, 0.82, 0], 0.08, 0.05, BARK, 5, 0.76, 0.95);
        lump(m, [0, 1.15, 0], [0.34, 0.5, 0.34], LEAF_LIGHT, seed + 2, { rough: 0.08, low: 0.62 });
      } else if (state === 'adult') {
        limb(m, [0, 0, 0], [0, 1.25, 0], 0.22, 0.14, BARK, 5, 0.75, 0.95);
        lump(m, [0, 2, 0], [0.98, 1.05, 0.98], LEAF_LIGHT, seed * 5 + 3, { detail: 1, rough: 0.09, tone: 0.1, low: 0.6 });
      } else branches(m, seed, { base: [0, 0, 0], height: 2.7, r: 0.16, color: wood, levels: 3, spread: 0.62, upward: 0.9 });
      break;
    case 'shrub':
      if (young || state === 'adult') {
        const s = young ? 0.32 : 0.52;
        lump(m, [0, s * 0.72, 0], [s, s * 0.82, s], LEAF_LIGHT, seed * 7 + 1, { detail: 1, rough: 0.07, tone: 0.09, low: 0.62, foot: 0 });
      } else branches(m, seed, { base: [0, 0, 0], height: 0.9, r: 0.05, color: wood, levels: 2, spread: 1.1, upward: 0.55 });
      break;
    case 'tallGrass':
      bladeTuft(m, seed, young ? 6 : 11, young ? 0.5 : 0.9, 0.055, burned ? CHAR : dry ? DRY_GRASS : mixRgb(GRASS, FOREST, 0.24));
      break;
    case 'flowers':
      if (burned) blossoms(m, seed, CHAR, [CHAR, CHAR_WARM]);
      else if (dry) blossoms(m, seed, rgb(150, 122, 78), [rgb(176, 136, 76), rgb(154, 120, 70)]);
      else blossoms(m, seed, mixRgb(GRASS, FOREST, 0.4), [rgb(214, 60, 52), rgb(240, 190, 60), rgb(244, 244, 236), rgb(88, 110, 210), rgb(226, 120, 170)]);
      break;
    case 'tropical':
      if (young) {
        limb(m, [0, 0, 0], [0, 1.2, 0], 0.08, 0.05, BARK, 5, 0.76, 0.95);
        plates(m, seed, { center: [0, 1.35, 0], ring: 0.32, count: 3, r: 0.3, flat: 0.16, color: TROP, wood: BARK, from: [0, 1, 0] });
      } else if (state === 'adult') {
        limb(m, [0, 0, 0], [0, 3.3, 0], 0.26, 0.13, BARK, 6, 0.76, 0.98);
        plates(m, seed, { center: [0, 3.65, 0], ring: 0.92, count: 5, r: 0.74, flat: 0.32, color: TROP, wood: BARK, from: [0, 3, 0], lift: 0.55 });
        plates(m, seed + 7, { center: [0.5, 2.4, 0.2], ring: 0.2, count: 1, r: 0.34, flat: 0.15, color: TROP, wood: BARK, from: [0, 2.1, 0] });
      } else if (dry) branches(m, seed, { base: [0, 0, 0], height: 4, r: 0.2, color: wood, levels: 3, spread: 0.55, upward: 1 });
      else {
        limb(m, [0, 0, 0], [0, 3.5, 0], 0.24, 0.05, CHAR, 6, 0.8, 1);
        limb(m, [0, 2.4, 0], [0.5, 3, 0.1], 0.06, 0.02, CHAR, 4, 0.9, 1);
        limb(m, [0, 2.8, 0], [-0.42, 3.3, 0], 0.05, 0.02, CHAR, 4, 0.9, 1);
      }
      break;
    case 'palm':
      if (burned) { limb(m, [0, 0, 0], [0.1, 1.5, 0], 0.17, 0.11, CHAR_WARM, 5, 0.8, 1); limb(m, [0.1, 1.5, 0], [0.14, 2.1, 0], 0.11, 0.04, CHAR, 5, 0.9, 1); }
      else palm(m, seed, young ? 1.5 : 3.1, dry ? rgb(180, 136, 88) : TROP, dry ? rgb(160, 126, 90) : rgb(176, 136, 96), young ? 7 : 9);
      break;
    case 'acacia':
      if (young) {
        limb(m, [0, 0, 0], [0, 0.9, 0], 0.07, 0.04, BARK, 4, 0.76, 0.95);
        plates(m, seed, { center: [0, 1.12, 0], ring: 0.32, count: 3, r: 0.24, flat: 0.1, color: ACACIA, wood: BARK, from: [0, 0.75, 0] });
      } else if (state === 'adult') {
        limb(m, [0, 0, 0], [0.06, 1.05, 0], 0.2, 0.12, BARK, 6, 0.76, 0.95);
        plates(m, seed, { center: [0.06, 1.95, 0], ring: 1, count: 5, r: 0.62, flat: 0.22, color: ACACIA, wood: BARK, from: [0.06, 0.95, 0], lift: 0.38 });
      } else branches(m, seed, { base: [0, 0, 0], height: 2.2, r: 0.13, color: burned ? CHAR : rgb(150, 112, 78), levels: 3, spread: 1.4, upward: 0.42 });
      break;
    case 'baobab':
      if (young) {
        bottle(m, 0.8, 0.2, rgb(178, 122, 82));
        plates(m, seed, { center: [0, 1.08, 0], ring: 0.34, count: 3, r: 0.2, flat: 0.09, color: ACACIA, wood: rgb(150, 104, 70), from: [0, 0.78, 0], lift: 0.1 });
      } else if (state === 'adult') {
        bottle(m, 3.1, 0.82, rgb(178, 122, 82));
        plates(m, seed, { center: [0, 3.65, 0], ring: 1.1, count: 6, r: 0.42, flat: 0.15, color: ACACIA, wood: rgb(150, 104, 70), from: [0, 3, 0], lift: 0.3 });
      } else {
        const c = burned ? CHAR : rgb(206, 174, 128);
        bottle(m, 3, 0.8, c);
        for (let k = 0; k < 4; k++) { const t = k * 1.6 + seed; limb(m, [0, 2.9, 0], [Math.cos(t) * 0.62, 3.7, Math.sin(t) * 0.62], 0.13, 0.03, c, 4, 0.9, 1); }
      }
      break;
    case 'savannaGrass':
      bladeTuft(m, seed, young ? 8 : 14, young ? 0.65 : 1.3, 0.05, burned ? CHAR : dry ? rgb(190, 150, 94) : mixRgb(SAVANNA, GRASS, 0.4), 0.5);
      break;
    case 'cactusTall':
      if (dry) branches(m, seed, { base: [0, 0, 0], height: 2.2, r: 0.12, color: PALE_WOOD, levels: 2, spread: 0.5, upward: 1.1 });
      else saguaro(m, seed, young ? 1.15 : 2.15, burned ? CHAR : CACTUS);
      break;
    case 'cactusLow':
      if (burned) columns(m, seed, CHAR, 0.95);
      else if (dry) columns(m, seed, CACTUS_PALE, 0.95);
      else pads(m, seed, mixRgb(CACTUS, GRASS, 0.3), young ? 0.5 : 0.82);
      break;
    case 'desertShrub':
      branches(m, seed, { base: [0, 0, 0], height: young ? 0.7 : 1.15, r: 0.05, color: burned ? CHAR : rgb(170, 134, 92), levels: young ? 2 : 3, spread: 1.05, upward: 0.55 });
      break;
    case 'mangrove': {
      const s = young ? 0.55 : 1, crown = burned ? rgb(56, 44, 42) : mixRgb(FOREST, SWAMP, 0.25);
      mangroveRoots(m, seed, burned ? CHAR : rgb(120, 78, 52), s);
      if (dry) { branches(m, seed, { base: [0, 0.6 * s, 0], height: 1.8 * s, r: 0.09 * s, color: DRY_WOOD, levels: 2, spread: 0.8 }); break; }
      limb(m, [0, 0.55 * s, 0], [0, 1.4 * s, 0], 0.11 * s, 0.07 * s, burned ? CHAR : rgb(120, 78, 52), 5, 0.8, 0.95);
      lump(m, [0, 1.85 * s, 0], [0.78 * s, 0.62 * s, 0.78 * s], crown, seed * 3 + 1, { detail: 1, rough: 0.1, tone: 0.09, low: 0.6 });
      lump(m, [0.62 * s, 1.5 * s, 0.1 * s], [0.34 * s, 0.3 * s, 0.34 * s], crown, seed * 3 + 2, { rough: 0.1, low: 0.6 });
      lump(m, [-0.55 * s, 1.55 * s, -0.2 * s], [0.34 * s, 0.3 * s, 0.34 * s], crown, seed * 3 + 3, { rough: 0.1, low: 0.6 });
      break;
    }
    case 'reedClump':
      bladeTuft(m, seed, young ? 6 : 10, young ? 0.6 : 1.15, 0.045, burned ? CHAR : dry ? DRY_GRASS : mixRgb(FOREST, GRASS, 0.24), 0.2);
      if (!young) for (let k = 0; k < 3; k++) { const t = k * 2.1 + seed, x = Math.cos(t) * 0.14, z = Math.sin(t) * 0.14; limb(m, [x, 0, z], [x, 1.25, z], 0.018, 0.014, burned ? CHAR : dry ? DRY_GRASS : mixRgb(FOREST, GRASS, 0.3), 3, 0.8, 1); limb(m, [x, 1.05, z], [x, 1.28, z], 0.04, 0.036, burned ? CHAR_WARM : rgb(110, 76, 50), 4, 1, 1); }
      break;
  }
  return m.build();
}

const cache = new Map<string, Float32Array>();
/** Modelo pronto: 2 variantes por espécie e estado. */
export function plant(species: Species, state: PlantState, variant: number): Float32Array {
  const v = variant % 2, key = `${species}:${state}:${v}`;
  let out = cache.get(key);
  if (!out) { out = build(species, state, v + 1); cache.set(key, out); }
  return out;
}
