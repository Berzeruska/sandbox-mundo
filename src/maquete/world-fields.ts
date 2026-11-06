import { Biome, BIOME_INFO } from '../world/biomes';
import { bakeProps, buildSkirts, buildTerrain, buildWater, newFields, reliefShade, stampShade, type Facet, type Fields, type Placement } from './chunk-build';
import { CHUNK_CELLS, CHUNK_COARSE, coarseIndex, DETAIL, finePoint, resolveFine } from './chart';
import { CellState } from '../world/disasters/ground';
import { biomeRgb, pickModel, pickModelFar } from './flora';
import { plant, type PlantState, type Species } from './plants';
import { hash3, noise3, smoothstep } from './hash';
import { ANIMALS, FAUNA, SWIMMERS } from './animals';
import { RIVER_FLOW, type Hydro } from './rivers';
import { depositSize, depositType, isHiddenOil, Resource } from '../world/resources';
import { depositModel, surfaceOil } from './deposits';
import { logModel, rgb, type Rgb } from './models';

/** O chão de todas as células grandes, copiado da simulação. A cor é a do globo (`rgba`, bioma nos 4 bits baixos do alfa). */
export interface CoarseWorld {
  n: number;
  height: Int16Array;
  rgba: Uint8Array;
  cover: Uint8Array;
  state: Uint8Array;
  deposit: Uint8Array;
  ice: Uint8Array;
  /** Temperatura em °C. */
  temp: Int8Array;
  /** Vulcões: 1 adormecido, 2 em erupção. */
  volcano: Uint8Array;
}

export interface MaqueteChunkOut {
  terrain: ArrayBuffer;
  water: ArrayBuffer;
  props: ArrayBuffer;
  propsFar: ArrayBuffer;
  skirts: ArrayBuffer;
  skirtRanges: [number, number][];
  /** Grupos de animais: espécie, x, z (na face), sorteio. */
  animals: Float32Array;
  /** Chamas: x, y, z por célula em chamas. */
  flames: Float32Array;
  /** Vulcões em erupção: x, y, z da cratera. */
  vents: Float32Array;
  /** Chão de 33×33 pontos para os animais andarem. */
  walkY: Float32Array;
  /** 0 terra; 1 impedido; 2 água funda; 3 água de enchente ou tsunami. */
  walkMask: Uint8Array;
}

const LOG = logModel(1);
const MARGIN_COARSE = 3;
const PATCH = CHUNK_COARSE + MARGIN_COARSE * 2;
const LATTICE = 2.5;
const MOUNTAIN_START = 1900;
const GRASS = biomeRgb(Biome.Grassland), BEACH = biomeRgb(Biome.Beach), SNOW = biomeRgb(Biome.SnowyPeak);
const ROCK_LIGHT: Rgb = rgb(150, 122, 106);
const ICE_WATER: Rgb = rgb(186, 218, 236);
const CRATER: Rgb = rgb(62, 50, 48), LAVA: Rgb = rgb(250, 128, 30), ROCK_DARK: Rgb = rgb(108, 82, 70), DUNE: Rgb = rgb(226, 156, 72);
/** Chão de floresta: o verde do bioma fica nas copas, o chão clareia para o conjunto dar a cor do globo. */
const GROUND_MIX: Record<number, number> = { [Biome.Taiga]: 0.42, [Biome.TemperateForest]: 0.36, [Biome.TropicalForest]: 0.1, [Biome.Swamp]: 0.08, [Biome.Mountain]: 0.42 };
const BIOME_FIX: Partial<Record<number, readonly [number, number, number]>> = { [Biome.Savanna]: [1.14, 0.98, 0.92], [Biome.TropicalForest]: [0.45, 1.02, 0.8], [Biome.Taiga]: [1.05, 1.15, 1.45], [Biome.TemperateForest]: [0.72, 1.12, 1.02], [Biome.Mountain]: [1.1, 1.18, 1.18], [Biome.Swamp]: [0.82, 0.96, 0.9] };
/** Como a cor do bioma aparece no globo: medido no corte, por canal (o relevo e a luz do globo tiram mais azul). */
const globeR = (c: number): number => Math.max(0, c * 0.95 - 0.03), globeG = (c: number): number => Math.max(0, c * 1.06 - 0.04), globeB = (c: number): number => Math.max(0, c * 1.05 - 0.125);


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
export type ReliefMode = 'terraco' | 'lisa' | 'rampa' | 'degrau';
let relief: ReliefMode = 'terraco';
let stones: 'pilhas' | 'miudas' = 'pilhas';
let oil: 'pocas' | 'unica' = 'pocas';
/** Opções para o usuário decidir nas capturas (`?relevo=`, `?pedras=`, `?oleo=` na URL). */
export function setRelief(mode: ReliefMode): void { relief = mode; }
export function setDepositLook(s: string, o: string): void { stones = s === 'miudas' ? 'miudas' : 'pilhas'; oil = o === 'unica' ? 'unica' : 'pocas'; }

/** Marcada por `terrace`: o último ponto caiu na encosta entre dois patamares. */
let onBank = false;
/** Largura da encosta em células finas, por opção. */
const BANK_WIDTH: Record<ReliefMode, number> = { terraco: 1.3, rampa: 5, degrau: 0.55, lisa: 0 };

/**
 * Terraços ligados (padrão, `bioma/degraus-e-rampas.png`, blocos 4 e 5): patamares planos e uma encosta de largura fixa entre eles, com terra à mostra.
 * `gradient` é quanto o terreno sobe por célula: sem ele a encosta ficaria larga onde o terreno é suave, e o degrau sumiria. As outras opções mudam só a largura.
 */
function terrace(y: number, wobble: number, step = TERRACE, gradient = 0.02): number {
  onBank = false;
  if (relief === 'lisa') return y;
  const k = (y + wobble) / step, fl = Math.floor(k), fr = k - fl;
  const width = Math.min(0.9, Math.max(0.02, (gradient * BANK_WIDTH[relief]) / step));
  const t = smoothstep(1 - width, 1, fr);
  onBank = relief !== 'rampa' && t > 0.02 && t < 0.98;
  return step * (fl + t) - wobble * 0.15;
}
const stepY = (y: number, wobble: number): number => (y > 0.15 ? Math.max(0.2, terrace(y, wobble)) : y);

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
  readonly temp = new Int8Array(PATCH * PATCH);
  /** 1 onde a célula é mar: a areia só nasce perto dele. */
  readonly sea = new Float32Array(PATCH * PATCH);
  readonly cell = new Int32Array(PATCH * PATCH);
  /** Fundo e borda da cratera do meteoro; água por cima da terra (enchente, tsunami). */
  readonly impact = new Float32Array(PATCH * PATCH);
  readonly ejecta = new Float32Array(PATCH * PATCH);
  readonly surge = new Float32Array(PATCH * PATCH);
  readonly lake = new Float32Array(PATCH * PATCH);
  readonly lakeY = new Float32Array(PATCH * PATCH);
  highest = -Infinity;
  hasDesert = false;
  volcanoes: { x: number; z: number; awake: boolean }[] = [];
  private wx = new Float32Array(4);
  private wz = new Float32Array(4);

  constructor(w: CoarseWorld, hydro: Hydro | null, face: number, readonly x0: number, readonly z0: number) {
    const n = w.n, sea = biomeRgb(Biome.ShallowOcean);
    for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
      const c = coarseIndex(n, face, x0 + i, n - 1 - (z0 + j)), k = j * PATCH + i;
      const m = w.height[c] as number, a = w.rgba[c * 4 + 3] as number, biome = a & 15, state = w.state[c] as number;
      const ice = w.ice[c] as number;
      this.cell[k] = c;
      this.h[k] = m;
      if (state === CellState.Impact) this.impact[k] = 1;
      if (state === CellState.Ejecta) this.ejecta[k] = 1;
      if (state === CellState.Surge || state === CellState.Flooded || state === CellState.Wave || state === CellState.Meltwater || state === CellState.Lake) this.surge[k] = 1;
      if (biome === Biome.HotDesert) this.hasDesert = true;
      const v = w.volcano[c] as number;
      if (v) this.volcanoes.push({ x: (x0 + i + 0.5) * DETAIL, z: (z0 + j + 0.5) * DETAIL, awake: v === 2 });
      if (hydro && hydro.lake[c] && !ice) {
        this.lake[k] = 1;
        this.lakeY[k] = Math.max(0.05, stepY(elevationY(hydro.filled[c] as number), 0) - 0.05);
      }
      this.biome[k] = biome;
      this.cover[k] = (w.cover[c] as number) / 255;
      this.state[k] = state;
      this.ice[k] = ice;
      this.temp[k] = w.temp[c] as number;
      if (m > this.highest) this.highest = m;
      // Rachadura: o chão fica com a cor do bioma e a fenda é desenhada por cima (C7); o quase preto do globo virava uma mancha na maquete (A6).
      const cracked = state === CellState.Crack ? (BIOME_INFO[biome]?.color ?? [120, 120, 100]) : null;
      const r0 = (cracked ? cracked[0] : (w.rgba[c * 4] as number)) / 255, g0 = (cracked ? cracked[1] : (w.rgba[c * 4 + 1] as number)) / 255, b0 = (cracked ? cracked[2] : (w.rgba[c * 4 + 2] as number)) / 255;
      let r = globeR(r0), g = globeG(g0), b = globeB(b0);
      // Queimado na maquete: chão de carvão com um pouco da terra, não uma mancha preta.
      if (state === CellState.Burned || state === CellState.Burning || state === CellState.Ash) { r = r * 0.45 + 0.13; g = g * 0.45 + 0.11; b = b * 0.45 + 0.1; }
      if (m <= 0) {
        this.sea[k] = ice ? 0 : 1;
        // Mar congelado: água clara e placas de gelo por cima (`bioma/agua.png`).
        if (ice) { this.wr[k] = ICE_WATER[0]; this.wg[k] = ICE_WATER[1]; this.wb[k] = ICE_WATER[2]; } else { this.wr[k] = r0 * 0.8; this.wg[k] = g0 * 1.05; this.wb[k] = b0 * 1.14; }
        r = BEACH[0]; g = BEACH[1]; b = BEACH[2];
      } else {
        this.wr[k] = sea[0]; this.wg[k] = sea[1]; this.wb[k] = sea[2];
        const t = state === 0 ? (GROUND_MIX[biome] ?? 0) : 0;
        if (t > 0) { r += (GRASS[0] - r) * t; g += (GRASS[1] - g) * t; b += (GRASS[2] - b) * t; }
        // Acerto fino por bioma, medido no corte (decisão 2: sem salto de cor).
        const fix = state === 0 || cracked ? BIOME_FIX[biome] : undefined;
        if (fix) { r *= fix[0]; g *= fix[1]; b *= fix[2]; }
      }
      this.r[k] = r; this.g[k] = g; this.b[k] = b;
    }
  }

  /** Altura suave em metros, em coordenadas finas do plano. */
  height(X: number, Z: number): number {
    return this.spline(this.h, X, Z);
  }

  /** Qualquer campo das células, suavizado: sem cantos de grade. */
  spline(a: Float32Array, X: number, Z: number): number {
    const u = X / DETAIL - 0.5 - this.x0, v = Z / DETAIL - 0.5 - this.z0;
    const iu = Math.max(1, Math.min(PATCH - 3, Math.floor(u))), iv = Math.max(1, Math.min(PATCH - 3, Math.floor(v)));
    bspline(Math.max(0, Math.min(1, u - iu)), this.wx);
    bspline(Math.max(0, Math.min(1, v - iv)), this.wz);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      const row = (iv - 1 + j) * PATCH + iu - 1, wj = this.wz[j] as number;
      for (let i = 0; i < 4; i++) s += (a[row + i] as number) * (this.wx[i] as number) * wj;
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

/** O que sobe em facetas num ponto: pico, duna ou vulcão. `kind`: 0 pico, 1 duna, 2 vulcão, 3 cratera. */
function surfaceLift(X: number, Z: number, face: number, patch: Patch): { lift: number; kind: number; awake: boolean } {
  let lift = 0, kind = 0, awake = false;
  if (patch.highest >= MOUNTAIN_START) lift = peakLift(X, Z, face, (a, b) => patch.height(a, b));
  for (const v of patch.volcanoes) {
    const R = 17, H = 12.5, d = Math.hypot(X - v.x, Z - v.z) / R;
    if (d >= 1) continue;
    const crater = d < 0.24;
    const h = crater ? H * Math.pow(0.76, 1.15) - (0.24 - d) * H * 1.6 : H * Math.pow(1 - d, 1.15);
    if (h > lift) { lift = h; kind = crater ? 3 : 2; awake = v.awake; }
  }
  if (patch.hasDesert) {
    const G = 26, gx = Math.floor(X / G), gz = Math.floor(Z / G);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = gx + dx, iz = gz + dz;
      if (hash3(ix, iz, 61 + face) > 0.32) continue;
      const px = (ix + 0.2 + hash3(ix, iz, 63 + face) * 0.6) * G, pz = (iz + 0.2 + hash3(ix, iz, 67 + face) * 0.6) * G;
      if (patch.biome[patch.nearest(px, pz)] !== Biome.HotDesert) continue;
      const R = 3.2 + hash3(ix, iz, 71 + face) * 2.2, d = Math.hypot(X - px, Z - pz) / R;
      if (d >= 1) continue;
      const h = (1.5 + hash3(ix, iz, 73 + face)) * Math.pow(1 - d, 0.85);
      if (h > lift) { lift = h; kind = 1; }
    }
  }
  return { lift, kind, awake };
}

export interface RiverSeg { ax: number; az: number; bx: number; bz: number; half: number; level: number }

/** Trechos de rio em volta do pedaço, nas coordenadas da face: curvas suaves pelas células que juntam água. */
function riverSegments(w: CoarseWorld, hydro: Hydro | null, patch: Patch, foam: { x: number; z: number; y: number }[]): RiverSeg[] {
  const out: RiverSeg[] = [];
  if (!hydro) return out;
  const n = w.n;
  const nodeX = new Float32Array(PATCH * PATCH), nodeZ = new Float32Array(PATCH * PATCH);
  const posOf = (k: number): void => {
    const c = patch.cell[k] as number, rest = c % (n * n), x = rest % n, y = Math.floor(rest / n);
    const edge = x === 0 || y === 0 || x === n - 1 || y === n - 1;
    const i = k % PATCH, j = Math.floor(k / PATCH);
    nodeX[k] = (patch.x0 + i + 0.5) * DETAIL + (edge ? 0 : (hash3(c, 5, 7) - 0.5) * 2.6);
    nodeZ[k] = (patch.z0 + j + 0.5) * DETAIL + (edge ? 0 : (hash3(c, 6, 9) - 0.5) * 2.6);
  };
  for (let k = 0; k < PATCH * PATCH; k++) posOf(k);
  const downstream = (k: number): number => {
    const p = hydro.parent[patch.cell[k] as number] as number, i = k % PATCH, j = Math.floor(k / PATCH);
    if (p < 0) return -1;
    if (i + 1 < PATCH && patch.cell[k + 1] === p) return k + 1;
    if (i > 0 && patch.cell[k - 1] === p) return k - 1;
    if (j + 1 < PATCH && patch.cell[k + PATCH] === p) return k + PATCH;
    if (j > 0 && patch.cell[k - PATCH] === p) return k - PATCH;
    return -1;
  };
  const levelOf = (k: number): number => {
    const c = patch.cell[k] as number;
    return (w.height[c] as number) <= 0 ? 0 : Math.max(0.02, stepY(elevationY(hydro.filled[c] as number), 0) - 0.1);
  };
  for (let k = 0; k < PATCH * PATCH; k++) {
    const c = patch.cell[k] as number, flow = hydro.flow[c] as number;
    if (flow < RIVER_FLOW || (w.height[c] as number) <= 0 || (w.height[c] as number) > MOUNTAIN_START || (w.ice[c] as number) || (hydro.lake[c] as number)) continue;
    const p = downstream(k);
    if (p < 0) continue;
    const half = Math.max(0.55, Math.min(2, 0.3 + Math.sqrt(flow) * 0.055));
    const cx = nodeX[k] as number, cz = nodeZ[k] as number, px = nodeX[p] as number, pz = nodeZ[p] as number;
    const m0x = (cx + px) / 2, m0z = (cz + pz) / 2;
    const l0 = levelOf(k), l1 = levelOf(p);
    out.push({ ax: cx, az: cz, bx: m0x, bz: m0z, half, level: l0 });
    if (l0 - l1 > 0.22) foam.push({ x: m0x, z: m0z, y: l1 });
    const pp = downstream(p);
    if (pp < 0) { out.push({ ax: m0x, az: m0z, bx: px, bz: pz, half, level: l1 }); continue; }
    const m1x = (px + (nodeX[pp] as number)) / 2, m1z = (pz + (nodeZ[pp] as number)) / 2;
    let qx = m0x, qz = m0z;
    for (let t = 1; t <= 5; t++) {
      const u = t / 5, v = 1 - u;
      const rx = v * v * m0x + 2 * v * u * px + u * u * m1x, rz = v * v * m0z + 2 * v * u * pz + u * u * m1z;
      out.push({ ax: qx, az: qz, bx: rx, bz: rz, half, level: l1 });
      qx = rx; qz = rz;
    }
  }
  return out;
}

const NOISE_SCALE = (size: number) => (size * 2) / Math.PI;

/** Forma do chão num ponto do plano: o que a malha e as facetas usam. */
class Ground {
  private p: [number, number, number] = [0, 0, 0];
  sx = 0; sy = 0; sz = 0;
  /** O último `plainY` caiu numa encosta de terraço. */
  bank = false;
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
  plainY(m: number, desert: number, X: number, Z: number): number {
    const { sx, sy, sz } = this;
    let y = elevationY(m);
    this.bank = false;
    if (y > 0.15) {
      const p = this.patch;
      const gx = elevationY(p.height(X + 1.5, Z)) - elevationY(p.height(X - 1.5, Z)), gz = elevationY(p.height(X, Z + 1.5)) - elevationY(p.height(X, Z - 1.5));
      const gradient = Math.hypot(gx, gz) / 3;
      const wobble = noise3(sx * 0.07, sy * 0.07, sz * 0.07) * 0.42 + noise3(sx * 0.2, sy * 0.2, sz * 0.2) * 0.1;
      const stepped = terrace(y, wobble, desert > 0.5 ? TERRACE * 2.4 : TERRACE, gradient);
      this.bank = onBank;
      y = Math.max(0.2, stepped);
      y += noise3(sx * 0.31, sy * 0.31, sz * 0.31) * 0.09;
    }
    return y;
  }
}

function fill(w: CoarseWorld, f: Fields, face: number, ox: number, oz: number, patch: Patch, ground: Ground, biomeGrid: Uint8Array, coverGrid: Float32Array, stateGrid: Uint8Array, tempGrid: Int8Array, rivers: readonly RiverSeg[]): void {
  const s = f.stride, m = f.margin, size = w.n * DETAIL;
  const near = rivers.filter((q) => Math.max(q.ax, q.bx) > ox - 12 && Math.min(q.ax, q.bx) < ox + CHUNK_CELLS + 12 && Math.max(q.az, q.bz) > oz - 12 && Math.min(q.az, q.bz) < oz + CHUNK_CELLS + 12);
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
    const cellAt = patch.nearest(cx, cz), biome = patch.biome[cellAt] as number;
    biomeGrid[k] = biome;
    coverGrid[k] = patch.cover[cellAt] as number;
    stateGrid[k] = patch.state[cellAt] as number;
    tempGrid[k] = patch.temp[cellAt] as number;
    const tone = noise3(sx * 0.13, sy * 0.13 + 1.7, sz * 0.13) * 0.12 + noise3(sx * 0.37, sy * 0.37 + 5.4, sz * 0.37) * 0.07;
    const warm = noise3(sx * 0.09 + 9.9, sy * 0.09, sz * 0.09) * 0.075;
    const r0 = patch.field(patch.r, cx, cz), g0 = patch.field(patch.g, cx, cz), b0 = patch.field(patch.b, cx, cz);
    const quiet = (patch.state[cellAt] as number) === 0 ? 1 : 0.3;
    const quietDry = biome === Biome.HotDesert || biome === Biome.ColdDesert || biome === Biome.Tundra || biome === Biome.Steppe ? 0.55 : 1;
    f.r[k] = r0 * (1 + (tone + warm) * quiet * quietDry);
    f.g[k] = g0 * (1 + tone * quiet * quietDry);
    f.b[k] = b0 * (1 + (tone - warm) * quiet * quietDry);
    if ((patch.ice[cellAt] as number) && (patch.sea[cellAt] as number) === 0 && (patch.h[cellAt] as number) <= 0) { f.wr[k] = ICE_WATER[0]; f.wg[k] = ICE_WATER[1]; f.wb[k] = ICE_WATER[2]; }
    else {
      f.wr[k] = patch.spline(patch.wr, cx, cz);
      f.wg[k] = patch.spline(patch.wg, cx, cz);
      f.wb[k] = patch.spline(patch.wb, cx, cz);
    }
    const meters = ground.meters(px, pz);
    const desert = biome === Biome.HotDesert || biome === Biome.ColdDesert ? 1 : 0;
    let y = ground.plainY(meters, desert, px, pz);
    if (ground.bank && meters > 40) f.bank[k] = 1;
    // O mar só onde há mar por perto: bacia em terra (cratera, baixada) não enche sozinha.
    if (meters < 200 && patch.field(patch.sea, px, pz) > 0.02) f.water[k] = 0;
    const cold = biome === Biome.Tundra || biome === Biome.Taiga || biome === Biome.Ice || biome === Biome.SnowyPeak;
    if (!cold && (patch.ice[cellAt] as number) === 0 && patch.field(patch.sea, px, pz) > 0.02) f.sand[k] = smoothstep(0.58, 0.42, y + noise3(sx * 0.5, sy * 0.5, sz * 0.5) * 0.12);
    // Charco do pântano: água parada em cada patamar, escura e com junco.
    if (biome === Biome.Swamp && y > 0.15) {
      const level = Math.floor(y / TERRACE) * TERRACE + 0.14;
      y = Math.max(y * 0.25 + level * 0.75 + 0.1, level + 0.04);
      const pond = noise3(sx * 0.46, sy * 0.46, sz * 0.46) + noise3(sx * 1.1, sy * 1.1, sz * 1.1) * 0.34;
      if (pond > -0.02) y = level + (y - level) * (1 - smoothstep(-0.02, 0.12, pond)) - 0.3 * smoothstep(-0.02, 0.12, pond);
      f.water[k] = level;
      f.marsh[k] = 1;
    }
    const lift = surfaceLift(px, pz, face, patch).lift;
    if (lift <= 0.5) {
      // Rio e lago: canal cavado; o chão acompanha o nível da água, para o rio não correr por cima dele.
      let d = Infinity, level = 0, isLake = false;
      const wobble = noise3(sx * 0.35, sy * 0.35, sz * 0.35) * 0.45;
      for (const q of near) {
        const ex = q.bx - q.ax, ez = q.bz - q.az, wx0 = px - q.ax, wz0 = pz - q.az;
        const t = Math.max(0, Math.min(1, (wx0 * ex + wz0 * ez) / (ex * ex + ez * ez || 1)));
        const dd = Math.hypot(wx0 - ex * t, wz0 - ez * t) - q.half;
        if (dd < d) { d = dd; level = q.level; }
      }
      d += wobble;
      const lakeMask = patch.spline(patch.lake, cx, cz);
      if (lakeMask > 0.02) {
        const dL = (0.5 - lakeMask) * 7 + wobble;
        if (dL < d) { d = dL; isLake = true; level = patch.lakeY[cellAt] as number || patch.lakeY[patch.nearest(px, pz)] as number || level; }
      }
      if (d < 6 && meters > 0) {
        f.bank[k] = 0;
        if (level > y - 0.4) y += (level + 0.45 - y) * smoothstep(5.5, 2, d);
        y += (level + 0.26 - y) * smoothstep(3.2, 0.6, d);
        y += (level - 0.9 - y) * smoothstep(0.55, -0.9, d);
        if (d < 3) { f.water[k] = level; f.marsh[k] = 0; f.river[k] = isLake ? 0 : 1; }
        if (!cold) f.sand[k] = Math.max(f.sand[k] as number, smoothstep(1.7, 0.9, d + noise3(sx * 0.5 + 3, sy * 0.5, sz * 0.5) * 0.4));
      }
    }
    // Cratera: bacia redonda e borda levantada, com forma própria (C1).
    const im = patch.spline(patch.impact, px, pz), ej = patch.spline(patch.ejecta, px, pz);
    if (im > 0.02 || ej > 0.02) {
      y += ej * 1.1 - im * 2.4;
      if (f.water[k] === 0) f.water[k] = -Infinity;
      f.sand[k] = 0;
    }
    // Enchente e tsunami: a água cobre o chão, com o nível acompanhando o terreno (C2).
    const sg = patch.spline(patch.surge, px, pz);
    if (sg > 0.18 && meters > 0) {
      f.water[k] = y + 0.1 + sg * 0.5;
      f.river[k] = 1;
      f.wr[k] = 0.26; f.wg[k] = 0.44; f.wb[k] = 0.52;
      if ((patch.state[cellAt] as number) === CellState.Wave) { f.wr[k] = 0.86; f.wg[k] = 0.92; f.wb[k] = 0.94; }
      f.sand[k] = 0;
    }
    // Debaixo das facetas o chão sobe menos, para nunca furar.
    if (lift > 1) y += (lift - 1) * 0.55;
    f.peak[k] = lift;
    f.y[k] = y;
  }
  reliefShade(f, 0.16);
}

const lvx = (ix: number, iz: number, face: number) => ix * LATTICE + (hash3(ix, iz, 1 + face) - 0.5) * LATTICE * 0.72;
const lvz = (ix: number, iz: number, face: number) => iz * LATTICE + (hash3(ix, iz, 11 + face) - 0.5) * LATTICE * 0.72;

/** Montanha como rede de triângulos grandes: facetas retas, em cima do chão. */
/** Rachaduras do terremoto (C7): fenda fina em ziguezague, escura, ligando as células rachadas. */
function buildCracks(face: number, ox: number, oz: number, patch: Patch, ground: Ground): Facet[] {
  const out: Facet[] = [];
  const dark: Rgb = rgb(30, 24, 24), edge: Rgb = rgb(70, 54, 46);
  const yAt = (x: number, z: number): number => { ground.locate(x, z); return ground.plainY(ground.meters(x, z), 0, x, z) + 0.05; };
  const seg = (ax: number, az: number, bx: number, bz: number, width: number, color: Rgb): void => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * width, nz = (dx / l) * width;
    const ya = yAt(ax, az), yb = yAt(bx, bz);
    const light: readonly [number, number, number] = [1, 1, 1];
    out.push({ p: [ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx - nx, yb, bz - nz], color, snow: false, light });
    out.push({ p: [ax + nx, ya, az + nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz], color, snow: false, light });
  };
  for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    if (patch.state[j * PATCH + i] !== CellState.Crack) continue;
    const X = (patch.x0 + i + 0.5) * DETAIL, Z = (patch.z0 + j + 0.5) * DETAIL;
    if (X < ox - 2 || Z < oz - 2 || X >= ox + CHUNK_CELLS + 2 || Z >= oz + CHUNK_CELLS + 2) continue;
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      const q = (j + dj) * PATCH + i + di;
      if (i + di >= PATCH || j + dj >= PATCH || j + dj < 0 || patch.state[q] !== CellState.Crack) continue;
      const bx = X + di * DETAIL, bz = Z + dj * DETAIL;
      const c = patch.cell[j * PATCH + i] as number;
      const mx = (X + bx) / 2 + (hash3(c, q, 3 + face) - 0.5) * 2.4, mz = (Z + bz) / 2 + (hash3(c, q, 5 + face) - 0.5) * 2.4;
      seg(X, Z, mx, mz, 0.42, edge); seg(mx, mz, bx, bz, 0.42, edge);
      seg(X, Z, mx, mz, 0.2, dark); seg(mx, mz, bx, bz, 0.2, dark);
    }
  }
  return out;
}

function buildFacets(w: CoarseWorld, face: number, ox: number, oz: number, patch: Patch, ground: Ground): Facet[] {
  const out: Facet[] = [];
  if (patch.highest < MOUNTAIN_START && !patch.hasDesert && patch.volcanoes.length === 0) return out;
  const size = w.n * DETAIL;
  const cache = new Map<number, { x: number; z: number; lift: number; y: number; snow: number; kind: number; awake: boolean; angle: number }>();
  const vertex = (ix: number, iz: number) => {
    const key = (ix + 1024) * 4096 + iz + 1024;
    let v = cache.get(key);
    if (!v) {
      // Na aresta da face o vértice não se move: as duas faces se encontram no mesmo ponto.
      const x = Math.max(0, Math.min(size, lvx(ix, iz, face))), z = Math.max(0, Math.min(size, lvz(ix, iz, face)));
      ground.locate(x, z);
      const meters = ground.meters(x, z), top = surfaceLift(x, z, face, patch), base = top.lift;
      const amp = top.kind === 0 ? 1 : top.kind === 1 ? 0.2 : 0.4;
      const rough = base > 0.3 ? amp * ((hash3(ix, iz, 3 + face) - 0.35) * 1.5 * Math.min(1, base / 2) + (noise3(ground.sx * 0.35, ground.sy * 0.35, ground.sz * 0.35) + 0.4) * 1.2 * Math.min(1, base / 3.5)) : 0;
      const lift = Math.max(0, base + rough);
      const near = patch.nearest(x, z);
      const vc = patch.volcanoes[0];
      v = { x, z, lift, y: ground.plainY(meters, 0, x, z) + lift - 0.04, snow: patch.biome[near] === Biome.SnowyPeak || (patch.ice[near] as number) === 1 ? 1 : 0, kind: top.kind, awake: top.awake, angle: vc ? Math.atan2(z - vc.z, x - vc.x) : 0 };
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
      const kind = Math.max(a.kind, b.kind, c.kind);
      if (kind > 0) {
        const k = 0.84 + h * 0.3;
        const base2: Rgb = kind === 1 ? DUNE : kind === 3 ? CRATER : ROCK_DARK;
        let col: Rgb = [base2[0] * k, base2[1] * k, base2[2] * k];
        // Em erupção: lava na cratera e em canais pela encosta.
        const awake = a.awake || b.awake || c.awake;
        if (awake) {
          // Canais de lava: direção do centro da faceta até a cratera, ondulando com a distância.
          const vc = patch.volcanoes[0], ang = vc ? Math.atan2(mz - vc.z, mx - vc.x) : 0, dist = vc ? Math.hypot(mx - vc.x, mz - vc.z) : 0;
          if (kind === 3 || Math.abs(Math.sin(ang * 1.5 + 0.6 + Math.sin(dist * 0.5) * 0.25)) < 0.09) col = LAVA;
        }
        const lit = (l: number) => 0.74 + 0.26 * Math.min(1, l / 2.5);
        out.push({ p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], color: col, snow: col === LAVA, light: [lit(a.lift), lit(b.lift), lit(c.lift)] });
        continue;
      }
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

interface Canopy { species: Species; chance: number; scale: number; spread: number; cluster: number }
/** Copas por bioma: `chance` por ponto da grade; `cluster` aperta em matas (0 = espalhado). */
const CANOPY: Partial<Record<number, readonly Canopy[]>> = {
  [Biome.Taiga]: [{ species: 'pine', chance: 0.92, scale: 1.08, spread: 0.72, cluster: 0.55 }],
  [Biome.TemperateForest]: [{ species: 'oak', chance: 0.3, scale: 0.9, spread: 0.55, cluster: 0.3 }, { species: 'midTree', chance: 0.32, scale: 0.9, spread: 0.55, cluster: 0.3 }],
  [Biome.TropicalForest]: [{ species: 'tropical', chance: 0.58, scale: 1.05, spread: 0.55, cluster: 0.15 }, { species: 'midTree', chance: 0.18, scale: 0.95, spread: 0.5, cluster: 0.15 }, { species: 'palm', chance: 0.04, scale: 0.85, spread: 0.4, cluster: 0 }],
  [Biome.Grassland]: [{ species: 'midTree', chance: 0.012, scale: 0.8, spread: 0.5, cluster: 0.2 }, { species: 'oak', chance: 0.005, scale: 0.8, spread: 0.4, cluster: 0.2 }],
  [Biome.Savanna]: [{ species: 'acacia', chance: 0.03, scale: 1.05, spread: 0.55, cluster: 0.2 }, { species: 'baobab', chance: 0.003, scale: 0.8, spread: 0.3, cluster: 0 }],
  [Biome.Swamp]: [{ species: 'mangrove', chance: 0.09, scale: 1.05, spread: 0.4, cluster: 0 }],
  [Biome.HotDesert]: [{ species: 'cactusTall', chance: 0.012, scale: 0.8, spread: 0.5, cluster: 0 }],
  [Biome.Mountain]: [{ species: 'pine', chance: 0.14, scale: 0.8, spread: 0.5, cluster: 0.35 }],
  [Biome.Beach]: [{ species: 'palm', chance: 0.01, scale: 0.9, spread: 0.4, cluster: 0 }],
};
interface GroundKind { species: Species | 'rock' | 'sandRock'; chance: number; scale: number; spread: number }
const FLOOR: Partial<Record<number, readonly GroundKind[]>> = {
  [Biome.Taiga]: [{ species: 'shrub', chance: 0.1, scale: 0.8, spread: 0.5 }, { species: 'moss', chance: 0.06, scale: 0.8, spread: 0.5 }],
  [Biome.TemperateForest]: [{ species: 'shrub', chance: 0.12, scale: 0.85, spread: 0.5 }, { species: 'tallGrass', chance: 0.05, scale: 0.7, spread: 0.3 }, { species: 'flowers', chance: 0.02, scale: 0.9, spread: 0.3 }],
  [Biome.TropicalForest]: [{ species: 'shrub', chance: 0.22, scale: 0.95, spread: 0.6 }, { species: 'tallGrass', chance: 0.08, scale: 0.8, spread: 0.3 }],
  [Biome.Grassland]: [{ species: 'shrub', chance: 0.26, scale: 0.85, spread: 0.85 }, { species: 'tallGrass', chance: 0.2, scale: 0.7, spread: 0.4 }, { species: 'flowers', chance: 0.05, scale: 1, spread: 0.4 }, { species: 'rock', chance: 0.03, scale: 0.42, spread: 0.34 }],
  [Biome.Steppe]: [{ species: 'desertShrub', chance: 0.1, scale: 0.7, spread: 0.4 }, { species: 'savannaGrass', chance: 0.22, scale: 0.6, spread: 0.3 }, { species: 'rock', chance: 0.03, scale: 0.42, spread: 0.3 }],
  [Biome.Savanna]: [{ species: 'savannaGrass', chance: 0.3, scale: 0.7, spread: 0.4 }, { species: 'shrub', chance: 0.1, scale: 0.75, spread: 0.5 }, { species: 'rock', chance: 0.03, scale: 0.42, spread: 0.3 }],
  [Biome.Swamp]: [{ species: 'reedClump', chance: 0.42, scale: 0.8, spread: 0.4 }, { species: 'shrub', chance: 0.16, scale: 0.65, spread: 0.5 }],
  [Biome.HotDesert]: [{ species: 'cactusLow', chance: 0.012, scale: 0.8, spread: 0.4 }, { species: 'desertShrub', chance: 0.02, scale: 0.8, spread: 0.3 }, { species: 'sandRock', chance: 0.02, scale: 0.5, spread: 0.35 }],
  [Biome.ColdDesert]: [{ species: 'sandRock', chance: 0.03, scale: 0.5, spread: 0.35 }, { species: 'desertShrub', chance: 0.04, scale: 0.7, spread: 0.3 }],
  [Biome.Tundra]: [{ species: 'tundraShrub', chance: 0.14, scale: 0.9, spread: 0.4 }, { species: 'moss', chance: 0.18, scale: 0.9, spread: 0.5 }, { species: 'rock', chance: 0.03, scale: 0.4, spread: 0.3 }],
  [Biome.Mountain]: [{ species: 'rock', chance: 0.08, scale: 0.5, spread: 0.5 }, { species: 'shrub', chance: 0.14, scale: 0.7, spread: 0.5 }],
};

interface DepositSpot { x: number; z: number; type: number; variant: number; scale: number; yaw: number }
/** Jazidas à vista no pedaço e em volta. */
function depositsOf(w: CoarseWorld, patch: Patch): DepositSpot[] {
  const out: DepositSpot[] = [];
  for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    const c = patch.cell[j * PATCH + i] as number, code = w.deposit[c] as number, type = depositType(code);
    if (type === Resource.None || (isHiddenOil(code) && !surfaceOil(w.n, c)) || (w.ice[c] as number)) continue;
    const big = depositSize(code);
    // Duas pedras por célula, um pouco afastadas: a mancha do minério é vista de longe.
    if (type === Resource.Oil && hash3(c, 3, 79) > (oil === 'unica' ? 0.12 : 0.34)) continue;
    const small = stones === 'miudas' && type !== Resource.Oil;
    for (let k = 0; k < (type === Resource.Oil ? 1 : small ? 4 : 2); k++) {
      const h = hash3(c, k, 83), h2 = hash3(c, k, 89), h3 = hash3(c, k, 97);
      out.push({ x: (patch.x0 + i) * DETAIL + 0.7 + h * 2.6, z: (patch.z0 + j) * DETAIL + 0.7 + h2 * 2.6, type, variant: k, scale: (type === Resource.Oil ? (oil === 'unica' ? 3 : 1.5) : small ? 0.55 : 1) * (0.8 + big * 0.28 + h3 * 0.3), yaw: h3 * 6.283 });
    }
  }
  return out;
}

/** Estado da planta pelo estado da célula (o fogo do M2 deixa queimado) e um sorteio pela posição. */
export function plantStateOf(cell: number, cover: number, h: number): PlantState | null {
  if (cell === CellState.Burning || cell === CellState.Burned || cell === CellState.Ash) return 'burned';
  if (cell === CellState.Lava || cell === CellState.Basalt || cell === CellState.Impact || cell === CellState.Ejecta || cell === CellState.Surge || cell === CellState.Flooded || cell === CellState.Lake) return null;
  if (cell === CellState.Heat) return h < 0.6 ? 'dry' : null;
  // Vegetação voltando: muitas mudas e poucos adultos.
  if (cover < 0.55) return h < cover ? 'young' : null;
  return h < 0.12 ? 'young' : h < 0.14 ? 'dry' : 'adult';
}

function scatter(f: Fields, face: number, ox: number, oz: number, ground: Ground, biomeGrid: Uint8Array, coverGrid: Float32Array, stateGrid: Uint8Array, tempGrid: Int8Array, iceSea: Uint8Array, foam: readonly { x: number; z: number; y: number }[], deposits: readonly DepositSpot[]): Placement[] {
  const out: Placement[] = [];
  const s = f.stride, m = f.margin, size = CHUNK_CELLS;
  const yAt = (lx: number, lz: number): number => {
    const i = Math.floor(lx) + m, j = Math.floor(lz) + m, tx = lx + m - i, tz = lz + m - j;
    const a = f.y[j * s + i] as number, b = f.y[j * s + i + 1] as number, c = f.y[(j + 1) * s + i] as number, d = f.y[(j + 1) * s + i + 1] as number;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  const usable = (lx: number, lz: number, onSand = false): number => {
    const k = (Math.round(lz) + m) * s + Math.round(lx) + m;
    const y = f.y[k] as number, water = f.water[k] as number;
    if ((water !== -Infinity && water > y - 0.2 && !(f.marsh[k] as number)) || (!onSand && (f.sand[k] as number) > 0.4) || (f.peak[k] as number) > 0.5) return -1;
    if (Math.abs(yAt(Math.min(size, lx + 0.7), lz) - yAt(Math.max(0, lx - 0.7), lz)) + Math.abs(yAt(lx, Math.min(size, lz + 0.7)) - yAt(lx, Math.max(0, lz - 0.7))) > 1.05) return -1;
    return k;
  };
  // Onde há jazida não nasce planta por cima.
  for (const d of deposits) {
    const r = Math.ceil(1.3 * d.scale), lx = Math.round(d.x - ox) + m, lz = Math.round(d.z - oz) + m;
    for (let j = Math.max(0, lz - r); j <= Math.min(s - 1, lz + r); j++) for (let i = Math.max(0, lx - r); i <= Math.min(s - 1, lx + r); i++) f.peak[j * s + i] = Math.max(f.peak[j * s + i] as number, 0.6);
  }
  const seed = face * 131 + ox * 3 + oz * 7;
  const put = (model: Float32Array, modelFar: Float32Array, lx: number, lz: number, scale: number, radius: number, strength: number, tinted: boolean): void => {
    const h = hash3(seed, Math.round(lx * 7), Math.round(lz * 7));
    const warm = tinted ? (hash3(Math.round(lx * 3), Math.round(lz * 3), seed) - 0.5) * 0.16 : 0;
    out.push({ model, far: modelFar, x: lx + ox, y: yAt(lx, lz) - 0.04, z: lz + oz, scale, stretch: 1, yaw: h * 6.283, tint: [1 + warm, 1, 1 - warm] });
    if (radius > 0) stampShade(f, lx + ox, lz + oz, radius, strength, ox, oz);
  };
  // Mar congelado: placas de gelo brancas.
  for (let gz = 0; gz < 9; gz++) for (let gx = 0; gx < 9; gx++) {
    const lx = (gx + 0.5 + (hash3(seed, gx, gz * 7 + 3) - 0.5) * 0.7) * 3.55, lz = (gz + 0.5 + (hash3(seed, gx * 7 + 1, gz) - 0.5) * 0.7) * 3.55;
    const k = (Math.round(lz) + m) * s + Math.round(lx) + m;
    if (!iceSea[k]) continue;
    const h = hash3(seed, gx * 3, gz + 21);
    out.push({ model: pickModel('floe', h), x: lx + ox, y: 0.02, z: lz + oz, scale: 1.1 + h * h * 2.2, stretch: 0.7, yaw: h * 37, tint: [1, 1, 1], rigid: true });
  }
  for (const q of foam) {
    for (let t = 0; t < 5; t++) {
      const a = t * 2.4, r = 0.3 + hash3(Math.round(q.x), t, 3) * 0.7, lx = q.x - ox + Math.cos(a) * r, lz = q.z - oz + Math.sin(a) * r;
      if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
      out.push({ model: pickModel('foam', t / 5), x: lx + ox, y: q.y - 0.05, z: lz + oz, scale: 0.45 + hash3(t, Math.round(q.z), 4) * 0.4, stretch: 1, yaw: a, tint: [1, 1, 1], rigid: true });
    }
  }
  const step = 1.82, gridN = Math.ceil(size / step);
  for (let gz = 0; gz < gridN; gz++) for (let gx = 0; gx < gridN; gx++) {
    const lx = (gx + 0.5 + (hash3(seed, gx * 2, gz) - 0.5) * 0.85) * step, lz = (gz + 0.5 + (hash3(seed, gx * 2 + 1, gz) - 0.5) * 0.85) * step;
    if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
    const k0 = (Math.round(lz) + m) * s + Math.round(lx) + m;
    const beach = (biomeGrid[k0] as number) === Biome.Beach;
    const k = usable(lx, lz, beach);
    if (k < 0) continue;
    const list = CANOPY[biomeGrid[k] as number];
    if (!list) continue;
    const cell = stateGrid[k] as number, burned = cell === CellState.Burning || cell === CellState.Burned || cell === CellState.Ash;
    const cover = burned ? 1 : Math.max(0.55, coverGrid[k] as number);
    ground.locate(lx + ox, lz + oz);
    const mass = noise3(ground.sx * 0.06, ground.sy * 0.06, ground.sz * 0.06) + noise3(ground.sx * 0.19, ground.sy * 0.19, ground.sz * 0.19) * 0.35;
    const r = hash3(seed, gx, gz * 3 + 1);
    let edge = 0;
    for (const c of list) {
      const inside = c.cluster > 0 ? smoothstep(-c.cluster, c.cluster * 0.6, mass) : 1;
      edge += c.chance * inside * cover;
      if (r < edge) {
        const size2 = hash3(seed, gx, gz * 3 + 2), h2 = hash3(seed, gx * 3, gz + 5);
        const state = plantStateOf(cell, coverGrid[k] as number, h2);
        // Árvore derrubada pela água: tronco caído no lugar.
        if (!state && (cell === CellState.Surge || cell === CellState.Flooded || cell === CellState.Wave) && h2 < 0.5) { out.push({ model: LOG, x: lx + ox, y: yAt(lx, lz) + 0.05, z: lz + oz, scale: 1, stretch: 1, yaw: h2 * 40, tint: [1, 1, 1], rigid: true }); break; }
        if (!state) break;
        const species: Species = c.species === 'pine' && (tempGrid[k] as number) < -7 ? 'snowPine' : c.species;
        put(plant(species, state, Math.floor(h2 * 17)), plant(species, state, Math.floor(h2 * 17), true), lx, lz, (c.scale + size2 * size2 * c.spread) * (0.82 + inside * 0.28), state === 'adult' ? 2.4 : 0.9, 0.34, state === 'adult' || state === 'young');
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
    const cell = stateGrid[k] as number, burned = cell === CellState.Burning || cell === CellState.Burned || cell === CellState.Ash;
    const r = hash3(seed, gx, gz * 3 + 7);
    let edge = 0;
    for (const c of list) {
      edge += c.chance * (burned ? 1 : Math.max(0.55, coverGrid[k] as number));
      if (r < edge) {
        const size2 = hash3(seed, gx, gz * 3 + 8), h2 = hash3(seed, gx * 5, gz + 11);
        if (c.species === 'rock' || c.species === 'sandRock') { put(pickModel(c.species, h2), pickModelFar(c.species, h2), lx, lz, c.scale + size2 * c.spread, 0.8, 0.14, false); break; }
        const state = plantStateOf(cell, coverGrid[k] as number, h2);
        if (state) put(plant(c.species, state, Math.floor(h2 * 17)), plant(c.species, state, Math.floor(h2 * 17), true), lx, lz, c.scale + size2 * c.spread, state === 'adult' ? 0.7 : 0, 0.12, state === 'adult' || state === 'young');
        break;
      }
    }
  }
  // Jazidas: um amontoado por célula, do tamanho da jazida; o petróleo escondido não aparece.
  for (const d of deposits) {
    const lx = d.x - ox, lz = d.z - oz;
    if (lx < 0.8 || lz < 0.8 || lx >= size - 0.8 || lz >= size - 0.8) continue;
    const k = (Math.round(lz) + m) * s + Math.round(lx) + m;
    if ((f.peak[k] as number) > 0.65) continue;
    const water = f.water[k] as number, y = f.y[k] as number;
    if (water > y + 0.05) continue;
    out.push({ model: depositModel(d.type, d.variant), far: depositModel(d.type, d.variant, true), x: d.x, y: yAt(lx, lz) - 0.02, z: d.z, scale: d.scale, stretch: 1, yaw: d.yaw, tint: [1, 1, 1], rigid: true });
    stampShade(f, d.x, d.z, 1.6 * d.scale, 0.22, ox, oz);
  }
  return out;
}

/** Um pedaço inteiro, nas coordenadas da própria face. */
export function buildWorldChunk(w: CoarseWorld, hydro: Hydro | null, face: number, cx: number, cz: number, near = false): MaqueteChunkOut {
  const f = newFields(CHUNK_CELLS, 3), ox = cx * CHUNK_CELLS, oz = cz * CHUNK_CELLS;
  const patch = new Patch(w, hydro, face, cx * CHUNK_COARSE - MARGIN_COARSE, cz * CHUNK_COARSE - MARGIN_COARSE);
  const ground = new Ground(w, face, patch);
  const biomeGrid = new Uint8Array(f.stride * f.stride), coverGrid = new Float32Array(f.stride * f.stride), stateGrid = new Uint8Array(f.stride * f.stride), tempGrid = new Int8Array(f.stride * f.stride);
  const foam: { x: number; z: number; y: number }[] = [];
  const rivers = riverSegments(w, hydro, patch, foam);
  fill(w, f, face, ox, oz, patch, ground, biomeGrid, coverGrid, stateGrid, tempGrid, rivers);
  const iceSea = new Uint8Array(f.stride * f.stride);
  for (let k = 0; k < iceSea.length; k++) iceSea[k] = (f.wr[k] as number) === ICE_WATER[0] || (biomeGrid[k] === Biome.Ice && (f.y[k] as number) < 0.05) ? 1 : 0;
  const places = scatter(f, face, ox, oz, ground, biomeGrid, coverGrid, stateGrid, tempGrid, iceSea, foam, depositsOf(w, patch));
  const facets = buildFacets(w, face, ox, oz, patch, ground);
  // Chão dos animais.
  const gridN = CHUNK_CELLS + 1, walkY = new Float32Array(gridN * gridN), walkMask = new Uint8Array(gridN * gridN), st = f.stride, mg = f.margin;
  for (let j = 0; j < gridN; j++) for (let i = 0; i < gridN; i++) {
    const k = (j + mg) * st + i + mg, g = j * gridN + i, y = f.y[k] as number, wl = f.water[k] as number;
    walkY[g] = y;
    if (wl !== -Infinity && wl > y && !(f.marsh[k] as number)) walkMask[g] = (f.river[k] as number) && wl - y < 0.8 ? 3 : wl - y > 0.7 && wl <= 0.02 && !iceSea[k] ? 2 : 1;
    else if ((f.peak[k] as number) > 0.5 || (i > 0 && Math.abs((f.y[k] as number) - (f.y[k - 1] as number)) > 0.8)) walkMask[g] = 1;
  }
  // Grupos por espécie: a região escolhe uma só e poucos pedaços têm grupo (D2). A posição vem da região, então a espécie se espalha pelo bioma.
  const herd: number[] = [];
  const seedA = face * 197 + cx * 13 + cz * 31;
  const lx = 2 + hash3(seedA, 1, 303) * (CHUNK_CELLS - 4), lz = 2 + hash3(seedA, 1, 307) * (CHUNK_CELLS - 4);
  const k0 = (Math.round(lz) + mg) * st + Math.round(lx) + mg;
  const here = biomeGrid[k0] as number, list = FAUNA[here];
  if (list && hash3(seedA, 1, 301) < (here === Biome.DeepOcean || here === Biome.ShallowOcean ? 0.07 : 0.2)) {
    const region = hash3(face * 37 + (cx >> 2), cz >> 2, 311 + here);
    const entry = list[Math.floor(region * list.length) % list.length] as (typeof list)[number];
    const species = ANIMALS.indexOf(entry[0]), swims = SWIMMERS.has(entry[0]);
    const count = entry[1] + Math.floor(hash3(seedA, 1, 313) * (entry[2] - entry[1] + 1));
    const spread = 1.6 + Math.sqrt(count) * 1.5;
    for (let q = 0; q < count; q++) {
      const ax = Math.max(0.5, Math.min(CHUNK_CELLS - 0.5, lx + (hash3(seedA + q, 1, 317) - 0.5) * spread * 2)), az = Math.max(0.5, Math.min(CHUNK_CELLS - 0.5, lz + (hash3(seedA + q, 1, 331) - 0.5) * spread * 2));
      const mask = walkMask[Math.round(az) * gridN + Math.round(ax)] as number;
      if (swims ? mask !== 2 : mask !== 0) continue;
      herd.push(species, ax, az, hash3(seedA + q, 1, 337));
    }
  }
  // Chamas nas células em chamas; fumaça sai dos vulcões em erupção.
  const flames: number[] = [], vents: number[] = [];
  for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    if (patch.state[j * PATCH + i] !== CellState.Burning) continue;
    const X = (patch.x0 + i) * DETAIL, Z = (patch.z0 + j) * DETAIL, c = patch.cell[j * PATCH + i] as number;
    for (let t = 0; t < 2; t++) {
      const x = X + 0.5 + hash3(c, t, 1) * 3, z = Z + 0.5 + hash3(c, t, 2) * 3, lx2 = x - ox, lz2 = z - oz;
      if (lx2 < 0 || lz2 < 0 || lx2 >= CHUNK_CELLS || lz2 >= CHUNK_CELLS) continue;
      const g = Math.round(lz2) * gridN + Math.round(lx2);
      flames.push(x, walkY[g] as number, z);
    }
  }
  for (const v of patch.volcanoes) if (v.awake && v.x >= ox && v.z >= oz && v.x < ox + CHUNK_CELLS && v.z < oz + CHUNK_CELLS) vents.push(v.x, 13, v.z);
  const skirts = buildSkirts(f, ox, oz, 3);
  return { terrain: buildTerrain(f, ox, oz, face + 7, facets.concat(buildCracks(face, ox, oz, patch, ground))), water: buildWater(f, ox, oz, {}), props: near ? bakeProps(places) : new ArrayBuffer(0), propsFar: near ? new ArrayBuffer(0) : bakeProps(places, true), skirts: skirts.data, skirtRanges: skirts.ranges, animals: new Float32Array(herd), flames: new Float32Array(flames), vents: new Float32Array(vents), walkY, walkMask };
}
