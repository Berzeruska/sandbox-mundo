import { ANIMALS, animalModel } from '../maquete/animals';
import { MODEL_FLOATS } from '../maquete/models';

/**
 * Ícone de cada espécie para o cartão "Vida" e para o globo: o próprio modelo da maquete visto de lado, pintado em 2D (as facetas de trás primeiro).
 * Assim o ícone é sempre o bicho da folha, sem imagem à parte.
 */
const cache = new Map<number, HTMLCanvasElement>();

export function speciesIcon(species: number, size = 56): HTMLCanvasElement {
  const key = species * 1000 + size;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = size; c.height = size;
  const m = animalModel(ANIMALS[species] as (typeof ANIMALS)[number], 'idle');
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let o = 0; o < m.length; o += MODEL_FLOATS) { x0 = Math.min(x0, m[o] as number); x1 = Math.max(x1, m[o] as number); y0 = Math.min(y0, m[o + 1] as number); y1 = Math.max(y1, m[o + 1] as number); }
  const k = (size - 6) / Math.max(x1 - x0, y1 - y0, 0.001), ox = (size - (x1 - x0) * k) / 2 - x0 * k, oy = size - (size - (y1 - y0) * k) / 2 + y0 * k;
  const tris: { z: number; o: number }[] = [];
  for (let o = 0; o < m.length; o += MODEL_FLOATS * 3) tris.push({ z: ((m[o + 2] as number) + (m[o + 12] as number) + (m[o + 22] as number)) / 3, o });
  tris.sort((a, b) => a.z - b.z);
  const g = c.getContext('2d');
  if (g) for (const t of tris) {
    const o = t.o, shade = 0.72 + 0.28 * Math.max(0, m[o + 5] as number) + 0.12 * (m[o + 4] as number);
    const ch = (i: number): number => Math.max(0, Math.min(255, Math.round((m[o + 6 + i] as number) * shade * 255)));
    g.fillStyle = `rgb(${ch(0)},${ch(1)},${ch(2)})`;
    g.beginPath();
    for (let v = 0; v < 3; v++) { const px = ox + (m[o + v * 10] as number) * k, py = oy - (m[o + v * 10 + 1] as number) * k; if (v) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath();
    g.fill();
  }
  cache.set(key, c);
  return c;
}
