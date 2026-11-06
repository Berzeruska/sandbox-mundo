import { Biome } from '../world/biomes';
import { bakeProps, buildSkirts, buildTerrain, buildWater, newFields, reliefShade, stampShade, type Facet, type Fields, type Placement } from './chunk-build';
import { CHUNK_CELLS, CHUNK_COARSE, coarseIndex, DETAIL, finePoint, resolveFine } from './chart';
import { biomeRgb, pickModel, type ModelName } from './flora';
import { hash3, noise3, smoothstep } from './hash';
import { rgb, type Rgb } from './models';

/** O chão de todas as células grandes, copiado da simulação. A cor é a do globo (`rgba`, bioma nos 4 bits baixos do alfa). */
export interface CoarseWorld {
  n: number;
  height: Int16Array;
  rgba: Uint8Array;
  cover: Uint8Array;
  state: Uint8Array;
  deposit: Uint8Array;
  ice: Uint8Array;
}

export interface MaqueteChunkOut {
  terrain: ArrayBuffer;
  water: ArrayBuffer;
  props: ArrayBuffer;
  skirts: ArrayBuffer;
  skirtRanges: [number, number][];
}

const MARGIN_COARSE = 3;
const PATCH = CHUNK_COARSE + MARGIN_COARSE * 2;
const LATTICE = 2.5;
const MOUNTAIN_START = 1900;
const GRASS = biomeRgb(Biome.Grassland), BEACH = biomeRgb(Biome.Beach), SNOW = biomeRgb(Biome.SnowyPeak);
const ROCK_LIGHT: Rgb = rgb(150, 122, 106);
/** Chão de floresta: o verde do bioma fica nas copas, o chão clareia para o conjunto dar a cor do globo. */
const GROUND_MIX: Record<number, number> = { [Biome.Taiga]: 0.62, [Biome.TemperateForest]: 0.72, [Biome.TropicalForest]: 0.66, [Biome.Swamp]: 0.35, [Biome.Mountain]: 0.5 };


/** Altura em metros → altura na maquete: costa suave, montanha sem exagero. */
export function elevationY(m: number): number {
  if (m >= 0) return 0.62 * (1 - Math.exp(-m / 70)) + 0.00125 * m;
  return Math.max(-3.2, -0.5 * (1 - Math.exp(m / 70)) + 0.0009 * m);
}

const PEAK_GRID = 22;
/**
 * Montanha como picos separados (`bioma/montanhas-vulcao.png`, "Cadeia de montanhas"): cada ponto de uma grade larga pode levantar um pico, da altura que o mundo tem ali.
 * Quanto mais alto o terreno, mais perto e mais alto o pico. Entre eles fica chão.
 */
function peakLift(X: number, Z: number, face: number, metersAt: (x: number, z: number) => number): number {
  const gx = Math.floor(X / PEAK_GRID), gz = Math.floor(Z / PEAK_GRID);
  let best = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = gx + dx, iz = gz + dz;
    const px = (ix + 0.5 + (hash3(ix, iz, 31 + face) - 0.5) * 0.7) * PEAK_GRID, pz = (iz + 0.5 + (hash3(ix, iz, 37 + face) - 0.5) * 0.7) * PEAK_GRID;
    const m = metersAt(px, pz);
    if (m < MOUNTAIN_START) continue;
    const rise = Math.min(1, (m - MOUNTAIN_START) / 2200), h = (5.5 + rise * 12) * (0.62 + hash3(ix, iz, 41 + face) * 0.38);
    const radius = (0.5 + rise * 0.28 + hash3(ix, iz, 43 + face) * 0.16) * PEAK_GRID;
    const d = Math.hypot(X - px, Z - pz) / radius;
    if (d < 1) best = Math.max(best, h * Math.pow(1 - d, 1.2));
  }
  return best;
}

const TERRACE = 0.62;
/** Terraços ligados: patamares planos e encosta curta entre eles. */
function terrace(y: number, wobble: number, step = TERRACE): number {
  const k = (y + wobble) / step, fl = Math.floor(k), fr = k - fl;
  return step * (fl + smoothstep(0.74, 0.98, fr)) - wobble * 0.15;
}

function bspline(t: number, w: Float32Array): void {
  const u = 1 - t, t2 = t * t, t3 = t2 * t;
  w[0] = (u * u * u) / 6;
  w[1] = (3 * t3 - 6 * t2 + 4) / 6;
  w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  w[3] = t3 / 6;
}

class Patch {
  readonly h = new Float32Array(PATCH * PATCH);
  readonly r = new Float32Array(PATCH * PATCH);
  readonly g = new Float32Array(PATCH * PATCH);
  readonly b = new Float32Array(PATCH * PATCH);
  readonly wr = new Float32Array(PATCH * PATCH);
  readonly wg = new Float32Array(PATCH * PATCH);
  readonly wb = new Float32Array(PATCH * PATCH);
  readonly biome = new Uint8Array(PATCH * PATCH);
  readonly cover = new Float32Array(PATCH * PATCH);
  readonly state = new Uint8Array(PATCH * PATCH);
  readonly ice = new Uint8Array(PATCH * PATCH);
  highest = -Infinity;
  private wx = new Float32Array(4);
  private wz = new Float32Array(4);

  constructor(w: CoarseWorld, face: number, private x0: number, private z0: number) {
    const n = w.n, sea = biomeRgb(Biome.ShallowOcean);
    for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
      const c = coarseIndex(n, face, x0 + i, n - 1 - (z0 + j)), k = j * PATCH + i;
      const m = w.height[c] as number, a = w.rgba[c * 4 + 3] as number, biome = a & 15, state = w.state[c] as number;
      const ice = w.ice[c] as number;
      // Gelo no mar: uma placa baixa por cima da água.
      this.h[k] = ice && m < 12 ? 12 : m;
      this.biome[k] = biome;
      this.cover[k] = (w.cover[c] as number) / 255;
      this.state[k] = state;
      this.ice[k] = ice;
      if (m > this.highest) this.highest = m;
      let r = (w.rgba[c * 4] as number) / 255, g = (w.rgba[c * 4 + 1] as number) / 255, b = (w.rgba[c * 4 + 2] as number) / 255;
      if (m <= 0 && !ice) {
        this.wr[k] = r; this.wg[k] = g; this.wb[k] = b;
        r = BEACH[0]; g = BEACH[1]; b = BEACH[2];
      } else {
        this.wr[k] = sea[0]; this.wg[k] = sea[1]; this.wb[k] = sea[2];
        const t = state === 0 ? (GROUND_MIX[biome] ?? 0) : 0;
        if (t > 0) { r += (GRASS[0] - r) * t; g += (GRASS[1] - g) * t; b += (GRASS[2] - b) * t; }
      }
      this.r[k] = r; this.g[k] = g; this.b[k] = b;
    }
  }

  /** Altura suave em metros, em coordenadas finas do plano. */
  height(X: number, Z: number): number {
    const u = X / DETAIL - 0.5 - this.x0, v = Z / DETAIL - 0.5 - this.z0;
    const iu = Math.max(1, Math.min(PATCH - 3, Math.floor(u))), iv = Math.max(1, Math.min(PATCH - 3, Math.floor(v)));
    bspline(Math.max(0, Math.min(1, u - iu)), this.wx);
    bspline(Math.max(0, Math.min(1, v - iv)), this.wz);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      const row = (iv - 1 + j) * PATCH + iu - 1, wj = this.wz[j] as number;
      for (let i = 0; i < 4; i++) s += (this.h[row + i] as number) * (this.wx[i] as number) * wj;
    }
    return s;
  }

  /** Mistura de um campo: bilinear com a passagem apertada, para o limite do bioma não ficar um borrão. */
  field(a: Float32Array, X: number, Z: number): number {
    const u = X / DETAIL - 0.5 - this.x0, v = Z / DETAIL - 0.5 - this.z0;
    const iu = Math.max(0, Math.min(PATCH - 2, Math.floor(u))), iv = Math.max(0, Math.min(PATCH - 2, Math.floor(v)));
    const tu = smoothstep(0.18, 0.82, u - iu), tv = smoothstep(0.18, 0.82, v - iv);
    const k = iv * PATCH + iu;
    return ((a[k] as number) * (1 - tu) + (a[k + 1] as number) * tu) * (1 - tv) + ((a[k + PATCH] as number) * (1 - tu) + (a[k + PATCH + 1] as number) * tu) * tv;
  }

  nearest(X: number, Z: number): number {
    const iu = Math.max(0, Math.min(PATCH - 1, Math.floor(X / DETAIL) - this.x0)), iv = Math.max(0, Math.min(PATCH - 1, Math.floor(Z / DETAIL) - this.z0));
    return iv * PATCH + iu;
  }
}

const NOISE_SCALE = (size: number) => (size * 2) / Math.PI;

/** Forma do chão num ponto do plano: o que a malha e as facetas usam. */
class Ground {
  private p: [number, number, number] = [0, 0, 0];
  sx = 0; sy = 0; sz = 0;
  constructor(private w: CoarseWorld, private face: number, private patch: Patch) {}

  locate(X: number, Z: number): void {
    const size = this.w.n * DETAIL, r = resolveFine(this.face, X, size - Z, size);
    finePoint(r.face, Math.max(0, Math.min(size, r.x)), Math.max(0, Math.min(size, r.y)), size, this.p);
    const s = NOISE_SCALE(size);
    // No canto do cubo, a textura do chão não estica junto com o leque.
    if (r.fan) { this.sx = X * 1.003; this.sy = 311; this.sz = Z * 1.003; return; }
    this.sx = this.p[0] * s; this.sy = this.p[1] * s; this.sz = this.p[2] * s;
  }

  /** Metros, com a costa e os limites ondulados. */
  meters(X: number, Z: number): number {
    const { sx, sy, sz } = this;
    const wx = noise3(sx * 0.13, sy * 0.13, sz * 0.13) * 2.4 + noise3(sx * 0.41, sy * 0.41, sz * 0.41) * 0.7;
    const wz = noise3(sy * 0.13 + 7, sz * 0.13, sx * 0.13) * 2.4 + noise3(sy * 0.41 + 3, sz * 0.41, sx * 0.41) * 0.7;
    return this.patch.height(X + wx, Z + wz);
  }

  /** Altura do chão sem as facetas. */
  plainY(m: number, desert: number): number {
    const { sx, sy, sz } = this;
    let y = elevationY(m);
    if (y > 0.15) {
      const wobble = noise3(sx * 0.07, sy * 0.07, sz * 0.07) * 0.42 + noise3(sx * 0.2, sy * 0.2, sz * 0.2) * 0.1;
      const stepped = terrace(y, wobble, desert > 0.5 ? TERRACE * 2.4 : TERRACE);
      y = Math.max(0.2, stepped);
      y += noise3(sx * 0.31, sy * 0.31, sz * 0.31) * 0.09;
    }
    return y;
  }
}

function fill(w: CoarseWorld, f: Fields, face: number, ox: number, oz: number, patch: Patch, ground: Ground, biomeGrid: Uint8Array, coverGrid: Float32Array): void {
  const s = f.stride, m = f.margin, size = w.n * DETAIL;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const k = j * s + i, X = ox + i - m, Z = oz + j - m;
    const inside = X > 0 && Z > 0 && X < size && Z < size;
    if (inside) {
      f.jx[k] = (hash3(face * 4099 + X, Z, 21) - 0.5) * 0.62;
      f.jz[k] = (hash3(face * 4099 + X, Z, 22) - 0.5) * 0.62;
    }
    const px = X + (f.jx[k] as number), pz = Z + (f.jz[k] as number);
    ground.locate(px, pz);
    const { sx, sy, sz } = ground;
    const wx = noise3(sx * 0.17, sy * 0.17, sz * 0.17) * 2.8 + noise3(sx * 0.5, sy * 0.5, sz * 0.5) * 0.9;
    const wz = noise3(sz * 0.17 + 5, sx * 0.17, sy * 0.17) * 2.8 + noise3(sz * 0.5 + 9, sx * 0.5, sy * 0.5) * 0.9;
    const cx = px + wx, cz = pz + wz;
    const near = patch.nearest(cx, cz), biome = patch.biome[near] as number;
    biomeGrid[k] = biome;
    coverGrid[k] = patch.cover[near] as number;
    const tone = noise3(sx * 0.13, sy * 0.13 + 1.7, sz * 0.13) * 0.12 + noise3(sx * 0.37, sy * 0.37 + 5.4, sz * 0.37) * 0.07;
    const warm = noise3(sx * 0.09 + 9.9, sy * 0.09, sz * 0.09) * 0.075;
    const r0 = patch.field(patch.r, cx, cz), g0 = patch.field(patch.g, cx, cz), b0 = patch.field(patch.b, cx, cz);
    const quiet = (patch.state[near] as number) === 0 ? 1 : 0.3;
    f.r[k] = r0 * (1 + (tone + warm) * quiet);
    f.g[k] = g0 * (1 + tone * quiet);
    f.b[k] = b0 * (1 + (tone - warm) * quiet);
    f.wr[k] = patch.field(patch.wr, cx, cz);
    f.wg[k] = patch.field(patch.wg, cx, cz);
    f.wb[k] = patch.field(patch.wb, cx, cz);
    const meters = ground.meters(px, pz);
    const desert = biome === Biome.HotDesert || biome === Biome.ColdDesert ? 1 : 0;
    let y = ground.plainY(meters, desert);
    if (meters < 200) f.water[k] = 0;
    const cold = biome === Biome.Tundra || biome === Biome.Taiga || biome === Biome.Ice || biome === Biome.SnowyPeak;
    if (!cold && (patch.ice[near] as number) === 0) f.sand[k] = smoothstep(0.62, 0.44, y + noise3(sx * 0.5, sy * 0.5, sz * 0.5) * 0.12);
    if (patch.highest >= MOUNTAIN_START) {
      const lift = peakLift(px, pz, face, (x, z) => patch.height(x, z));
      // Debaixo das facetas o chão sobe menos, para nunca furar.
      if (lift > 1) y += (lift - 1) * 0.55;
      f.peak[k] = lift;
    }
    f.y[k] = y;
  }
  reliefShade(f, 0.16);
}

const lvx = (ix: number, iz: number, face: number) => ix * LATTICE + (hash3(ix, iz, 1 + face) - 0.5) * LATTICE * 0.72;
const lvz = (ix: number, iz: number, face: number) => iz * LATTICE + (hash3(ix, iz, 11 + face) - 0.5) * LATTICE * 0.72;

/** Montanha como rede de triângulos grandes: facetas retas, em cima do chão. */
function buildFacets(w: CoarseWorld, face: number, ox: number, oz: number, patch: Patch, ground: Ground): Facet[] {
  const out: Facet[] = [];
  if (patch.highest < MOUNTAIN_START) return out;
  const size = w.n * DETAIL;
  const cache = new Map<number, { x: number; z: number; lift: number; y: number; snow: number }>();
  const vertex = (ix: number, iz: number) => {
    const key = (ix + 1024) * 4096 + iz + 1024;
    let v = cache.get(key);
    if (!v) {
      // Na aresta da face o vértice não se move: as duas faces se encontram no mesmo ponto.
      const x = Math.max(0, Math.min(size, lvx(ix, iz, face))), z = Math.max(0, Math.min(size, lvz(ix, iz, face)));
      ground.locate(x, z);
      const meters = ground.meters(x, z), base = peakLift(x, z, face, (a, b) => patch.height(a, b));
      const rough = base > 0.3 ? (hash3(ix, iz, 3 + face) - 0.35) * 1.5 * Math.min(1, base / 2) + (noise3(ground.sx * 0.35, ground.sy * 0.35, ground.sz * 0.35) + 0.4) * 1.2 * Math.min(1, base / 3.5) : 0;
      const lift = Math.max(0, base + rough);
      const near = patch.nearest(x, z);
      v = { x, z, lift, y: ground.plainY(meters, 0) + lift - 0.04, snow: patch.biome[near] === Biome.SnowyPeak || (patch.ice[near] as number) === 1 ? 1 : 0 };
      cache.set(key, v);
    }
    return v;
  };
  const x0 = Math.floor(ox / LATTICE) - 2, x1 = Math.ceil((ox + CHUNK_CELLS) / LATTICE) + 2, z0 = Math.floor(oz / LATTICE) - 2, z1 = Math.ceil((oz + CHUNK_CELLS) / LATTICE) + 2;
  for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
    const flip = hash3(ix, iz, 4 + face) < 0.5;
    for (let t = 0; t < 2; t++) {
      const a = flip ? (t === 0 ? vertex(ix, iz) : vertex(ix, iz)) : (t === 0 ? vertex(ix, iz) : vertex(ix + 1, iz));
      const b = flip ? (t === 0 ? vertex(ix + 1, iz) : vertex(ix + 1, iz + 1)) : (t === 0 ? vertex(ix + 1, iz) : vertex(ix + 1, iz + 1));
      const c = flip ? (t === 0 ? vertex(ix + 1, iz + 1) : vertex(ix, iz + 1)) : (t === 0 ? vertex(ix, iz + 1) : vertex(ix, iz + 1));
      if (Math.max(a.lift, b.lift, c.lift) < 0.25) continue;
      const mx = (a.x + b.x + c.x) / 3, mz = (a.z + b.z + c.z) / 3;
      if (mx < ox || mz < oz || mx >= ox + CHUNK_CELLS || mz >= oz + CHUNK_CELLS) continue;
      const mean = (a.lift + b.lift + c.lift) / 3, top = Math.max(a.lift, b.lift, c.lift);
      const id = (ix + 2048) * 8192 + (iz + 2048) * 2 + t, h = hash3(id, 91, 17 + face);
      const near = patch.nearest(mx, mz);
      const snowy = (a.snow + b.snow + c.snow) / 3;
      let color: Rgb, snow = false;
      // Chapéu de neve: os picos altos pegam neve no topo; onde o globo é branco, a neve desce.
      if ((mean > 8.2 + (h - 0.5) * 2.4) || snowy + (h - 0.5) * 0.7 + (mean > 2 ? 0.12 : -0.2) > 0.62) {
        snow = true;
        const k = 0.99 + h * 0.05;
        color = [SNOW[0] * k * 1.05, SNOW[1] * k * 1.05, SNOW[2] * k * 1.05];
      } else if (top < 1.2) {
        const k = 0.86 + h * 0.2;
        const r = patch.r[near] as number, g = patch.g[near] as number, bl = patch.b[near] as number;
        color = [r * k, g * k, bl * k];
      } else {
        const t2 = hash3(id, 5, 3), k = 0.72 + h * 0.34;
        const base = biomeRgb(Biome.Mountain);
        color = [(base[0] + (ROCK_LIGHT[0] - base[0]) * t2) * k, (base[1] + (ROCK_LIGHT[1] - base[1]) * t2) * 0.88 * k, (base[2] + (ROCK_LIGHT[2] - base[2]) * t2) * 0.86 * k];
      }
      const lightOf = (l: number) => 0.7 + 0.3 * Math.min(1, l / 2.5);
      out.push({ p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], color, snow, light: [lightOf(a.lift), lightOf(b.lift), lightOf(c.lift)] });
    }
  }
  return out;
}

interface Canopy { model: ModelName; chance: number; scale: number; spread: number; cluster: number }
/** Copas por bioma: `chance` por ponto da grade; `cluster` aperta em matas (0 = espalhado). */
const CANOPY: Partial<Record<number, readonly Canopy[]>> = {
  [Biome.Taiga]: [{ model: 'pine', chance: 0.92, scale: 1.08, spread: 0.72, cluster: 0.55 }],
  [Biome.TemperateForest]: [{ model: 'broad', chance: 0.2, scale: 0.86, spread: 0.55, cluster: 0.45 }, { model: 'round', chance: 0.26, scale: 0.86, spread: 0.55, cluster: 0.45 }],
  [Biome.TropicalForest]: [{ model: 'broad', chance: 0.3, scale: 1, spread: 0.6, cluster: 0.3 }, { model: 'round', chance: 0.2, scale: 1, spread: 0.6, cluster: 0.3 }],
  [Biome.Grassland]: [{ model: 'round', chance: 0.012, scale: 0.8, spread: 0.5, cluster: 0.2 }],
  [Biome.Savanna]: [{ model: 'savanna', chance: 0.03, scale: 1.05, spread: 0.55, cluster: 0.2 }],
  [Biome.Swamp]: [{ model: 'swamp', chance: 0.09, scale: 1.05, spread: 0.4, cluster: 0 }],
  [Biome.HotDesert]: [{ model: 'cactus', chance: 0.012, scale: 0.8, spread: 0.5, cluster: 0 }],
  [Biome.Mountain]: [{ model: 'pine', chance: 0.14, scale: 0.8, spread: 0.5, cluster: 0.35 }],
};
interface GroundKind { model: ModelName; chance: number; scale: number; spread: number }
const FLOOR: Partial<Record<number, readonly GroundKind[]>> = {
  [Biome.Taiga]: [{ model: 'bush', chance: 0.1, scale: 0.5, spread: 0.3 }],
  [Biome.TemperateForest]: [{ model: 'bush', chance: 0.12, scale: 0.5, spread: 0.3 }, { model: 'tuft', chance: 0.05, scale: 0.6, spread: 0.3 }],
  [Biome.TropicalForest]: [{ model: 'bush', chance: 0.2, scale: 0.6, spread: 0.4 }],
  [Biome.Grassland]: [{ model: 'bush', chance: 0.32, scale: 0.55, spread: 0.62 }, { model: 'tuft', chance: 0.2, scale: 0.55, spread: 0.4 }, { model: 'rock', chance: 0.03, scale: 0.42, spread: 0.34 }],
  [Biome.Steppe]: [{ model: 'dryBush', chance: 0.22, scale: 0.5, spread: 0.5 }, { model: 'tuft', chance: 0.2, scale: 0.5, spread: 0.4 }, { model: 'rock', chance: 0.03, scale: 0.42, spread: 0.3 }],
  [Biome.Savanna]: [{ model: 'dryBush', chance: 0.3, scale: 0.55, spread: 0.6 }, { model: 'tuft', chance: 0.14, scale: 0.55, spread: 0.4 }, { model: 'rock', chance: 0.03, scale: 0.42, spread: 0.3 }],
  [Biome.Swamp]: [{ model: 'reed', chance: 0.42, scale: 0.62, spread: 0.42 }, { model: 'bush', chance: 0.2, scale: 0.45, spread: 0.42 }],
  [Biome.HotDesert]: [{ model: 'dryBush', chance: 0.02, scale: 0.5, spread: 0.3 }, { model: 'sandRock', chance: 0.02, scale: 0.5, spread: 0.35 }],
  [Biome.ColdDesert]: [{ model: 'sandRock', chance: 0.03, scale: 0.5, spread: 0.35 }, { model: 'dryBush', chance: 0.03, scale: 0.45, spread: 0.3 }],
  [Biome.Tundra]: [{ model: 'dryBush', chance: 0.08, scale: 0.4, spread: 0.3 }, { model: 'rock', chance: 0.03, scale: 0.4, spread: 0.3 }],
  [Biome.Mountain]: [{ model: 'rock', chance: 0.08, scale: 0.5, spread: 0.5 }, { model: 'bush', chance: 0.16, scale: 0.5, spread: 0.4 }],
};

function scatter(f: Fields, face: number, ox: number, oz: number, ground: Ground, biomeGrid: Uint8Array, coverGrid: Float32Array): Placement[] {
  const out: Placement[] = [];
  const s = f.stride, m = f.margin, size = CHUNK_CELLS;
  const yAt = (lx: number, lz: number): number => {
    const i = Math.floor(lx) + m, j = Math.floor(lz) + m, tx = lx + m - i, tz = lz + m - j;
    const a = f.y[j * s + i] as number, b = f.y[j * s + i + 1] as number, c = f.y[(j + 1) * s + i] as number, d = f.y[(j + 1) * s + i + 1] as number;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  const usable = (lx: number, lz: number): number => {
    const k = (Math.round(lz) + m) * s + Math.round(lx) + m;
    const y = f.y[k] as number, water = f.water[k] as number;
    if ((water !== -Infinity && water > y - 0.2) || (f.sand[k] as number) > 0.4 || (f.peak[k] as number) > 0.5) return -1;
    if (Math.abs(yAt(Math.min(size, lx + 0.7), lz) - yAt(Math.max(0, lx - 0.7), lz)) + Math.abs(yAt(lx, Math.min(size, lz + 0.7)) - yAt(lx, Math.max(0, lz - 0.7))) > 1.05) return -1;
    return k;
  };
  const seed = face * 131 + ox * 3 + oz * 7;
  const put = (name: ModelName, lx: number, lz: number, scale: number, radius: number, strength: number): void => {
    const h = hash3(seed, Math.round(lx * 7), Math.round(lz * 7));
    const warm = name === 'rock' || name === 'sandRock' ? 0 : (hash3(Math.round(lx * 3), Math.round(lz * 3), seed) - 0.5) * 0.16;
    out.push({ model: pickModel(name, h), x: lx + ox, y: yAt(lx, lz) - 0.04, z: lz + oz, scale, stretch: 1, yaw: h * 6.283, tint: [1 + warm, 1, 1 - warm] });
    if (radius > 0) stampShade(f, lx + ox, lz + oz, radius, strength, ox, oz);
  };
  const step = 1.82, gridN = Math.ceil(size / step);
  for (let gz = 0; gz < gridN; gz++) for (let gx = 0; gx < gridN; gx++) {
    const lx = (gx + 0.5 + (hash3(seed, gx * 2, gz) - 0.5) * 0.85) * step, lz = (gz + 0.5 + (hash3(seed, gx * 2 + 1, gz) - 0.5) * 0.85) * step;
    if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
    const k = usable(lx, lz);
    if (k < 0) continue;
    const list = CANOPY[biomeGrid[k] as number];
    if (!list) continue;
    ground.locate(lx + ox, lz + oz);
    const mass = noise3(ground.sx * 0.06, ground.sy * 0.06, ground.sz * 0.06) + noise3(ground.sx * 0.19, ground.sy * 0.19, ground.sz * 0.19) * 0.35;
    const r = hash3(seed, gx, gz * 3 + 1);
    let edge = 0;
    for (const c of list) {
      const inside = c.cluster > 0 ? smoothstep(-c.cluster, c.cluster * 0.6, mass) : 1;
      edge += c.chance * inside * (coverGrid[k] as number);
      if (r < edge) {
        const size2 = hash3(seed, gx, gz * 3 + 2);
        const base = (c.scale + size2 * size2 * c.spread) * (0.82 + inside * 0.28);
        put(c.model, lx, lz, base, 2, 0.3);
        break;
      }
    }
  }
  const small = 1.72, smallN = Math.ceil(size / small);
  for (let gz = 0; gz < smallN; gz++) for (let gx = 0; gx < smallN; gx++) {
    const lx = (gx + 0.5 + (hash3(seed, gx * 2 + 9, gz) - 0.5) * 0.9) * small, lz = (gz + 0.5 + (hash3(seed, gx * 2 + 10, gz) - 0.5) * 0.9) * small;
    if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
    const k = usable(lx, lz);
    if (k < 0) continue;
    const list = FLOOR[biomeGrid[k] as number];
    if (!list) continue;
    ground.locate(lx + ox, lz + oz);
    const clump = noise3(ground.sx * 0.22, ground.sy * 0.22, ground.sz * 0.22) + noise3(ground.sx * 0.6, ground.sy * 0.6, ground.sz * 0.6) * 0.3;
    if (clump < -0.08) continue;
    const r = hash3(seed, gx, gz * 3 + 7);
    let edge = 0;
    for (const c of list) {
      edge += c.chance * (coverGrid[k] as number);
      if (r < edge) {
        const size2 = hash3(seed, gx, gz * 3 + 8);
        put(c.model, lx, lz, c.scale + size2 * c.spread, c.model === 'rock' ? 0.8 : 0.8, 0.14);
        break;
      }
    }
  }
  return out;
}

/** Um pedaço inteiro, nas coordenadas da própria face. */
export function buildWorldChunk(w: CoarseWorld, face: number, cx: number, cz: number): MaqueteChunkOut {
  const f = newFields(CHUNK_CELLS, 3), ox = cx * CHUNK_CELLS, oz = cz * CHUNK_CELLS;
  const patch = new Patch(w, face, cx * CHUNK_COARSE - MARGIN_COARSE, cz * CHUNK_COARSE - MARGIN_COARSE);
  const ground = new Ground(w, face, patch);
  const biomeGrid = new Uint8Array(f.stride * f.stride), coverGrid = new Float32Array(f.stride * f.stride);
  fill(w, f, face, ox, oz, patch, ground, biomeGrid, coverGrid);
  const places = scatter(f, face, ox, oz, ground, biomeGrid, coverGrid);
  const facets = buildFacets(w, face, ox, oz, patch, ground);
  const skirts = buildSkirts(f, ox, oz, 3);
  return { terrain: buildTerrain(f, ox, oz, face + 7, facets), water: buildWater(f, ox, oz, {}), props: bakeProps(places), skirts: skirts.data, skirtRanges: skirts.ranges };
}
