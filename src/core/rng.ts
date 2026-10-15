/**
 * Gerador pseudoaleatório determinístico (sfc32).
 * Toda aleatoriedade da simulação passa por aqui: mesma semente = mesma sequência.
 */
export interface Rng {
  /** Número em [0, 1). */
  next(): number;
  /** Inteiro em [min, max] (inclusivo). */
  int(min: number, max: number): number;
  /** Número em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro sem sinal de 32 bits. */
  uint32(): number;
}

/** Transforma texto em semente de 32 bits (hash cyrb53 reduzido). */
export function hashString(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Aceita número inteiro ou texto. Texto numérico ("42") vira o número 42. */
export function seedFrom(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  return hashString(trimmed);
}

export function createRng(seed: number): Rng {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;

  const uint32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  // Aquece o estado para sementes parecidas divergirem logo.
  for (let i = 0; i < 15; i++) uint32();

  const next = (): number => uint32() / 4294967296;

  return {
    next,
    uint32,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
  };
}
