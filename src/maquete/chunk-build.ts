import { hash3 } from './hash';
import { MODEL_FLOATS, rgb, type Rgb } from './models';

/**
 * Da grade fina (`Fields`) para a malha: terreno facetado, água, borda em camadas e plantas embutidas.
 * Tudo roda fora da tela e não conhece o WebGL: entra número, sai número.
 */
export const VERTEX_BYTES = 20;

const EARTH_TOP = rgb(150, 96, 62), EARTH_MID = rgb(124, 78, 54), EARTH_LOW = rgb(92, 64, 60);
const WATER_SHALLOW = rgb(64, 138, 170), WATER_DEEP = rgb(38, 92, 150);
const FALL = rgb(176, 220, 236);
const MARSH = rgb(44, 92, 104);

/** Grade fina de um pedaço: `size + 1` vértices por lado, mais `margin` em volta (para a oclusão e a inclinação). */
export interface Fields {
  size: number;
  margin: number;
  stride: number;
  /** Altura do chão, em células finas. */
  y: Float32Array;
  /** Nível da água (-Infinity: sem água). */
  water: Float32Array;
  /** Cor da água: 0 mar/rio/lago; 1 pântano. */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Areia: 0 a 1, com contorno nítido em 0,5. */
  sand: Float32Array;
  /** Charco: a água fica escura e esverdeada. */
  marsh: Float32Array;
  /** Pico por cima (nada de planta aqui). */
  peak: Float32Array;
  /** Cor da água funda (a do globo, no mar). */
  wr: Float32Array;
  wg: Float32Array;
  wb: Float32Array;
  /** Oclusão de base (1 = sem escurecer); as plantas escurecem o chão em volta. */
  shade: Float32Array;
  /** Deslocamento lateral dos vértices: as facetas não formam grade. */
  jx: Float32Array;
  jz: Float32Array;
}

export function newFields(size: number, margin: number): Fields {
  const stride = size + 1 + margin * 2, count = stride * stride;
  const a = () => new Float32Array(count);
  return { size, margin, stride, y: a(), water: new Float32Array(count).fill(-Infinity), r: a(), g: a(), b: a(), sand: a(), marsh: a(), peak: a(), wr: new Float32Array(count).fill(WATER_DEEP[0]), wg: new Float32Array(count).fill(WATER_DEEP[1]), wb: new Float32Array(count).fill(WATER_DEEP[2]), shade: new Float32Array(count).fill(1), jx: a(), jz: a() };
}

export class VertexOut {
  private view: DataView;
  count = 0;
  constructor(capacity: number) { this.view = new DataView(new ArrayBuffer(capacity * VERTEX_BYTES)); }
  private grow(): void {
    const b = new ArrayBuffer(this.view.byteLength * 2);
    new Uint8Array(b).set(new Uint8Array(this.view.buffer));
    this.view = new DataView(b);
  }
  push(x: number, y: number, z: number, nx: number, ny: number, nz: number, mask: number, r: number, g: number, b: number, light: number): void {
    if ((this.count + 1) * VERTEX_BYTES > this.view.byteLength) this.grow();
    const o = this.count * VERTEX_BYTES, v = this.view;
    v.setFloat32(o, x, true); v.setFloat32(o + 4, y, true); v.setFloat32(o + 8, z, true);
    v.setInt8(o + 12, Math.round(nx * 127)); v.setInt8(o + 13, Math.round(ny * 127)); v.setInt8(o + 14, Math.round(nz * 127));
    v.setInt8(o + 15, Math.round(Math.max(-1, Math.min(1, mask)) * 127));
    v.setUint8(o + 16, Math.round(Math.max(0, Math.min(1, r)) * 255)); v.setUint8(o + 17, Math.round(Math.max(0, Math.min(1, g)) * 255)); v.setUint8(o + 18, Math.round(Math.max(0, Math.min(1, b)) * 255));
    v.setUint8(o + 19, Math.round(Math.max(0, Math.min(1, light)) * 255));
    this.count++;
  }
  bytes(): ArrayBuffer { return this.view.buffer.slice(0, this.count * VERTEX_BYTES) as ArrayBuffer; }
}

/** Cores da água, quando diferem do padrão. */
export interface TerrainStyle { waterShallow?: Rgb }

function terrainTriangle(out: VertexOut, f: Fields, a: number, b: number, c: number, ox: number, oz: number, seedX: number, seedZ: number): void {
  const s = f.stride, m = f.margin;
  const px = (i: number) => (i % s) - m + (f.jx[i] as number) + ox, pz = (i: number) => Math.floor(i / s) - m + (f.jz[i] as number) + oz;
  const ax = px(a), ay = f.y[a] as number, az = pz(a), bx = px(b), by = f.y[b] as number, bz = pz(b), cx = px(c), cy = f.y[c] as number, cz = pz(c);
  let nx = (bz - az) * (cy - ay) - (by - ay) * (cz - az);
  let ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  let nz = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay);
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const jitter = hash3(seedX, seedZ, 3) * 2 - 1;
  const midY = (ay + by + cy) / 3;
  const third = 1 / 3, j = 1 + jitter * 0.018;
  let r = ((f.r[a] as number) + (f.r[b] as number) + (f.r[c] as number)) * third * j;
  let g = ((f.g[a] as number) + (f.g[b] as number) + (f.g[c] as number)) * third * j;
  let bl = ((f.b[a] as number) + (f.b[b] as number) + (f.b[c] as number)) * third * j;
  const sand = ((f.sand[a] as number) + (f.sand[b] as number) + (f.sand[c] as number)) * third;
  if (ny < 0.8 && sand < 0.3 && (f.marsh[a] as number) < 0.5) {
    // Barranco: terra à mostra, em faixas.
    const band = midY + hash3(seedX, 7, 1) * 0.5;
    const e = band > 1.2 ? EARTH_TOP : band > 0 ? EARTH_MID : EARTH_LOW;
    const k = 0.93 + jitter * 0.09;
    r = e[0] * k; g = e[1] * k; bl = e[2] * k;
    for (const i of [a, b, c]) out.push(px(i), f.y[i] as number, pz(i), nx, ny, nz, 0, r, g, bl, f.shade[i] as number);
    return;
  }
  for (const i of [a, b, c]) out.push(px(i), f.y[i] as number, pz(i), nx, ny, nz, f.sand[i] as number, r, g, bl, f.shade[i] as number);
}

/** Faceta grande de rocha: triângulo plano por cima do chão (montanha, duna, vulcão). */
export interface Facet {
  p: readonly [number, number, number, number, number, number, number, number, number];
  color: Rgb;
  /** Neve: quase não escurece do lado sem sol. */
  snow: boolean;
  /** Luz em cada vértice. */
  light: readonly [number, number, number];
}

function pushFacet(out: VertexOut, q: Facet): void {
  const v = q.p;
  let nx = (v[4] - v[1]) * (v[8] - v[2]) - (v[5] - v[2]) * (v[7] - v[1]);
  let ny = (v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2]);
  let nz = (v[3] - v[0]) * (v[7] - v[1]) - (v[4] - v[1]) * (v[6] - v[0]);
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const flip = ny < 0;
  if (flip) { nx = -nx; ny = -ny; nz = -nz; }
  const order = flip ? [0, 2, 1] : [0, 1, 2];
  const mask = q.snow ? -1 : 0;
  for (const k of order) out.push(v[k * 3] as number, v[k * 3 + 1] as number, v[k * 3 + 2] as number, nx, ny, nz, mask, q.color[0], q.color[1], q.color[2], q.light[k] as number);
}

/** Malha do chão. */
export function buildTerrain(f: Fields, ox: number, oz: number, seed: number, facets: readonly Facet[] = []): ArrayBuffer {
  const out = new VertexOut(f.size * f.size * 6);
  const s = f.stride, m = f.margin;
  for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) {
    const a = (j + m) * s + i + m, b = a + 1, d = a + s, c = d + 1;
    const hx = seed * 31 + ox + i, hz = oz + j;
    // A diagonal segue a curva de nível: costa e barranco sem serra.
    const ac = Math.abs((f.y[a] as number) - (f.y[c] as number)), bd = Math.abs((f.y[b] as number) - (f.y[d] as number));
    if (ac < bd || (ac === bd && hash3(hx, hz, 5) < 0.5)) {
      terrainTriangle(out, f, a, c, b, ox, oz, hx, hz * 2);
      terrainTriangle(out, f, a, d, c, ox, oz, hx, hz * 2 + 1);
    } else {
      terrainTriangle(out, f, a, d, b, ox, oz, hx, hz * 2);
      terrainTriangle(out, f, b, d, c, ox, oz, hx, hz * 2 + 1);
    }
  }
  for (const q of facets) pushFacet(out, q);
  return out.bytes();
}

/** Água: um degrau no nível vira queda d'água. Só as células em que a água passa do chão. */
export function buildWater(f: Fields, ox: number, oz: number, style: TerrainStyle): ArrayBuffer {
  const out = new VertexOut(256);
  const s = f.stride, m = f.margin;
  const shallow = style.waterShallow ?? WATER_SHALLOW;
  const px = (i: number) => (i % s) - m + (f.jx[i] as number) + ox, pz = (i: number) => Math.floor(i / s) - m + (f.jz[i] as number) + oz;
  const level = (i: number, near: readonly number[]): number => {
    const w = f.water[i] as number;
    if (w !== -Infinity) return w;
    let best = -Infinity;
    for (const q of near) best = Math.max(best, f.water[q] as number);
    return best;
  };
  const tri = (a: number, b: number, c: number, wa: number, wb: number, wc: number): void => {
    const ax = px(a), az = pz(a), bx = px(b), bz = pz(b), cx = px(c), cz = pz(c);
    let nx = (bz - az) * (wc - wa) - (wb - wa) * (cz - az);
    let ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    let nz = (wb - wa) * (cx - ax) - (bx - ax) * (wc - wa);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const fall = ny < 0.85;
    for (const [i, w] of [[a, wa], [b, wb], [c, wc]] as const) {
      const depth = Math.max(0, Math.min(1, (w - (f.y[i] as number)) / 1.1));
      const mk = f.marsh[i] as number;
      const r = fall ? FALL[0] : (shallow[0] + ((f.wr[i] as number) - shallow[0]) * depth) * (1 - mk) + MARSH[0] * mk;
      const g = fall ? FALL[1] : (shallow[1] + ((f.wg[i] as number) - shallow[1]) * depth) * (1 - mk) + MARSH[1] * mk;
      const b2 = fall ? FALL[2] : (shallow[2] + ((f.wb[i] as number) - shallow[2]) * depth) * (1 - mk) + MARSH[2] * mk;
      out.push(px(i), w, pz(i), nx, ny, nz, fall ? 1 : 0, r, g, b2, 1);
    }
  };
  for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) {
    const a = (j + m) * s + i + m, b = a + 1, d = a + s, c = d + 1;
    const wa = level(a, [b, c, d]), wb = level(b, [a, c, d]), wc = level(c, [a, b, d]), wd = level(d, [a, b, c]);
    if (wa === -Infinity && wb === -Infinity && wc === -Infinity && wd === -Infinity) continue;
    if (wa < (f.y[a] as number) && wb < (f.y[b] as number) && wc < (f.y[c] as number) && wd < (f.y[d] as number)) continue;
    tri(a, c, b, wa, wc, wb);
    tri(a, d, c, wa, wd, wc);
  }
  return out.bytes();
}

export const SKIRT_DEPTH = 6.2;

/** Borda em camadas de terra (`estilo/folha-mestra.png`): lábio de grama e três faixas onduladas. Um trecho por lado (+x, -x, +z, -z). */
export function buildSkirts(f: Fields, ox: number, oz: number, seed: number): { data: ArrayBuffer; ranges: [number, number][] } {
  const out = new VertexOut(f.size * 4 * 30);
  const s = f.stride, m = f.margin, size = f.size;
  const ranges: [number, number][] = [];
  const at = (side: number, k: number): number => {
    if (side === 0) return (k + m) * s + size + m;
    if (side === 1) return (k + m) * s + m;
    if (side === 2) return (size + m) * s + k + m;
    return m * s + k + m;
  };
  const outward: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const quad = (x0: number, z0: number, y00: number, y01: number, x1: number, z1: number, y10: number, y11: number, nx: number, nz: number, c: Rgb, flipOrder: boolean, light0: number, light1: number): void => {
    const p: readonly (readonly [number, number, number, number])[] = flipOrder
      ? [[x0, y00, z0, light0], [x1, y10, z1, light1], [x1, y11, z1, light1], [x0, y00, z0, light0], [x1, y11, z1, light1], [x0, y01, z0, light0]]
      : [[x0, y00, z0, light0], [x1, y11, z1, light1], [x1, y10, z1, light1], [x0, y00, z0, light0], [x0, y01, z0, light0], [x1, y11, z1, light1]];
    for (const v of p) out.push(v[0], v[1], v[2], nx, 0.05, nz, 0, c[0], c[1], c[2], v[3]);
  };
  for (let side = 0; side < 4; side++) {
    const start = out.count;
    const [nx, nz] = outward[side] as readonly [number, number];
    // Faixas: a mesma costura de um pedaço para o outro.
    const bandY = (k: number, layer: number): number => {
      const wx = side < 2 ? ox + (side === 0 ? size : 0) : ox + k, wz = side < 2 ? oz + k : oz + (side === 2 ? size : 0);
      const c0x = Math.floor(wx / 3), c0z = Math.floor(wz / 3);
      const t = side < 2 ? (wz / 3) - c0z : (wx / 3) - c0x;
      const a0 = hash3(c0x, c0z, layer + seed), a1 = side < 2 ? hash3(c0x, c0z + 1, layer + seed) : hash3(c0x + 1, c0z, layer + seed);
      const wave = (a0 + (a1 - a0) * t - 0.5) * 1.15;
      return ([-1.5, -3.5, -SKIRT_DEPTH][layer] as number) + (layer < 2 ? wave : 0);
    };
    for (let k = 0; k < size; k++) {
      const i0 = at(side, k), i1 = at(side, k + 1);
      const x0 = (i0 % s) - m + (f.jx[i0] as number) + ox, z0 = Math.floor(i0 / s) - m + (f.jz[i0] as number) + oz;
      const x1 = (i1 % s) - m + (f.jx[i1] as number) + ox, z1 = Math.floor(i1 / s) - m + (f.jz[i1] as number) + oz;
      const y0 = f.y[i0] as number, y1 = f.y[i1] as number;
      const flip = side === 1 || side === 2;
      const w0 = f.water[i0] as number, w1 = f.water[i1] as number;
      let top0: number, top1: number;
      if (w0 > y0 || w1 > y1) {
        // Água na borda: lado azul por cima da terra (`bioma/agua.png`).
        const l0 = Math.max(w0, y0), l1 = Math.max(w1, y1);
        quad(x0, z0, l0, y0 - 0.2, x1, z1, l1, y1 - 0.2, nx, nz, rgb(44, 104, 160), flip, 1, 1);
        top0 = y0 - 0.2; top1 = y1 - 0.2;
      } else {
        // Lábio: a cor do chão desce um pouco.
        const lip0 = 0.55 + hash3(ox + k * nx, oz + k * nz, 3) * 0.3, lip1 = 0.55 + hash3(ox + (k + 1) * nx, oz + (k + 1) * nz, 3) * 0.3;
        const c: Rgb = [(f.r[i0] as number) * 0.86, (f.g[i0] as number) * 0.86, (f.b[i0] as number) * 0.86];
        quad(x0, z0, y0, y0 - lip0, x1, z1, y1, y1 - lip1, nx, nz, c, flip, 1, 1);
        top0 = y0 - lip0; top1 = y1 - lip1;
      }
      const tone = 0.93 + hash3((ox + k) >> 1, (oz + k) >> 1, side) * 0.14;
      const shadeOf = (c: Rgb, t: number): Rgb => [c[0] * t, c[1] * t, c[2] * t];
      const b0a = Math.min(bandY(k, 0), top0 - 0.1), b0b = Math.min(bandY(k + 1, 0), top1 - 0.1);
      quad(x0, z0, top0, b0a, x1, z1, top1, b0b, nx, nz, shadeOf(EARTH_TOP, tone), flip, 1, 1);
      const b1a = Math.min(bandY(k, 1), b0a - 0.1), b1b = Math.min(bandY(k + 1, 1), b0b - 0.1);
      quad(x0, z0, b0a, b1a, x1, z1, b0b, b1b, nx, nz, shadeOf(EARTH_MID, tone), flip, 1, 1);
      quad(x0, z0, b1a, -SKIRT_DEPTH, x1, z1, b1b, -SKIRT_DEPTH, nx, nz, shadeOf(EARTH_LOW, tone), flip, 0.9, 0.9);
    }
    ranges.push([start, out.count - start]);
  }
  return { data: out.bytes(), ranges };
}

export interface Placement {
  model: Float32Array;
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Altura relativa à escala. */
  stretch: number;
  yaw: number;
  tint: Rgb;
}

/** Embute as plantas numa malha só: um desenho por pedaço, sem lista por modelo. */
export function bakeProps(list: readonly Placement[]): ArrayBuffer {
  let total = 0;
  for (const p of list) total += p.model.length / MODEL_FLOATS;
  const out = new VertexOut(Math.max(1, total));
  for (const p of list) {
    const m = p.model, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (let o = 0; o < m.length; o += MODEL_FLOATS) {
      const x = (m[o] as number) * p.scale, y = (m[o + 1] as number) * p.scale * p.stretch, z = (m[o + 2] as number) * p.scale;
      const nx = m[o + 3] as number, ny = m[o + 4] as number, nz = m[o + 5] as number;
      out.push(c * x + s * z + p.x, y + p.y, -s * x + c * z + p.z, c * nx + s * nz, ny, -s * nx + c * nz, 0, (m[o + 6] as number) * p.tint[0], (m[o + 7] as number) * p.tint[1], (m[o + 8] as number) * p.tint[2], m[o + 9] as number);
    }
  }
  return out.bytes();
}

/** Escurece o chão em volta do pé das plantas. */
export function stampShade(f: Fields, x: number, z: number, radius: number, strength: number, ox: number, oz: number): void {
  const s = f.stride, m = f.margin;
  const lx = x - ox + m, lz = z - oz + m;
  const r = Math.ceil(radius);
  for (let j = Math.floor(lz) - r; j <= Math.floor(lz) + r + 1; j++) for (let i = Math.floor(lx) - r; i <= Math.floor(lx) + r + 1; i++) {
    if (i < 0 || j < 0 || i >= s || j >= s) continue;
    const d = Math.hypot(i - lx, j - lz) / radius;
    if (d >= 1) continue;
    const k = j * s + i;
    f.shade[k] = (f.shade[k] as number) * (1 - strength * (1 - d * d));
  }
}

/** Oclusão do relevo: vértice mais baixo que a vizinhança escurece um pouco. */
export function reliefShade(f: Fields, strength = 0.14): void {
  const s = f.stride;
  const r = Math.max(1, Math.min(2, f.margin));
  for (let j = r; j < s - r; j++) for (let i = r; i < s - r; i++) {
    const k = j * s + i, y = f.y[k] as number;
    let rise = 0;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] as const) rise += Math.max(0, Math.min(2.2, (f.y[k + dz * s + dx] as number) - y));
    f.shade[k] = (f.shade[k] as number) * (1 - Math.min(0.38, (rise / 8) * strength * 2.4));
  }
}
