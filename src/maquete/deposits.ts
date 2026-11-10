import { Resource } from '../world/resources';
import { sequence } from './hash';
import { farModels, limb, Model, rgb, setFarModels, type Rgb, type V3 } from './models';

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

/**
 * Cores tiradas de `recursos/jazidas.png`: a rocha de cada minério e a cor que marca o minério (o verde-azulado do cobre, a ferrugem do ferro, o amarelo do enxofre).
 * `top`: o que a folha mostra por cima da rocha (cristais, cubos).
 */
const STAIN: Partial<Record<number, { rock: Rgb; vein: Rgb; mark?: Rgb; top?: 'crystal' | 'cube' }>> = {
  [Resource.Copper]: { rock: rgb(184, 112, 72), vein: rgb(30, 152, 150), mark: rgb(36, 96, 176) },
  [Resource.Silver]: { rock: rgb(146, 150, 160), vein: rgb(218, 222, 232) },
  [Resource.Gold]: { rock: rgb(152, 140, 120), vein: rgb(240, 192, 52) },
  [Resource.Iron]: { rock: rgb(122, 100, 92), vein: rgb(204, 66, 40) },
  [Resource.Manganese]: { rock: rgb(58, 42, 64), vein: rgb(30, 20, 38) },
  [Resource.Chromium]: { rock: rgb(40, 104, 66), vein: rgb(70, 150, 96) },
  [Resource.Tin]: { rock: rgb(168, 168, 172), vein: rgb(214, 214, 220) },
  [Resource.Bauxite]: { rock: rgb(196, 92, 58), vein: rgb(152, 56, 42) },
  [Resource.Niobium]: { rock: rgb(118, 142, 164), vein: rgb(166, 192, 212) },
  [Resource.RareEarths]: { rock: rgb(110, 80, 152), vein: rgb(156, 118, 198), top: 'crystal' },
  [Resource.Lithium]: { rock: rgb(198, 188, 162), vein: rgb(246, 246, 246), top: 'cube' },
  [Resource.Coal]: { rock: rgb(30, 30, 34), vein: rgb(56, 56, 62) },
  [Resource.Uranium]: { rock: rgb(124, 128, 116), vein: rgb(136, 240, 56), top: 'crystal' },
  [Resource.Potash]: { rock: rgb(224, 150, 150), vein: rgb(242, 190, 188) },
  [Resource.Nitrates]: { rock: rgb(228, 208, 162), vein: rgb(242, 228, 190) },
  [Resource.Salt]: { rock: rgb(228, 228, 226), vein: rgb(252, 252, 254), top: 'cube' },
  [Resource.Sulfur]: { rock: rgb(232, 204, 52), vein: rgb(252, 238, 84), top: 'crystal' },
  [Resource.Limestone]: { rock: rgb(222, 212, 188), vein: rgb(242, 234, 214) },
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Cor da mancha no chão em volta do afloramento: a cor que marca o minério, para a jazida se ler de longe. */
export function oreStain(type: number): Rgb {
  const t = STAIN[type];
  if (!t) return rgb(130, 110, 90);
  // Onde a marca é quase da cor da rocha (carvão, sal), a mancha é a própria rocha.
  return mix(t.vein, t.rock, type === Resource.Coal || type === Resource.Manganese ? 0.6 : 0.3);
}

/** Laje angulosa de rocha aflorando: faces da rocha e faces da cor do minério. */
function slab(m: Model, x: number, z: number, r: number, h: number, t: { rock: Rgb; vein: Rgb; mark?: Rgb }, seed: number): void {
  const rand = sequence(seed * 19 + 3), sides = 6, ring: V3[] = [], top: V3[] = [];
  const tilt = (rand() - 0.5) * 0.5, ta = rand() * 6.283;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 6.283 + rand() * 0.5, q = r * (0.72 + rand() * 0.42), ax = x + Math.cos(a) * q, az = z + Math.sin(a) * q;
    ring.push([ax, -0.04, az]);
    // Topo inclinado: a laje sai do chão de um lado, como rocha aflorando.
    top.push([x + Math.cos(a) * q * 0.7, h * (0.7 + rand() * 0.4) * (1 + Math.cos(a - ta) * tilt), z + Math.sin(a) * q * 0.7]);
  }
  const mid: V3 = [x, h * 1.06, z], inside: V3 = [x, h * 0.2, z];
  const pick = (): Rgb => {
    const q = rand();
    return q < 0.34 ? shade(t.vein, 0.9 + rand() * 0.16) : q < 0.44 && t.mark ? shade(t.mark, 0.9 + rand() * 0.16) : shade(t.rock, 0.86 + rand() * 0.22);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.tri(top[i] as V3, top[j] as V3, mid, pick(), inside);
    const c = pick();
    m.tri(ring[i] as V3, ring[j] as V3, top[j] as V3, shade(c, 0.84), inside, [0.76, 0.76, 1]);
    m.tri(ring[i] as V3, top[j] as V3, top[i] as V3, shade(c, 0.84), inside, [0.76, 1, 1]);
  }
}

/** Cristal em ponta (urânio, enxofre, terras raras), preso à rocha. */
function crystal(m: Model, x: number, y: number, z: number, h: number, r: number, color: Rgb, seed: number): void {
  const rand = sequence(seed * 23 + 7), lean: V3 = [x + (rand() - 0.5) * h * 0.5, y + h, z + (rand() - 0.5) * h * 0.5], inside: V3 = [x, y + h * 0.3, z];
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * 6.283, a1 = ((i + 1) / 4) * 6.283;
    m.tri([x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], lean, shade(color, 0.86 + i * 0.07), inside, [0.85, 0.85, 1]);
  }
}

/** Cubo de sal ou de lítio, meio enterrado. */
function cube(m: Model, x: number, y: number, z: number, e: number, color: Rgb, seed: number): void {
  const rand = sequence(seed * 29 + 11), a = rand() * 1.57, c = Math.cos(a) * e, s = Math.sin(a) * e;
  const base: V3[] = [[x + c, y, z + s], [x - s, y, z + c], [x - c, y, z - s], [x + s, y, z - c]];
  const up = base.map((q) => [q[0], y + e * 1.3, q[2]] as V3), inside: V3 = [x, y + e * 0.6, z];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, k = 0.86 + (i % 2) * 0.1;
    m.tri(base[i] as V3, base[j] as V3, up[j] as V3, shade(color, k), inside, [0.8, 0.8, 1]);
    m.tri(base[i] as V3, up[j] as V3, up[i] as V3, shade(color, k), inside, [0.8, 1, 1]);
  }
  m.tri(up[0] as V3, up[1] as V3, up[2] as V3, color, inside);
  m.tri(up[0] as V3, up[2] as V3, up[3] as V3, color, inside);
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
  // Chapéu de ferro: rocha oxidada aflorando, com a cor do minério. Pedra solta e monte só no M4, quando minerar.
  const t = STAIN[type] ?? { rock: rgb(130, 110, 90), vein: rgb(150, 110, 70) };
  const rand = sequence(seed * 11 + 5);
  const n = farModels() ? 4 : 7;
  for (let k = 0; k < n; k++) {
    const a = rand() * 6.283, d = k === 0 ? 0 : 0.7 + rand() * 1.15, r = k === 0 ? 0.95 : 0.36 + rand() * 0.42, h = k === 0 ? 0.62 : 0.2 + rand() * 0.34;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    slab(m, x, z, r, h, t, seed + k * 3);
    if (t.top && k < 4 && !farModels()) {
      const q = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < q; i++) {
        const cx = x + (rand() - 0.5) * r * 0.9, cz = z + (rand() - 0.5) * r * 0.9;
        if (t.top === 'crystal') crystal(m, cx, h * 0.6, cz, 0.5 + rand() * 0.45, 0.13 + rand() * 0.06, t.vein, seed + k * 7 + i);
        else cube(m, cx, h * 0.55, cz, 0.2 + rand() * 0.14, t.vein, seed + k * 7 + i);
      }
    }
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
