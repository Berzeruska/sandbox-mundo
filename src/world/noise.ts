import type { Rng } from '../core/rng';

/**
 * Ruído de gradiente 3D (Perlin "melhorado"), com permutação embaralhada pela semente.
 * Amostrado diretamente no ponto 3D da esfera, então não tem emenda em lugar nenhum.
 */
export interface Noise3D {
  /** Valor em aproximadamente [-1, 1]. */
  (x: number, y: number, z: number): number;
}

export function createNoise3D(rng: Rng): Noise3D {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const t = p[i] as number;
    p[i] = p[j] as number;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] as number;

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number): number => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number): number => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x, y, z) => {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = (perm[X] as number) + Y;
    const AA = (perm[A] as number) + Z;
    const AB = (perm[A + 1] as number) + Z;
    const B = (perm[X + 1] as number) + Y;
    const BA = (perm[B] as number) + Z;
    const BB = (perm[B + 1] as number) + Z;
    return lerp(
      lerp(
        lerp(grad(perm[AA] as number, x, y, z), grad(perm[BA] as number, x - 1, y, z), u),
        lerp(grad(perm[AB] as number, x, y - 1, z), grad(perm[BB] as number, x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(perm[AA + 1] as number, x, y, z - 1), grad(perm[BA + 1] as number, x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1] as number, x, y - 1, z - 1), grad(perm[BB + 1] as number, x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  };
}

/** Soma de oitavas (fractal Brownian motion), normalizada para ~[-1, 1]. */
export function fbm(noise: Noise3D, x: number, y: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/** Ruído "de crista": picos finos e contínuos, bom para cordilheiras. Valor em [0, 1]. */
export function ridged(noise: Noise3D, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(noise(x * freq, y * freq, z * freq));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
