import { BIOME_INFO, Biome } from '../world/biomes';
import { bakeProps, buildSkirts, buildTerrain, buildWater, newFields, reliefShade, stampShade, type Facet, type Fields, type Placement } from './chunk-build';
import { hash3, noise3, smoothstep } from './hash';
import { MODELS, pickModel, type ModelName } from './flora';
import { mixRgb, rgb, type Rgb } from './models';

/**
 * T1: a cena de `docs/img/referencias/estilo/folha-mestra.png` montada no motor da maquete. As posições foram lidas da folha, em pixels da imagem
 * (1672×941), e levadas ao chão por uma transformação de perspectiva. A cor vem do globo do M2 (decisão 2 de 2026-11-06), com o tom variando dentro do bioma.
 */
export const REPLICA_SIZE = 64;
export const CHUNK_CELLS = 32;
type P = readonly [number, number];

/** Quatro cantos da superfície na imagem: esquerda, fundo, direita, frente. */
const CORNERS: readonly P[] = [[20, 418], [838, 88], [1652, 400], [795, 800]];

function solveHomography(from: readonly P[], to: readonly P[]): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i] as P, [u, v] = to[i] as P;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let best = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs((a[r] as number[])[c] as number) > Math.abs((a[best] as number[])[c] as number)) best = r;
    const t = a[c] as number[];
    a[c] = a[best] as number[];
    a[best] = t;
    const row = a[c] as number[], pivot = row[c] as number;
    for (let k = c; k <= 8; k++) row[k] = (row[k] as number) / pivot;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const other = a[r] as number[], f = other[c] as number;
      for (let k = c; k <= 8; k++) other[k] = (other[k] as number) - f * (row[k] as number);
    }
  }
  return a.map((r) => r[8] as number);
}
const H = solveHomography(CORNERS, [[0, 0], [REPLICA_SIZE, 0], [REPLICA_SIZE, REPLICA_SIZE], [0, REPLICA_SIZE]]);
const scene = (p: P): P => {
  const h = H as [number, number, number, number, number, number, number, number];
  const w = h[6] * p[0] + h[7] * p[1] + 1;
  return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
};
const poly = (pts: readonly P[]): P[] => pts.map(scene);

/** Distância até o polígono: negativa dentro. */
function sd(pts: readonly P[], x: number, z: number): number {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as P, b = pts[j] as P;
    const ex = b[0] - a[0], ez = b[1] - a[1], wx = x - a[0], wz = z - a[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(wx - ex * t, wz - ez * t));
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

const TAIGA = poly([[10, 418], [240, 270], [520, 110], [650, 150], [660, 210], [470, 270], [400, 340], [240, 395], [120, 440]]);
const TEMPERATE = poly([[400, 345], [470, 270], [640, 210], [760, 225], [860, 260], [880, 320], [770, 360], [600, 385], [420, 360]]);
const SWAMP = poly([[215, 470], [330, 420], [560, 440], [720, 500], [700, 530], [650, 590], [560, 640], [470, 640], [330, 570], [230, 510]]);
const SAVANNA = poly([[760, 530], [960, 460], [1200, 470], [1370, 545], [1130, 680], [1040, 700], [900, 610]]);
const DESERT = poly([[1225, 345], [1450, 320], [1660, 400], [1380, 550], [1220, 475], [1240, 420]]);
const STEPPE = poly([[660, 165], [830, 85], [1000, 120], [1060, 210], [1240, 260], [1440, 300], [1450, 322], [1230, 345], [1050, 322], [1000, 280], [920, 240], [800, 180]]);
const LAKE = poly([[860, 370], [905, 345], [1000, 335], [1110, 330], [1220, 345], [1250, 380], [1200, 410], [1100, 425], [970, 420], [905, 400]]);
const ISLANDS = [poly([[882, 378], [925, 358], [968, 378], [925, 398]]), poly([[1118, 374], [1160, 354], [1202, 376], [1160, 394]])];

interface RiverNode { p: P; level: number; half: number }
const node = (x: number, y: number, level: number, half: number): RiverNode => ({ p: scene([x, y]), level, half });
const RIVER: readonly RiverNode[] = [
  node(1005, 195, 3.1, 0.9), node(965, 218, 3.1, 1), node(932, 240, 1.9, 1.2), node(925, 262, 1.9, 1.3), node(965, 285, 1.9, 1.4), node(1000, 300, 1.9, 1.4), node(1022, 330, 0, 1.6), node(1040, 345, 0, 2),
  node(945, 420, 0, 1.8), node(955, 450, 0, 1.7), node(905, 482, 0, 1.9), node(790, 497, 0, 2), node(715, 522, 0, 2), node(700, 565, 0, 2.1), node(758, 595, 0, 2.1), node(720, 628, 0, 2.2), node(640, 628, 0, 2.2), node(550, 642, 0, 2.4), node(490, 660, 0, 2.6),
];
const ROCK_BASE: Rgb = rgb(...(BIOME_INFO[Biome.Mountain]?.color ?? [124, 112, 100]));

const biomeRgb = (b: number): Rgb => { const c = BIOME_INFO[b]?.color ?? [255, 0, 255]; return rgb(c[0], c[1], c[2]); };
const GRASS = biomeRgb(Biome.Grassland), TAIGA_C = biomeRgb(Biome.Taiga), FOREST_C = biomeRgb(Biome.TemperateForest), SWAMP_C = biomeRgb(Biome.Swamp), SAVANNA_C = biomeRgb(Biome.Savanna), DESERT_C = biomeRgb(Biome.HotDesert), STEPPE_C = biomeRgb(Biome.Steppe);
const STONE_FLAT = rgb(216, 206, 178);
/** Chão de floresta: o verde do bioma fica nas copas; o chão clareia para o conjunto dar a cor do globo. */
const TAIGA_GROUND = mixRgb(TAIGA_C, GRASS, 0.62), FOREST_GROUND = mixRgb(FOREST_C, GRASS, 0.72), SWAMP_GROUND = mixRgb(SWAMP_C, GRASS, 0.35);

interface Peak { p: P; h: number; r: number }
const PEAKS: readonly Peak[] = [
  { p: scene([1160, 215]), h: 14, r: 10 },
  { p: scene([1285, 255]), h: 10, r: 7.5 },
  { p: scene([1062, 205]), h: 8.5, r: 6 },
];
const DUNES: readonly Peak[] = [{ p: scene([1385, 438]), h: 2.5, r: 4.6 }, { p: scene([1515, 388]), h: 1.7, r: 3.2 }];
const LATTICE = 2.5;
const MOUNT_POW = 0.92;

function peakHeight(x: number, z: number, list: readonly Peak[], pow: number): number {
  let h = 0;
  for (const k of list) {
    const d = Math.hypot(x - k.p[0], z - k.p[1]) / k.r;
    if (d < 1) h = Math.max(h, k.h * Math.pow(1 - d, pow));
  }
  return h;
}

const lvx = (ix: number, iz: number) => ix * LATTICE + (hash3(ix, iz, 1) - 0.5) * LATTICE * 0.72;
const lvz = (ix: number, iz: number) => iz * LATTICE + (hash3(ix, iz, 2) - 0.5) * LATTICE * 0.72;
/** Quanto a rede de facetas sobe em cada vértice: montanhas e dunas. */
function lift(ix: number, iz: number): number {
  const x = lvx(ix, iz), z = lvz(ix, iz);
  const m = peakHeight(x, z, PEAKS, MOUNT_POW), d = peakHeight(x, z, DUNES, 0.85);
  if (m > 0) return Math.max(0, m + (hash3(ix, iz, 3) - 0.5) * 3.4 * Math.min(1, m / 2.5) * (1 - Math.min(1, m / 15) * 0.5) + noise3(x * 0.35, 2.5, z * 0.35) * 1.8 * Math.min(1, m / 4));
  return d > 0 ? Math.max(0, d + (hash3(ix, iz, 3) - 0.5) * 0.45) : 0;
}
const SNOW_RGB: Rgb = rgb(...(BIOME_INFO[Biome.SnowyPeak]?.color ?? [222, 226, 232]));
const ROCK_LIGHT: Rgb = rgb(150, 122, 106);

/** Triângulos grandes de um pedaço. O pé de cada um toca o chão. */
function facetsOf(ox: number, oz: number, size: number): Facet[] {
  const out: Facet[] = [];
  const x0 = Math.floor(ox / LATTICE) - 2, x1 = Math.ceil((ox + size) / LATTICE) + 2, z0 = Math.floor(oz / LATTICE) - 2, z1 = Math.ceil((oz + size) / LATTICE) + 2;
  for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
    const flip = hash3(ix, iz, 4) < 0.5;
    const tris: readonly (readonly [number, number, number, number, number, number])[] = flip
      ? [[ix, iz, ix + 1, iz, ix + 1, iz + 1], [ix, iz, ix + 1, iz + 1, ix, iz + 1]]
      : [[ix, iz, ix + 1, iz, ix, iz + 1], [ix + 1, iz, ix + 1, iz + 1, ix, iz + 1]];
    for (let t = 0; t < 2; t++) {
      const v = tris[t] as readonly [number, number, number, number, number, number];
      const la = lift(v[0], v[1]), lb = lift(v[2], v[3]), lc = lift(v[4], v[5]);
      if (Math.max(la, lb, lc) < 0.25) continue;
      const ax = lvx(v[0], v[1]), az = lvz(v[0], v[1]), bx = lvx(v[2], v[3]), bz = lvz(v[2], v[3]), cx = lvx(v[4], v[5]), cz = lvz(v[4], v[5]);
      const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
      // Cada faceta pertence ao pedaço que tem o centro dela.
      if (mx < ox || mz < oz || mx >= ox + size || mz >= oz + size) continue;
      if (mx < 0 || mz < 0 || mx > REPLICA_SIZE || mz > REPLICA_SIZE) continue;
      const clip = (q: number) => Math.max(0, Math.min(REPLICA_SIZE, q));
      const pa = [clip(ax), clip(az)] as const, pb = [clip(bx), clip(bz)] as const, pc = [clip(cx), clip(cz)] as const;
      const ay = plainGround(pa[0], pa[1]) + la - 0.04, by = plainGround(pb[0], pb[1]) + lb - 0.04, cy = plainGround(pc[0], pc[1]) + lc - 0.04;
      const mean = (la + lb + lc) / 3, top = Math.max(la, lb, lc), id = (ix + 500) * 4001 + (iz + 500) * 2 + t, h = hash3(id, 91, 17);
      const onDune = Math.max(peakHeight(ax, az, PEAKS, MOUNT_POW), peakHeight(bx, bz, PEAKS, MOUNT_POW), peakHeight(cx, cz, PEAKS, MOUNT_POW)) <= 0;
      let color: Rgb, snow = false;
      if (onDune) {
        const k = 0.86 + h * 0.3;
        color = [DESERT_C[0] * 0.97 * k, DESERT_C[1] * 0.8 * k, DESERT_C[2] * 0.56 * k];
      } else if (snowFrac(mx, mz, mean) + (h - 0.5) * 0.22 > 0.76) {
        snow = true;
        const k = 0.97 + h * 0.05;
        color = [SNOW_RGB[0] * k * 1.05, SNOW_RGB[1] * k * 1.05, SNOW_RGB[2] * k * 1.05];
      } else if (top < 1.3) {
        const k = 0.9 + h * 0.2;
        color = [STEPPE_C[0] * 0.8 * k, STEPPE_C[1] * 0.82 * k, STEPPE_C[2] * 0.7 * k];
      } else {
        const t2 = hash3(id, 5, 3), k = 0.72 + h * 0.34;
        color = [(ROCK_BASE[0] + (ROCK_LIGHT[0] - ROCK_BASE[0]) * t2) * k, (ROCK_BASE[1] + (ROCK_LIGHT[1] - ROCK_BASE[1]) * t2) * 0.88 * k, (ROCK_BASE[2] + (ROCK_LIGHT[2] - ROCK_BASE[2]) * t2) * 0.86 * k];
      }
      const lightOf = (l: number) => 0.7 + 0.3 * Math.min(1, l / 2.5);
      out.push({ p: [pa[0], ay, pa[1], pb[0], by, pb[1], pc[0], cy, pc[1]], color, snow, light: [lightOf(la), lightOf(lb), lightOf(lc)] });
    }
  }
  return out;
}

/** Fração da altura do pico mais próximo: cada pico tem o próprio chapéu de neve. */
function snowFrac(x: number, z: number, mean: number): number {
  let best = 0;
  for (const k of PEAKS) if (Math.hypot(x - k.p[0], z - k.p[1]) < k.r) best = Math.max(best, mean / k.h);
  return best;
}

/** Chão sem rio: o pé das facetas. */
function plainGround(px: number, pz: number): number {
  const warp = noise3(px * 0.21, 3.1, pz * 0.21) * 1.5 + noise3(px * 0.6, 8.2, pz * 0.6) * 0.5;
  let y = 0.75 + noise3(px * 0.11, 4.2, pz * 0.11) * 0.28 + 0.36 * smoothstep(-0.07, 0.07, noise3(px * 0.075, 6.6, pz * 0.075)) + noise3(px * 0.55, 2.2, pz * 0.55) * 0.045;
  y += 0.22 * smoothstep(-0.07, 0.07, noise3(px * 0.14, 16.6, pz * 0.14));
  y += 1.9 * smoothstep(0.75, -0.75, sd(STEPPE, px, pz) + warp * 0.5);
  y += 0.35 * smoothstep(3, -3, sd(DESERT, px, pz) + warp);
  return y;
}

function nearestRiver(x: number, z: number): { d: number; level: number; half: number } {
  let best = { d: Infinity, level: 0, half: 1 };
  for (let i = 0; i + 1 < RIVER.length; i++) {
    if (i === 7) continue; // o lago liga os dois trechos
    const a = RIVER[i] as RiverNode, b = RIVER[i + 1] as RiverNode;
    const ex = b.p[0] - a.p[0], ez = b.p[1] - a.p[1], wx = x - a.p[0], wz = z - a.p[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const d = Math.hypot(wx - ex * t, wz - ez * t);
    if (d < best.d) best = { d, level: t < 0.5 ? a.level : b.level, half: a.half + (b.half - a.half) * t };
  }
  return best;
}

const mix3 = (out: [number, number, number], c: Rgb, t: number): void => {
  out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t;
};

function fillFields(f: Fields, ox: number, oz: number): void {
  const s = f.stride, m = f.margin;
  const color: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const k = j * s + i, x = ox + i - m, z = oz + j - m;
    const onBorder = x <= 0 || z <= 0 || x >= REPLICA_SIZE || z >= REPLICA_SIZE;
    f.jx[k] = onBorder ? 0 : (hash3(x, z, 21) - 0.5) * 0.62;
    f.jz[k] = onBorder ? 0 : (hash3(x, z, 22) - 0.5) * 0.62;
    const px = x + (f.jx[k] as number), pz = z + (f.jz[k] as number);
    // Limites irregulares: o bioma não termina em linha reta.
    const warp = noise3(px * 0.21, 3.1, pz * 0.21) * 1.5 + noise3(px * 0.6, 8.2, pz * 0.6) * 0.5;
    const sTaiga = sd(TAIGA, px, pz) + warp, sTemp = sd(TEMPERATE, px, pz) + warp, sSwamp = sd(SWAMP, px, pz) + warp, sSav = sd(SAVANNA, px, pz) + warp, sDes = sd(DESERT, px, pz) + warp, sSte = sd(STEPPE, px, pz) + warp;
    color[0] = GRASS[0]; color[1] = GRASS[1]; color[2] = GRASS[2];
    mix3(color, SAVANNA_C, smoothstep(1.6, -1.6, sSav));
    mix3(color, DESERT_C, smoothstep(1.2, -1.2, sDes));
    mix3(color, STEPPE_C, smoothstep(1.6, -1.6, sSte));
    if (sSte < 0) mix3(color, STONE_FLAT, smoothstep(0.22, 0.34, noise3(px * 0.42, 14.4, pz * 0.42) + smoothstep(-2, -7, sSte) * 0.16));
    mix3(color, SWAMP_GROUND, smoothstep(1.6, -1.6, sSwamp));
    mix3(color, FOREST_GROUND, smoothstep(2, -2, sTemp));
    mix3(color, TAIGA_GROUND, smoothstep(2, -2, sTaiga));
    // Variação de tom dentro do bioma: manchas grandes e pequenas, sem mudar a média.
    const patch = noise3(px * 0.13, 1.7, pz * 0.13) * 0.12 + noise3(px * 0.37, 5.4, pz * 0.37) * 0.07;
    const warm = noise3(px * 0.09, 9.9, pz * 0.09) * 0.075;
    f.r[k] = color[0] * (1 + patch + warm);
    f.g[k] = color[1] * (1 + patch);
    f.b[k] = color[2] * (1 + patch - warm);
    // Relevo: planícies com patamares baixos.
    let y = plainGround(px, pz);
    // Pântano: charcos.
    const pondN = noise3(px * 0.46, 7.7, pz * 0.46) + noise3(px * 1.1, 1.1, pz * 1.1) * 0.34;
    const inSwamp = smoothstep(0.5, -2.5, sSwamp);
    if (inSwamp > 0) {
      y = y + (0.42 - y) * inSwamp * 0.75;
      f.water[k] = 0.32;
      f.marsh[k] = 1;
      if (pondN > -0.04) y = y + (0.08 - y) * smoothstep(-0.04, 0.1, pondN) * inSwamp;
    }
    // Rio e lago.
    const r = nearestRiver(px, pz);
    const wobble = noise3(px * 0.35, 12.3, pz * 0.35) * 0.45;
    const dR = r.d - r.half + wobble;
    const dL = Math.max(sd(LAKE, px, pz) + wobble, ...ISLANDS.map((p) => -sd(p, px, pz)));
    const useLake = dL < dR;
    const d = useLake ? dL : dR;
    const level = useLake ? 0 : r.level;
    if (d < 6) {
      // A água desce em patamares: o chão acompanha, para o rio não correr por cima dele.
      if (level > y - 0.4) y = y + (level + 0.45 - y) * smoothstep(5.5, 2, d);
      y = y + (level + 0.26 - y) * smoothstep(3.2, 0.6, d);
      y = y + (level - 0.9 - y) * smoothstep(0.55, -0.9, d);
      if (d < 3) f.water[k] = level;
      f.sand[k] = smoothstep(2.15, 1.1, d + noise3(px * 0.5, 3.3, pz * 0.5) * 0.45);
    }
    // Debaixo das facetas o chão sobe junto, um pouco mais baixo, e não aparece.
    const m0 = peakHeight(px, pz, PEAKS, MOUNT_POW), d0 = peakHeight(px, pz, DUNES, 0.85);
    if (m0 > 0.6 || d0 > 0.5) y += Math.max(m0, d0) - 1.4;
    f.y[k] = y;
  }
  reliefShade(f, 0.16);
}

/** Altura do chão no ponto, igual à malha. */
function groundAt(fieldsOf: (x: number, z: number) => { f: Fields; ox: number; oz: number }, x: number, z: number): number {
  const { f, ox, oz } = fieldsOf(x, z);
  const lx = x - ox + f.margin, lz = z - oz + f.margin, i = Math.floor(lx), j = Math.floor(lz), tx = lx - i, tz = lz - j, s = f.stride;
  const a = f.y[j * s + i] as number, b = f.y[j * s + i + 1] as number, c = f.y[(j + 1) * s + i] as number, d = f.y[(j + 1) * s + i + 1] as number;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export interface ReplicaChunk {
  ox: number;
  oz: number;
  terrain: ArrayBuffer;
  water: ArrayBuffer;
  props: ArrayBuffer;
  skirts: ArrayBuffer;
  skirtRanges: [number, number][];
}

/** Monta os quatro pedaços da cena. */
export function buildReplica(): ReplicaChunk[] {
  const count = REPLICA_SIZE / CHUNK_CELLS;
  const all: { f: Fields; ox: number; oz: number }[] = [];
  for (let cz = 0; cz < count; cz++) for (let cx = 0; cx < count; cx++) {
    const f = newFields(CHUNK_CELLS, 3), ox = cx * CHUNK_CELLS, oz = cz * CHUNK_CELLS;
    fillFields(f, ox, oz);
    all.push({ f, ox, oz });
  }
  const fieldsOf = (x: number, z: number) => all[Math.min(count - 1, Math.max(0, Math.floor(z / CHUNK_CELLS))) * count + Math.min(count - 1, Math.max(0, Math.floor(x / CHUNK_CELLS)))] as { f: Fields; ox: number; oz: number };
  const places: Placement[][] = all.map(() => []);
  const wetAt = (x: number, z: number): boolean => {
    const { f, ox, oz } = fieldsOf(x, z);
    const k = Math.round(z - oz + f.margin) * f.stride + Math.round(x - ox + f.margin);
    const water = f.water[k] as number, y = f.y[k] as number;
    return (water !== -Infinity && water > y - 0.15) || (f.sand[k] as number) > 0.4;
  };
  const rockAt = (x: number, z: number): number => Math.max(peakHeight(x, z, PEAKS, MOUNT_POW), peakHeight(x, z, DUNES, 0.85));
  const steepAt = (x: number, z: number): boolean => Math.abs(groundAt(fieldsOf, x + 0.7, z) - groundAt(fieldsOf, x - 0.7, z)) + Math.abs(groundAt(fieldsOf, x, z + 0.7) - groundAt(fieldsOf, x, z - 0.7)) > 1.25;
  const put = (name: ModelName, x: number, z: number, scale: number, stretch = 1, shadeRadius = 0, shadeStrength = 0, tint = 1): void => {
    if (x < 0.4 || z < 0.4 || x > REPLICA_SIZE - 0.4 || z > REPLICA_SIZE - 0.4) return;
    const h = hash3(Math.round(x * 7), Math.round(z * 7), 77);
    const slot = Math.min(count - 1, Math.floor(z / CHUNK_CELLS)) * count + Math.min(count - 1, Math.floor(x / CHUNK_CELLS));
    const warm = name === 'rock' || name === 'sandRock' ? 0 : (hash3(Math.round(x * 3), Math.round(z * 3), 79) - 0.5) * 0.16;
    (places[slot] as Placement[]).push({ model: pickModel(name, h), x, y: groundAt(fieldsOf, x, z) - 0.04, z, scale, stretch, yaw: h * 6.283, tint: [tint * (1 + warm), tint, tint * (1 - warm)] });
    if (shadeRadius > 0) for (const a of all) stampShade(a.f, x, z, shadeRadius, shadeStrength, a.ox, a.oz);
  };
  const at = (name: ModelName, ix: number, iy: number, scale: number, stretch = 1, radius = 0, strength = 0): void => {
    const q = scene([ix, iy]);
    if (rockAt(q[0], q[1]) > 0.4 || (name !== 'swamp' && wetAt(q[0], q[1]))) return;
    put(name, q[0], q[1], scale, stretch, radius, strength);
  };
  const free = (x: number, z: number) => !wetAt(x, z) && rockAt(x, z) < 0.3 && !steepAt(x, z);

  // Copas: matas agrupadas, com tamanhos variados, em vez de uma grade.
  const step = 1.82;
  for (let gz = 0; gz * step < REPLICA_SIZE; gz++) for (let gx = 0; gx * step < REPLICA_SIZE; gx++) {
    const x = (gx + 0.5 + (hash3(gx, gz, 31) - 0.5) * 0.85) * step, z = (gz + 0.5 + (hash3(gx, gz, 32) - 0.5) * 0.85) * step;
    if (x < 0.8 || z < 0.8 || x > REPLICA_SIZE - 0.8 || z > REPLICA_SIZE - 0.8 || !free(x, z)) continue;
    const pick1 = hash3(gx, gz, 33), size = hash3(gx, gz, 34);
    const edgeT = sd(TAIGA, x, z), edgeF = sd(TEMPERATE, x, z);
    if (edgeT < 0) {
      const inner = smoothstep(0, -5, edgeT);
      if (pick1 < 0.72 + inner * 0.28) put('pine', x, z, (0.92 + size * size * 0.72) * (0.84 + inner * 0.3), 1.08, 1.8, 0.3);
    } else if (edgeF < 0) {
      const inner = smoothstep(0, -4, edgeF);
      if (pick1 < 0.16 + inner * 0.3) {
        const kind: ModelName = hash3(gx, gz, 35) < 0.3 + inner * 0.2 ? 'broad' : 'round';
        put(kind, x, z, (0.8 + size * 0.55) * (0.85 + inner * 0.22), 1, 2.2, 0.3);
      }
    } else if (edgeF < 3 && pick1 < 0.1) put('round', x, z, 0.46 + size * 0.3, 1, 1.4, 0.28);
    else if (edgeT < 3 && pick1 < 0.1) put('pine', x, z, 0.46 + size * 0.34, 1, 1.2, 0.26);
  }
  // Árvores de destaque, na posição da folha.
  for (const [x, y, k] of [[880, 545, 1.35], [1088, 462, 0.95], [1147, 478, 1.5], [1203, 532, 1.2]] as const) at('savanna', x, y, k, 1, 2.4, 0.3);
  for (const [x, y, k] of [[1008, 622, 1.25], [952, 655, 0.8], [1025, 655, 0.7], [932, 620, 0.55]] as const) at('round', x, y, k, 1, 2, 0.3);
  for (const [x, y, k] of [[297, 452, 1.35], [405, 475, 1.35], [425, 528, 1.25], [478, 562, 1.2], [560, 512, 1.35], [642, 545, 1.2]] as const) at('swamp', x, y, k, 1, 2, 0.28);
  for (const [x, y] of [[1150, 270], [1190, 262], [1218, 245], [1254, 218], [1292, 240], [1327, 245], [1000, 165], [970, 170]] as const) at('pine', x, y, 0.72 + hash3(x, y, 2) * 0.32, 1, 1.6, 0.28);
  for (const [x, y, k] of [[1325, 358, 0.86], [1483, 332, 0.72], [1575, 410, 0.98], [1282, 462, 0.66], [1470, 465, 1.04], [1450, 472, 0.56], [968, 570, 0.5]] as const) at('cactus', x, y, k, 1, 0.8, 0.2);
  for (const [x, y, k] of [[832, 110, 1.3], [880, 112, 1.1], [680, 420, 1.2], [575, 452, 1], [1385, 494, 1.05], [1490, 338, 0.9], [885, 685, 0.95], [782, 652, 0.9], [1120, 625, 1], [1085, 570, 0.72], [1000, 522, 0.75], [1420, 505, 0.6], [1250, 590, 0.72]] as const) at('rock', x, y, k, 1, 1, 0.26);
  for (const q of ISLANDS) {
    const c = q.reduce((a, b) => [a[0] + b[0] / q.length, a[1] + b[1] / q.length] as P, [0, 0] as P);
    put('bush', c[0], c[1], 1.3, 1, 1, 0.2);
    put('bush', c[0] + 0.9, c[1] - 0.3, 0.9, 1, 1, 0.2);
  }

  // Chão: tufos, arbustos e pedras.
  const small = 1.72;
  for (let gz = 0; gz * small < REPLICA_SIZE; gz++) for (let gx = 0; gx * small < REPLICA_SIZE; gx++) {
    const x = (gx + 0.5 + (hash3(gx, gz, 41) - 0.5) * 0.9) * small, z = (gz + 0.5 + (hash3(gx, gz, 42) - 0.5) * 0.9) * small;
    if (x < 0.7 || z < 0.7 || x > REPLICA_SIZE - 0.7 || z > REPLICA_SIZE - 0.7 || !free(x, z)) continue;
    // Agrupados: em manchas, com vazios entre elas.
    const clump = noise3(x * 0.22, 3.3, z * 0.22) + noise3(x * 0.6, 2.2, z * 0.6) * 0.3;
    const r = hash3(gx, gz, 43), size = hash3(gx, gz, 44);
    const inForest = sd(TAIGA, x, z) < -0.5 || sd(TEMPERATE, x, z) < -0.5;
    if (inForest) { if (r < 0.12) put('bush', x, z, 0.5 + size * 0.3); continue; }
    if (sd(SWAMP, x, z) < 0) {
      if (r < 0.46) put('reed', x, z, 0.62 + size * 0.42);
      else if (r < 0.68) put('bush', x, z, 0.45 + size * 0.42);
      continue;
    }
    if (sd(DESERT, x, z) < 0) { if (r < 0.035) put('dryBush', x, z, 0.5 + size * 0.3); else if (r < 0.05) put('sandRock', x, z, 0.5 + size * 0.35); continue; }
    const dry = sd(SAVANNA, x, z) < 0 || sd(STEPPE, x, z) < 0;
    if (clump < -0.08) continue;
    if (r < 0.46) put(dry ? 'dryBush' : 'bush', x, z, 0.55 + size * 0.62, 1, 0.8, 0.14);
    else if (r < 0.62) put('tuft', x, z, 0.55 + size * 0.4);
    else if (r < 0.66) put('rock', x, z, 0.38 + size * 0.34, 1, 0.8, 0.18);
  }

  // Espuma no pé das quedas.
  for (const [x, y] of [[1022, 338], [930, 248]] as const) for (let k = 0; k < 7; k++) {
    const q = scene([x, y]), t = k * 2.4, r = 0.35 + hash3(k, x, 3) * 0.75;
    const px = q[0] + Math.cos(t) * r, pz = q[1] + Math.sin(t) * r;
    const slot = Math.min(count - 1, Math.floor(pz / CHUNK_CELLS)) * count + Math.min(count - 1, Math.floor(px / CHUNK_CELLS));
    (places[slot] as Placement[]).push({ model: MODELS.foam[k % 2] as Float32Array, x: px, y: (y === 338 ? 0 : 1.9) - 0.05, z: pz, scale: 0.5 + hash3(k, y, 4) * 0.4, stretch: 0.8, yaw: t, tint: [1, 1, 1] });
  }

  return all.map(({ f, ox, oz }, k) => {
    const skirts = buildSkirts(f, ox, oz, 3);
    return { ox, oz, terrain: buildTerrain(f, ox, oz, 7, facetsOf(ox, oz, CHUNK_CELLS)), water: buildWater(f, ox, oz, {}), props: bakeProps(places[k] as Placement[]), skirts: skirts.data, skirtRanges: skirts.ranges };
  });
}
