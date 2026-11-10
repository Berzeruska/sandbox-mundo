/** Sorteio e ruído da maquete: mesma posição, mesmo resultado (regra 4), sem guardar nada. */

/** Número em [0, 1) a partir de três inteiros. */
export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = Math.imul(h ^ (h >>> 16), 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Ruído suave em aproximadamente [-1, 1], amostrado em 3D: não tem emenda em nenhuma aresta do cubo. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return 2 * l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  ) - 1;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Sequência determinística para montar os modelos. */
export function sequence(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
