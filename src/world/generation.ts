import { createRng } from '../core/rng';
import type { WorldState } from './state';
import { createNoise3D, fbm, ridged } from './noise';
import { latLonToPoint, type Vec3 } from './cubesphere';

/** Profundidade máxima do oceano e altura máxima das montanhas geradas (metros). */
export const MAX_DEPTH = 5000;
export const MAX_HEIGHT = 5500;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Anda `angle` radianos a partir do ponto `p`, no rumo `bearing` (0 = norte). */
export function moveAlong(p: Vec3, bearing: number, angle: number): Vec3 {
  // Base local: leste e norte no ponto p.
  let ex = p[2];
  let ez = -p[0];
  const elen = Math.hypot(ex, ez) || 1;
  ex /= elen;
  ez /= elen;
  const nx = p[1] * ez;
  const ny = p[2] * ex - p[0] * ez;
  const nz = -p[1] * ex;
  const dx = Math.cos(bearing) * nx + Math.sin(bearing) * ex;
  const dy = Math.cos(bearing) * ny;
  const dz = Math.cos(bearing) * nz + Math.sin(bearing) * ez;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + dx * s, p[1] * c + dy * s, p[2] * c + dz * s];
}

/** Valor que deixa `fraction` dos elementos acima dele. */
export function thresholdForFraction(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - fraction) * sorted.length)));
  return sorted[idx] as number;
}

/**
 * Gera a elevação da Pangeia: um supercontinente (máscara num ponto aleatório, deformada por
 * ruído para não ficar redonda) somado a ruído fractal, com cordilheiras por ruído de crista.
 * A fração de terra é garantida escolhendo o limiar exato que deixa `landFraction` acima da água.
 */
export function generateTerrain(world: WorldState): void {
  const { seed, landFraction } = world.params;
  const rng = createRng(seed);
  const baseNoise = createNoise3D(rng);
  const warpNoise = createNoise3D(rng);
  const ridgeNoise = createNoise3D(rng);
  const ridgeMask = createNoise3D(rng);

  // Supercontinente = união de alguns "lobos" (calotas) em volta de um centro, com a borda
  // deformada por ruído. Isso dá um formato irregular, com baías e penínsulas, e não um círculo.
  const lat = rng.range(-0.6, 0.6);
  const lon = rng.range(-Math.PI, Math.PI);
  const center = latLonToPoint(lat, lon);
  const radius = Math.acos(1 - 2 * landFraction);
  const lobes: { p: Vec3; r: number }[] = [{ p: center, r: radius * 0.55 }];
  // Lobos espalhados ao longo de um eixo principal: o continente fica alongado e recortado.
  const axis = rng.range(0, Math.PI * 2);
  const lobeCount = rng.int(4, 6);
  for (let k = 0; k < lobeCount; k++) {
    const dir = axis + (k % 2 === 0 ? 0 : Math.PI) + rng.range(-0.9, 0.9);
    lobes.push({ p: moveAlong(center, dir, radius * rng.range(0.5, 1.05)), r: radius * rng.range(0.3, 0.5) });
  }
  const offset = rng.range(0, 100);

  const { positions } = world.grid;
  const n = world.cellCount;
  const raw = new Float32Array(n);
  const continent = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    const warp = 0.3 * fbm(warpNoise, x * 2 + offset, y * 2, z * 2, 3);
    let mask = 0;
    for (const lobe of lobes) {
      const dot = Math.min(1, Math.max(-1, x * lobe.p[0] + y * lobe.p[1] + z * lobe.p[2]));
      const d = Math.acos(dot) + warp;
      const m = smoothstep(lobe.r + 0.25, lobe.r - 0.25, d);
      if (m > mask) mask = m;
    }
    continent[i] = mask;
    // Ganho 0.6: as oitavas médias pesam mais, e a costa ganha baías e penínsulas.
    // Longe do continente o detalhe pesa menos, para o oceano não virar um arquipélago.
    const detail = fbm(baseNoise, x * 3.5, y * 3.5, z * 3.5, 6, 0.6);
    raw[i] = (mask * 2 - 1) * 0.5 + detail * (0.3 + 0.3 * mask);
  }

  const t = thresholdForFraction(raw, landFraction);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = raw[i] as number;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }

  for (let i = 0; i < n; i++) {
    const h = raw[i] as number;
    let elev: number;
    if (h > t) {
      const s = (h - t) / (hMax - t);
      const x = positions[i * 3] as number;
      const y = positions[i * 3 + 1] as number;
      const z = positions[i * 3 + 2] as number;
      // Cordilheiras: cristas finas, só em parte do continente e afastadas da costa.
      const ridge = ridged(ridgeNoise, x * 2.2, y * 2.2, z * 2.2, 3);
      const where = smoothstep(-0.15, 0.25, fbm(ridgeMask, x * 1.4, y * 1.4, z * 1.4, 2));
      const inland = smoothstep(0.02, 0.2, s);
      const mountains = Math.pow(ridge, 4) * where * inland * (continent[i] as number);
      elev = 1 + 1400 * Math.pow(s, 1.3) + (MAX_HEIGHT - 1400) * mountains;
    } else {
      const s = (t - h) / (t - hMin);
      // Plataforma continental rasa perto da costa, depois talude e planície abissal.
      const depth = s < 0.06 ? (s / 0.06) * 180 : 180 + (MAX_DEPTH - 180) * Math.pow((s - 0.06) / 0.94, 0.6);
      elev = -Math.max(5, depth);
    }
    world.elevation[i] = elev;
  }
}

/** Tamanho de cada massa de terra conectada, do maior para o menor. */
export function landComponents(world: WorldState): number[] {
  const { neighbors } = world.grid;
  const seen = new Uint8Array(world.cellCount);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < world.cellCount; s++) {
    if (seen[s] || world.isWater(s)) continue;
    seen[s] = 1;
    stack.push(s);
    let size = 0;
    while (stack.length) {
      const c = stack.pop() as number;
      size++;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        if (!seen[nb] && !world.isWater(nb)) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}
