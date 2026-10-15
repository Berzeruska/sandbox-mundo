/** Lado da textura 3D de ruído (64³ texels RGBA ≈ 1 MB na GPU). */
export const NOISE_SIZE = 64;

/**
 * Volume de ruído para o shader: 4 canais independentes de valores fixos por texel.
 * A GPU interpola entre os texels (filtro linear) e repete o volume (REPEAT), então o shader
 * lê ruído contínuo em qualquer ponto 3D com uma única leitura de textura, em vez de calcular
 * hashes por pixel a cada quadro. É só visual: não usa a semente nem a simulação.
 */
export function buildNoiseVolume(size = NOISE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  for (let i = 0; i < out.length; i++) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    out[i] = h & 255;
  }
  return out;
}
