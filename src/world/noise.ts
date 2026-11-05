import type { Rng } from '../core/rng';

/** Os 16 gradientes do Perlin "melhorado" (x, y, z), na ordem do hash & 15. */
const GRAD = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * Ruído de gradiente 3D (Perlin "melhorado"), com permutação embaralhada pela semente.
 * Amostrado diretamente no ponto 3D da esfera, então não tem emenda em lugar nenhum.
 *
 * É uma classe (e não uma função criada por mundo) de propósito: todas as instâncias usam o
 * mesmo código, então o motor JavaScript otimiza uma vez e continua rápido a cada mundo novo.
 * Com funções criadas por mundo, o 2º mundo em diante gerava ~2,5× mais devagar.
 */
export class Noise3D {
  private perm: Uint8Array;

  constructor(rng: Rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i] as number;
      p[i] = p[j] as number;
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] as number;
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const g = (hash & 15) * 3;
    return (GRAD[g] as number) * x + (GRAD[g + 1] as number) * y + (GRAD[g + 2] as number) * z;
  }

  /** Valor em aproximadamente [-1, 1]. */
  sample(x: number, y: number, z: number): number {
    const perm = this.perm;
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
        lerp(this.grad(perm[AA] as number, x, y, z), this.grad(perm[BA] as number, x - 1, y, z), u),
        lerp(this.grad(perm[AB] as number, x, y - 1, z), this.grad(perm[BB] as number, x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(this.grad(perm[AA + 1] as number, x, y, z - 1), this.grad(perm[BA + 1] as number, x - 1, y, z - 1), u),
        lerp(this.grad(perm[AB + 1] as number, x, y - 1, z - 1), this.grad(perm[BB + 1] as number, x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }
}

/** Atalho: cria um ruído com a semente do gerador. */
export function createNoise3D(rng: Rng): Noise3D {
  return new Noise3D(rng);
}

/** Soma de oitavas (fractal Brownian motion), normalizada para ~[-1, 1]. */
export function fbm(noise: Noise3D, x: number, y: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.sample(x * freq, y * freq, z * freq);
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
    const r = 1 - Math.abs(noise.sample(x * freq, y * freq, z * freq));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
