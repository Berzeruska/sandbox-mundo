import { Resource } from '../world/resources';
import { sequence } from './hash';
import { lump, Model, rgb, setFarModels, type Rgb, type V3 } from './models';

/**
 * Jazidas como amontoados de pedras facetadas da cor do minério (`recursos/jazidas.png`). Cada tipo tem a pedra, o veio e o que há por cima (cristais, cubos).
 * Petróleo aparente: poça preta e brilhante com borda natural. O petróleo escondido não entra aqui.
 */
/**
 * Petróleo misto (decisão do usuário, 2026-11-05): cerca de 30% das manchas afloram. A escolha é por bloco de 8×8 células, só no desenho da maquete:
 * o mundo, o globo e o sorteio não mudam, e o resto continua escondido até cavar.
 */
export function surfaceOil(n: number, cell: number): boolean {
  const face = Math.floor(cell / (n * n)), rest = cell - face * n * n, x = rest % n, y = Math.floor(rest / n);
  return ((Math.imul((face * 977 + (x >> 3)) * 8191 + (y >> 3), 2654435761) >>> 16) & 1023) < 307;
}

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Bola facetada com facetas de duas cores: pedra e veio. */
function boulder(m: Model, c: V3, r: number, base: Rgb, vein: Rgb | null, seed: number, chance = 0.26): void {
  const rand = sequence(seed * 17 + 3);
  const start = new Model();
  lump(start, c, [r, r * 0.84, r * 0.92], base, seed, { detail: r > 0.3 ? 1 : 0, rough: r > 0.3 ? 0.13 : 0.2, tone: 0.14, low: 0.66, foot: 0 });
  const tris = start.build();
  for (let o = 0; o + 30 <= tris.length; o += 30) {
    const pick = vein && rand() < chance;
    const col: Rgb = pick ? shade(vein, 0.92 + rand() * 0.16) : [tris[o + 6] as number, tris[o + 7] as number, tris[o + 8] as number];
    m.tri([tris[o] as number, tris[o + 1] as number, tris[o + 2] as number], [tris[o + 10] as number, tris[o + 11] as number, tris[o + 12] as number], [tris[o + 20] as number, tris[o + 21] as number, tris[o + 22] as number], col, c, [tris[o + 9] as number, tris[o + 19] as number, tris[o + 29] as number]);
  }
}

function pile(m: Model, base: Rgb, vein: Rgb | null, seed: number, chance?: number): void {
  boulder(m, [0, 0.46, 0], 0.62, base, vein, seed + 1, chance);
  boulder(m, [0.68, 0.26, 0.26], 0.36, base, vein, seed + 2, chance);
  boulder(m, [-0.56, 0.24, 0.42], 0.34, base, vein, seed + 3, chance);
  boulder(m, [0.1, 0.12, 0.76], 0.18, base, vein, seed + 4, chance);
}

function crystal(m: Model, x: number, z: number, y: number, h: number, r: number, color: Rgb, tilt: number): void {
  const sides = 5, inside: V3 = [x, y + h * 0.4, z], tip: V3 = [x + tilt, y + h, z + tilt * 0.5];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 6.283, b = ((i + 1) / sides) * 6.283;
    m.tri([x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], tip, shade(color, 0.88 + (i % 3) * 0.14), inside, [0.86, 0.86, 1]);
  }
}

function crystals(m: Model, color: Rgb, seed: number, count: number, spread = 0.72): void {
  const rand = sequence(seed * 23 + 9);
  for (let k = 0; k < count; k++) {
    const t = rand() * 6.283, d = rand() * spread;
    crystal(m, Math.cos(t) * d, Math.sin(t) * d, 0.3 + rand() * 0.4, 0.34 + rand() * 0.34, 0.08 + rand() * 0.05, color, (rand() - 0.5) * 0.18);
  }
}

function cube(m: Model, x: number, z: number, s: number, color: Rgb, yaw: number): void {
  const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s, h = s * 1.5;
  const at = (a: number, b: number, y: number): V3 => [x + a * c - b * n, y, z + a * n + b * c];
  const v = [at(-1, -1, 0), at(1, -1, 0), at(1, 1, 0), at(-1, 1, 0), at(-1, -1, h), at(1, -1, h), at(1, 1, h), at(-1, 1, h)] as const;
  const inside: V3 = [x, h / 2, z];
  for (const [a, b, d, e, k] of [[4, 5, 6, 7, 1.04], [0, 1, 5, 4, 0.92], [1, 2, 6, 5, 0.86], [2, 3, 7, 6, 0.92], [3, 0, 4, 7, 0.86]] as const) {
    m.tri(v[a], v[b], v[d], shade(color, k), inside);
    m.tri(v[a], v[d], v[e], shade(color, k), inside);
  }
}

function flat(m: Model, radius: number, color: Rgb, seed: number, y = 0.06, sides = 11): void {
  const rand = sequence(seed * 41 + 13);
  const ring: V3[] = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * 6.283, r = radius * (0.72 + rand() * 0.4); ring.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  const c: V3 = [0, y + 0.01, 0];
  for (let i = 0; i < sides; i++) m.tri(ring[i] as V3, ring[(i + 1) % sides] as V3, c, shade(color, 0.96 + rand() * 0.08), [0, -1, 0]);
}

function build(type: number, seed: number): Float32Array {
  const m = new Model();
  switch (type) {
    case Resource.Copper: pile(m, rgb(176, 104, 72), rgb(38, 122, 132), seed, 0.42); break;
    case Resource.Silver: pile(m, rgb(186, 190, 196), rgb(148, 152, 160), seed); break;
    case Resource.Gold: pile(m, rgb(164, 154, 128), rgb(236, 190, 60), seed, 0.22); break;
    case Resource.Iron: pile(m, rgb(116, 96, 92), rgb(176, 74, 50), seed, 0.3); break;
    case Resource.Manganese: pile(m, rgb(46, 38, 58), null, seed); break;
    case Resource.Chromium:
      pile(m, rgb(50, 112, 82), rgb(36, 84, 62), seed);
      for (let k = 0; k < 5; k++) boulder(m, [Math.cos(k * 1.3) * 0.7, 0.1, Math.sin(k * 1.3) * 0.7], 0.1, rgb(60, 130, 96), null, seed + k + 9);
      break;
    case Resource.Tin: pile(m, rgb(190, 188, 182), rgb(150, 150, 146), seed); break;
    case Resource.Bauxite:
      cube(m, 0, 0, 0.36, rgb(178, 86, 58), 0.4); cube(m, 0.56, 0.24, 0.24, rgb(166, 66, 48), 1); cube(m, -0.5, 0.3, 0.22, rgb(186, 96, 66), 2); cube(m, 0.1, 0.64, 0.14, rgb(166, 66, 48), 0.2);
      break;
    case Resource.Niobium: pile(m, rgb(128, 150, 176), rgb(100, 122, 150), seed); break;
    case Resource.RareEarths: pile(m, rgb(106, 76, 142), rgb(82, 58, 116), seed); crystals(m, rgb(146, 104, 186), seed, 6); break;
    case Resource.Lithium:
      flat(m, 1.05, rgb(196, 186, 160), seed);
      for (let k = 0; k < 5; k++) cube(m, Math.cos(k * 1.9) * 0.55, Math.sin(k * 1.9) * 0.5, 0.09 + (k % 3) * 0.03, rgb(244, 246, 248), k);
      break;
    case Resource.Oil:
      // Poça: borda de terra escura, preto no meio e dois reflexos.
      flat(m, 1.2, rgb(84, 62, 46), seed, 0.04);
      flat(m, 0.95, rgb(14, 12, 18), seed + 1, 0.07);
      m.tri([-0.34, 0.085, -0.08], [-0.06, 0.085, -0.24], [0.02, 0.085, -0.02], rgb(110, 112, 128), [0, -1, 0]);
      m.tri([0.2, 0.085, 0.16], [0.44, 0.085, 0.08], [0.34, 0.085, 0.3], rgb(70, 72, 88), [0, -1, 0]);
      break;
    case Resource.Coal:
      boulder(m, [0, 0.3, 0], 0.46, rgb(30, 30, 34), null, seed + 1); boulder(m, [0.56, 0.18, 0.2], 0.26, rgb(26, 26, 30), null, seed + 2); boulder(m, [-0.5, 0.14, 0.3], 0.2, rgb(34, 34, 38), null, seed + 3);
      for (let k = 0; k < 4; k++) boulder(m, [Math.cos(k * 2) * 0.82, 0.05, Math.sin(k * 2) * 0.82], 0.08, rgb(26, 26, 30), null, seed + 4 + k);
      break;
    case Resource.Uranium: pile(m, rgb(132, 134, 130), null, seed); crystals(m, rgb(140, 226, 70), seed, 7); break;
    case Resource.Potash: pile(m, rgb(226, 178, 176), rgb(204, 116, 118), seed, 0.3); break;
    case Resource.Nitrates:
      flat(m, 1.1, rgb(226, 204, 158), seed);
      for (let k = 0; k < 6; k++) boulder(m, [Math.cos(k * 1.7) * 0.6, 0.08, Math.sin(k * 1.7) * 0.55], 0.1 + (k % 3) * 0.03, rgb(206, 182, 128), null, seed + k + 5);
      break;
    case Resource.Salt:
      flat(m, 1, rgb(232, 234, 236), seed);
      cube(m, 0, 0, 0.34, rgb(248, 249, 250), 0.5); cube(m, 0.56, 0.24, 0.2, rgb(244, 246, 248), 1.2); cube(m, -0.48, 0.34, 0.17, rgb(244, 246, 248), 0.1); cube(m, 0.14, 0.62, 0.12, rgb(244, 246, 248), 2);
      break;
    case Resource.Sulfur: pile(m, rgb(234, 212, 58), rgb(214, 186, 40), seed); crystals(m, rgb(246, 226, 66), seed, 7); break;
    case Resource.Limestone: pile(m, rgb(226, 214, 190), rgb(208, 196, 170), seed); break;
    default: pile(m, rgb(130, 130, 130), null, seed);
  }
  return m.build();
}

const cache = new Map<number, Float32Array>();
export function depositModel(type: number, variant: number, lod = false): Float32Array {
  const key = (type * 2 + (variant & 1)) * 2 + (lod ? 1 : 0);
  let out = cache.get(key);
  if (!out) {
    setFarModels(lod);
    out = build(type, (variant & 1) + 1 + type * 3);
    setFarModels(false);
    cache.set(key, out);
  }
  return out;
}
