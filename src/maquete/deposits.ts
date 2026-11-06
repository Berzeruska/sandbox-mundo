import { Resource } from '../world/resources';
import { sequence } from './hash';
import { limb, Model, rgb, setFarModels, type Rgb, type V3 } from './models';

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

/** Cor oxidada de cada minério: rocha manchada, puxando para a cor da jazida. */
const STAIN: Partial<Record<number, { rock: Rgb; vein: Rgb }>> = {
  [Resource.Iron]: { rock: rgb(138, 84, 58), vein: rgb(172, 76, 44) },
  [Resource.Copper]: { rock: rgb(126, 104, 84), vein: rgb(52, 128, 118) },
  [Resource.Gold]: { rock: rgb(160, 122, 72), vein: rgb(214, 170, 62) },
  [Resource.Silver]: { rock: rgb(132, 130, 130), vein: rgb(182, 184, 190) },
  [Resource.Tin]: { rock: rgb(138, 128, 116), vein: rgb(178, 176, 170) },
  [Resource.Bauxite]: { rock: rgb(156, 84, 58), vein: rgb(184, 100, 66) },
  [Resource.Manganese]: { rock: rgb(70, 58, 66), vein: rgb(46, 38, 58) },
  [Resource.Chromium]: { rock: rgb(92, 98, 80), vein: rgb(54, 112, 84) },
  [Resource.Niobium]: { rock: rgb(112, 118, 128), vein: rgb(128, 150, 176) },
  [Resource.RareEarths]: { rock: rgb(112, 92, 118), vein: rgb(112, 80, 150) },
  [Resource.Lithium]: { rock: rgb(190, 180, 158), vein: rgb(232, 232, 232) },
  [Resource.Coal]: { rock: rgb(58, 54, 54), vein: rgb(30, 30, 34) },
  [Resource.Uranium]: { rock: rgb(120, 122, 104), vein: rgb(128, 190, 76) },
  [Resource.Potash]: { rock: rgb(180, 146, 136), vein: rgb(212, 142, 136) },
  [Resource.Nitrates]: { rock: rgb(208, 188, 148), vein: rgb(226, 208, 168) },
  [Resource.Salt]: { rock: rgb(220, 220, 216), vein: rgb(246, 246, 248) },
  [Resource.Sulfur]: { rock: rgb(186, 162, 72), vein: rgb(232, 208, 62) },
  [Resource.Limestone]: { rock: rgb(208, 196, 170), vein: rgb(226, 216, 192) },
};

/** Cor da mancha no chão em volta do afloramento. */
export function oreStain(type: number): Rgb {
  const t = STAIN[type];
  return t ? t.rock : rgb(130, 110, 90);
}

/** Laje baixa e angulosa, rente ao chão. */
function slab(m: Model, x: number, z: number, r: number, h: number, base: Rgb, vein: Rgb, seed: number): void {
  const rand = sequence(seed * 19 + 3), sides = 6, ring: V3[] = [], top: V3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 6.283 + rand() * 0.5, q = r * (0.72 + rand() * 0.42), ax = x + Math.cos(a) * q, az = z + Math.sin(a) * q;
    ring.push([ax, -0.02, az]);
    top.push([x + Math.cos(a) * q * 0.72, h * (0.72 + rand() * 0.45), z + Math.sin(a) * q * 0.72]);
  }
  const mid: V3 = [x, h * 1.04, z], inside: V3 = [x, h * 0.2, z];
  const pick = (): Rgb => (rand() < 0.34 ? shade(vein, 0.92 + rand() * 0.14) : shade(base, 0.88 + rand() * 0.2));
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.tri(top[i] as V3, top[j] as V3, mid, pick(), inside);
    const c = pick();
    m.tri(ring[i] as V3, ring[j] as V3, top[j] as V3, shade(c, 0.86), inside, [0.78, 0.78, 1]);
    m.tri(ring[i] as V3, top[j] as V3, top[i] as V3, shade(c, 0.86), inside, [0.78, 1, 1]);
  }
}

function build(type: number, seed: number): Float32Array {
  const m = new Model();
  if (type === Resource.Oil) {
    // Cava de `recursos/jazidas.png`: buraco de terra escura com borda levantada, poça preta e dois paus.
    const rand = sequence(seed * 7 + 1), sides = 12, earth = rgb(112, 76, 50), dark = rgb(84, 58, 42);
    const outer: V3[] = [], rim: V3[] = [], pool: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * 6.283, w = 0.84 + rand() * 0.3;
      outer.push([Math.cos(a) * 1.45 * w, 0, Math.sin(a) * 1.45 * w]);
      rim.push([Math.cos(a) * 1.05 * w, 0.26 + rand() * 0.1, Math.sin(a) * 1.05 * w]);
      pool.push([Math.cos(a) * 0.82 * w, 0.1, Math.sin(a) * 0.82 * w]);
    }
    const c: V3 = [0, 0.1, 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      m.tri(outer[i] as V3, outer[j] as V3, rim[j] as V3, shade(earth, 0.95 + rand() * 0.14), [0, -1, 0]);
      m.tri(outer[i] as V3, rim[j] as V3, rim[i] as V3, shade(earth, 0.95 + rand() * 0.14), [0, -1, 0]);
      m.tri(rim[i] as V3, rim[j] as V3, pool[j] as V3, shade(dark, 0.9 + rand() * 0.14), [0, 2, 0]);
      m.tri(rim[i] as V3, pool[j] as V3, pool[i] as V3, shade(dark, 0.9 + rand() * 0.14), [0, 2, 0]);
      m.tri(pool[i] as V3, pool[j] as V3, c, rgb(12, 10, 16), [0, -1, 0]);
    }
    m.tri([-0.38, 0.115, -0.1], [-0.08, 0.115, -0.26], [0, 0.115, -0.04], rgb(116, 118, 136), [0, -1, 0]);
    m.tri([0.2, 0.115, 0.16], [0.46, 0.115, 0.08], [0.34, 0.115, 0.3], rgb(72, 74, 92), [0, -1, 0]);
    limb(m, [1.05, 0.2, 0.2], [1.35, 0.74, 0.36], 0.035, 0.022, rgb(86, 62, 44), 4);
    limb(m, [-0.9, 0.2, -0.5], [-1.2, 0.62, -0.72], 0.035, 0.022, rgb(86, 62, 44), 4);
    return m.build();
  }
  // Chapéu de ferro: rocha oxidada aflorando em lajes baixas. Pedra solta e monte só no M4, quando minerar.
  const t = STAIN[type] ?? { rock: rgb(130, 110, 90), vein: rgb(150, 110, 70) };
  const rand = sequence(seed * 11 + 5);
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = rand() * 6.283, d = k === 0 ? 0 : 0.45 + rand() * 0.75, r = k === 0 ? 0.62 : 0.26 + rand() * 0.3;
    slab(m, Math.cos(a) * d, Math.sin(a) * d, r, k === 0 ? 0.34 : 0.14 + rand() * 0.16, t.rock, t.vein, seed + k * 3);
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
