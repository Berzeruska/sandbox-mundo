/**
 * Gerador mínimo do detalhe local (item 1.4) e dos pedaços da maquete (item 1.6). Puro e determinístico: a mesma
 * grade grande dá sempre o mesmo pedaço. Roda no worker. 1 unidade = 1 célula fina; D células finas por célula grande.
 * O relevo tem os modos do item 1.8 (passagem entre níveis). Só protótipo: nada aqui entra no jogo sem aprovação.
 */
import { Biome } from '../src/world/biomes';
import { Resource } from '../src/world/resources';
import type { RGB } from './styles';

export const CHUNK = 32;
export const KINDS = ['pinheiro', 'copa', 'acacia', 'tropical', 'cacto', 'arbusto', 'tronco', 'parede', 'telhado', 'pedra', 'rocha'] as const;
export type Kind = (typeof KINDS)[number];
/** Por vértice: posição (3), normal (3), cor (3), perna (1). */
export const VERTEX_FLOATS = 10;
/** Por instância: posição (3), escala (3), giro, fase, cor (3). */
export const INSTANCE_FLOATS = 11;

export type Relief = 'degrau' | 'rampa' | 'escada' | 'baixo' | 'lisa' | 'terraco';
export const RELIEFS: readonly Relief[] = ['degrau', 'rampa', 'escada', 'baixo', 'lisa', 'terraco'];
/** O que um boneco sobe sem rampa: abaixo disso, a passagem é livre. */
export const WALK_STEP = 0.13;
/** Unidades de altura por "nível" do relevo. */
const RELIEF_SCALE = 0.42;

export interface Palette {
  biome: readonly RGB[];
  deep: RGB;
  shallow: RGB;
  side: RGB;
  sideLow: RGB;
  road: RGB;
  roofs: readonly RGB[];
  walls: readonly RGB[];
  trunk: RGB;
  leaves: Partial<Record<number, readonly RGB[]>>;
  resources: readonly RGB[];
}

export interface City { x: number; z: number; r: number }

export interface WorldData {
  n: number;
  D: number;
  /** Altura sobre o mar (m), bioma, água e jazida (0 = nada) por célula grande da face. */
  height: Float32Array;
  biome: Uint8Array;
  water: Uint8Array;
  deposit: Uint8Array;
  palette: Palette;
  relief: Relief;
  cities: City[];
  /** Rios: pontos em células finas, x e z alternados, por rio. */
  rivers: Float32Array[];
  density: number;
}

export interface ChunkData {
  cx: number;
  cz: number;
  terrain: Float32Array;
  sea: Float32Array;
  instances: Record<Kind, Float32Array>;
  /** Por célula fina: alturas dos 4 cantos (x0z0, x1z0, x1z1, x0z1). */
  corners: Float32Array;
  /** 1 = dá para entrar a pé (terra, sem rio). */
  walk: Uint8Array;
  ms: number;
}


function hash2(x: number, y: number, k = 0): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function smooth(t: number): number { return t * t * (3 - 2 * t); }
/** Ruído de valor em células de tamanho `s`. */
function noise(x: number, z: number, s: number, k: number): number {
  const fx = x / s, fz = z / s, ix = Math.floor(fx), iz = Math.floor(fz), tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = hash2(ix, iz, k), b = hash2(ix + 1, iz, k), c = hash2(ix, iz + 1, k), d = hash2(ix + 1, iz + 1, k);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Leitura da grade grande a partir das coordenadas finas. Tudo aqui depende só da posição: pedaços vizinhos casam. */
export class Sampler {
  constructor(readonly w: WorldData) {}
  private idx(gx: number, gz: number): number {
    const n = this.w.n;
    return Math.max(0, Math.min(n - 1, gz)) * n + Math.max(0, Math.min(n - 1, gx));
  }
  /** Célula grande que manda neste ponto, com a borda ondulada pelo ruído (costa e biomas sem linha reta). */
  coarse(x: number, z: number): number {
    const D = this.w.D;
    if (D === 1) return this.idx(Math.floor(x), Math.floor(z));
    const wx = x + (noise(x, z, D * 1.6, 1) - 0.5) * D * 1.5 + (noise(x, z, D * 0.5, 3) - 0.5) * D * 0.5;
    const wz = z + (noise(x, z, D * 1.6, 2) - 0.5) * D * 1.5 + (noise(x, z, D * 0.5, 4) - 0.5) * D * 0.5;
    return this.idx(Math.floor(wx / D), Math.floor(wz / D));
  }
  /** Altura contínua (m) na célula fina, interpolada da grade grande, com variação de morro. Deserto bem plano. */
  meters(x: number, z: number): number {
    const w = this.w, D = w.D;
    const fx = x / D - 0.5, fz = z / D - 0.5, ix = Math.floor(fx), iz = Math.floor(fz), tx = smooth(fx - ix), tz = smooth(fz - iz);
    const h = (a: number, b: number) => w.height[this.idx(a, b)] as number;
    let m = (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
    const b = w.biome[this.coarse(x, z)] as number;
    // Item 1.8: deserto com grandes áreas planas; o resto com pequenas variações, sem mudar a altura geral.
    if (b === Biome.HotDesert || b === Biome.ColdDesert) m *= 0.18;
    else if (b === Biome.Mountain || b === Biome.SnowyPeak) {
      // Montanha: cristas de verdade, do tamanho de algumas células grandes.
      const ridge = 1 - Math.abs(noise(x, z, D * 2.2, 8) * 2 - 1);
      m += 500 + ridge * ridge * 1500 + (noise(x, z, 5, 9) - 0.5) * 300;
    } else if (D > 1) m += (noise(x, z, 11, 7) - 0.5) * Math.min(420, 120 + m * 0.3);
    return Math.max(0, m);
  }
  isRiver(x: number, z: number): boolean {
    for (const r of this.w.rivers) {
      for (let k = 0; k + 3 < r.length; k += 2) {
        const ax = r[k] as number, az = r[k + 1] as number, bx = r[k + 2] as number, bz = r[k + 3] as number;
        if (Math.abs(ax - x) > 8 && Math.abs(bx - x) > 8) continue;
        if (Math.abs(az - z) > 8 && Math.abs(bz - z) > 8) continue;
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (z + 0.5 - az) * dz) / (dx * dx + dz * dz || 1)));
        const wobble = (noise(x, z, 7, 11) - 0.5) * 2.2;
        if (Math.hypot(ax + dx * t - x - 0.5 + wobble, az + dz * t - z - 0.5 - wobble) < 1.0) return true;
      }
    }
    return false;
  }
  isWater(x: number, z: number): boolean {
    return (this.w.water[this.coarse(x, z)] as number) !== 0;
  }
  /** Nível inteiro da célula, usado pelos modos com degrau. */
  level(x: number, z: number, step: number): number {
    return Math.round(Math.pow(this.meters(x, z) / 150, 0.8) * (RELIEF_SCALE / step));
  }
  /** Altura de um canto da grade fina, nos modos contínuos. */
  vertexHeight(x: number, z: number, relief: Relief): number {
    const m = Math.pow(this.meters(x, z) / 150, 0.8) * RELIEF_SCALE;
    if (relief === 'lisa') return m;
    // Terraço: patamares planos, ligados por uma encosta curta que dá para subir a pé.
    const s = 0.44, t = m / s, f = t - Math.floor(t);
    return (Math.floor(t) + smooth(Math.max(0, (f - 0.45) / 0.55))) * s;
  }
}

class Mesh {
  out: number[] = [];
  tri(a: readonly number[], b: readonly number[], c: readonly number[], color: RGB, leg = 0): void {
    const ux = (b[0] as number) - (a[0] as number), uy = (b[1] as number) - (a[1] as number), uz = (b[2] as number) - (a[2] as number);
    const vx = (c[0] as number) - (a[0] as number), vy = (c[1] as number) - (a[1] as number), vz = (c[2] as number) - (a[2] as number);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) this.out.push(p[0] as number, p[1] as number, p[2] as number, nx, ny, nz, color[0], color[1], color[2], leg);
  }
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: RGB, leg = 0): void {
    this.tri(a, b, c, color, leg);
    this.tri(a, c, d, color, leg);
  }
  box(cx: number, y0: number, y1: number, cz: number, sx: number, sz: number, color: RGB, leg = 0): void {
    const x0 = cx - sx, x1 = cx + sx, z0 = cz - sz, z1 = cz + sz;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], color, leg);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, leg);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, leg);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, leg);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, leg);
  }
  cone(y0: number, y1: number, r: number, sides: number, color: RGB): void {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, b = ((k + 1) / sides) * Math.PI * 2;
      this.tri([Math.cos(a) * r, y0, Math.sin(a) * r], [0, y1, 0], [Math.cos(b) * r, y0, Math.sin(b) * r], color);
    }
  }
  /** Bloco de faces planas e irregular: copas e pedras. Nunca redondo liso: as faces têm de aparecer. */
  gem(cy: number, r: number, squash: number, seed: number, color: RGB): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const v = base.map((p, i) => {
      const l = Math.hypot(p[0] as number, p[1] as number, p[2] as number);
      const k = (r / l) * (0.78 + 0.44 * hash2(i, seed, 5));
      return [(p[0] as number) * k, cy + (p[1] as number) * k * squash, (p[2] as number) * k];
    });
    for (const f of faces) this.tri(v[f[0] as number] as number[], v[f[1] as number] as number[], v[f[2] as number] as number[], color);
  }
  build(): Float32Array { return new Float32Array(this.out); }
}

const WHITE: RGB = [1, 1, 1];

/** Modelos instanciados, com as formas das referências (`docs/img/referencias/plantas`). */
export function kindMesh(kind: Kind): Float32Array {
  const m = new Mesh();
  switch (kind) {
    case 'pinheiro': m.cone(0.22, 0.75, 0.36, 6, WHITE); m.cone(0.55, 1.05, 0.28, 6, [1.06, 1.06, 1.06]); m.cone(0.86, 1.32, 0.19, 6, [1.12, 1.12, 1.12]); break;
    case 'copa': m.gem(0.72, 0.42, 0.92, 1, WHITE); break;
    case 'acacia': m.gem(0.95, 0.56, 0.3, 2, WHITE); break;
    case 'tropical': m.gem(1.25, 0.42, 0.55, 3, WHITE); m.gem(1.05, 0.28, 0.5, 4, [0.92, 0.92, 0.92]); break;
    case 'cacto': m.box(0, 0, 0.82, 0, 0.075, 0.075, WHITE); m.box(0.16, 0.34, 0.62, 0, 0.05, 0.05, WHITE); m.box(-0.16, 0.26, 0.5, 0, 0.05, 0.05, WHITE); m.box(0.1, 0.34, 0.4, 0, 0.09, 0.04, WHITE); m.box(-0.1, 0.26, 0.32, 0, 0.09, 0.04, WHITE); break;
    case 'arbusto': m.gem(0.17, 0.2, 0.75, 6, WHITE); break;
    case 'tronco': m.box(0, 0, 0.5, 0, 0.055, 0.055, WHITE); break;
    case 'parede': m.box(0, 0, 1, 0, 0.5, 0.5, WHITE); break;
    case 'telhado': {
      const e = 0.56;
      m.quad([-e, 0, e], [0, 0.6, e], [0, 0.6, -e], [-e, 0, -e], WHITE);
      m.quad([e, 0, -e], [0, 0.6, -e], [0, 0.6, e], [e, 0, e], WHITE);
      m.tri([e, 0, e], [0, 0.6, e], [-e, 0, e], [0.9, 0.9, 0.85]);
      m.tri([-e, 0, -e], [0, 0.6, -e], [e, 0, -e], [0.9, 0.9, 0.85]);
      break;
    }
    case 'pedra': m.gem(0.14, 0.2, 0.8, 8, WHITE); m.gem(0.09, 0.12, 0.8, 9, [0.82, 0.82, 0.82]); break;
    case 'rocha': m.gem(0.12, 0.2, 0.7, 10, WHITE); break;
  }
  return m.build();
}

/** O mesmo modelo para longe (regra 16: trocar o detalhe pela distância): mesma silhueta, menos faces. Tronco não aparece de longe. */
export function kindMeshFar(kind: Kind): Float32Array {
  const m = new Mesh();
  const octa = (cy: number, r: number, squash: number, c: RGB = WHITE) => {
    const top = [0, cy + r * squash, 0], low = [0, cy - r * squash, 0];
    const ring = [[r, cy, 0], [0, cy, r], [-r, cy, 0], [0, cy, -r]] as number[][];
    for (let k = 0; k < 4; k++) {
      const a = ring[k] as number[], b = ring[(k + 1) % 4] as number[];
      m.tri(a, top, b, c);
      m.tri(b, low, a, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
    }
  };
  switch (kind) {
    case 'pinheiro': m.cone(0.2, 1.32, 0.36, 5, WHITE); break;
    case 'copa': octa(0.72, 0.42, 0.92); break;
    case 'acacia': octa(0.95, 0.56, 0.3); break;
    case 'tropical': octa(1.2, 0.42, 0.6); break;
    case 'cacto': m.box(0, 0, 0.82, 0, 0.09, 0.09, WHITE); break;
    case 'arbusto': octa(0.17, 0.2, 0.75); break;
    case 'pedra': octa(0.14, 0.2, 0.8); break;
    case 'rocha': octa(0.12, 0.2, 0.7); break;
    case 'tronco': break;
    default: return kindMesh(kind);
  }
  return m.build();
}

export function figureMesh(): Float32Array {
  const m = new Mesh();
  const skin: RGB = [1.25, 1.1, 0.95];
  m.box(-0.09, 0, 0.36, 0, 0.07, 0.08, [0.3, 0.33, 0.55], 1);
  m.box(0.09, 0, 0.36, 0, 0.07, 0.08, [0.3, 0.33, 0.55], -1);
  m.box(0, 0.36, 0.76, 0, 0.17, 0.11, WHITE);
  m.box(0, 0.76, 1, 0, 0.11, 0.11, skin);
  return m.build();
}

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Base do penhasco da borda da maquete. */
const BASE = -4;

/**
 * Alturas dos 4 cantos da célula fina (x, z), para o modo de relevo. Rampas e escadas ficam em trechos do degrau,
 * sorteados pela posição, de modo que dois pedaços vizinhos concordam.
 */
export function cellCorners(s: Sampler, x: number, z: number, relief: Relief, out: Float32Array, o: number): void {
  if (relief === 'lisa' || relief === 'terraco') {
    out[o] = s.vertexHeight(x, z, relief);
    out[o + 1] = s.vertexHeight(x + 1, z, relief);
    out[o + 2] = s.vertexHeight(x + 1, z + 1, relief);
    out[o + 3] = s.vertexHeight(x, z + 1, relief);
    return;
  }
  // "baixo": degrau pequeno onde o relevo é suave (passa a pé); perto de encosta, mais alto com rampa.
  const step = relief === 'baixo' ? 0.11 : 0.22;
  const h = s.level(x, z, step) * step;
  out[o] = h; out[o + 1] = h; out[o + 2] = h; out[o + 3] = h;
  if (relief === 'degrau' || relief === 'escada') return;
  // Rampa: esta célula sobe até o vizinho mais alto nos trechos sorteados (faixas de 3 a cada ~8 células).
  const up = (dx: number, dz: number) => s.level(x + dx, z + dz, step) * step - h;
  const band = (a: number) => hash2(Math.floor(a / 8), relief === 'baixo' ? 3 : 7, 21) * 5 > (a % 8 + 8) % 8;
  const lim = relief === 'baixo' ? 0.25 : step * 1.01;
  const u = up(1, 0), v = up(-1, 0), w = up(0, 1), y = up(0, -1);
  if (u > WALK_STEP && u <= lim && band(z)) { out[o + 1] = h + u; out[o + 2] = h + u; return; }
  if (v > WALK_STEP && v <= lim && band(z)) { out[o] = h + v; out[o + 3] = h + v; return; }
  if (w > WALK_STEP && w <= lim && band(x)) { out[o + 2] = h + w; out[o + 3] = h + w; return; }
  if (y > WALK_STEP && y <= lim && band(x)) { out[o] = h + y; out[o + 1] = h + y; }
}

/** Monta um pedaço inteiro. */
export function buildChunk(whole: WorldData, cx: number, cz: number): ChunkData {
  const started = performance.now();
  const N = CHUNK, x0 = cx * N, z0 = cz * N;
  // Só os trechos de rio perto deste pedaço (o teste é por célula).
  const rivers: Float32Array[] = [];
  for (const r of whole.rivers) for (let k = 0; k + 3 < r.length; k += 2) {
    const ax = r[k] as number, az = r[k + 1] as number, bx = r[k + 2] as number, bz = r[k + 3] as number;
    if (Math.max(ax, bx) > x0 - 10 && Math.min(ax, bx) < x0 + N + 10 && Math.max(az, bz) > z0 - 10 && Math.min(az, bz) < z0 + N + 10) rivers.push(new Float32Array([ax, az, bx, bz]));
  }
  const w: WorldData = { ...whole, rivers };
  const s = new Sampler(w);
  const p = w.palette;
  const corners = new Float32Array(N * N * 4);
  const walk = new Uint8Array(N * N);
  const land = new Mesh(), sea = new Mesh();
  const inst: Record<Kind, number[]> = { pinheiro: [], copa: [], acacia: [], tropical: [], cacto: [], arbusto: [], tronco: [], parede: [], telhado: [], pedra: [], rocha: [] };
  const put = (k: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, c: RGB) => inst[k].push(x, y, z, sx, sy, sz, rot, 0, c[0], c[1], c[2]);
  const tmp = new Float32Array(4), other = new Float32Array(4);
  const seaY = -0.12;
  const near = w.cities.filter((c) => c.x + c.r > x0 - 1 && c.x - c.r < x0 + N + 1 && c.z + c.r > z0 - 1 && c.z - c.r < z0 + N + 1);
  const pick = <T>(a: readonly T[], r: number): T => a[Math.min(a.length - 1, Math.floor(r * a.length))] as T;

  const heightsAt = (x: number, z: number, into: Float32Array) => {
    if (s.isWater(x, z)) into.fill(seaY - 0.25);
    else if (s.isRiver(x, z)) { cellCorners(s, x, z, w.relief === 'degrau' ? 'degrau' : w.relief, into, 0); const m = Math.min(into[0] as number, into[1] as number, into[2] as number, into[3] as number) - 0.08; into.fill(Math.max(0, m)); }
    else cellCorners(s, x, z, w.relief, into, 0);
  };
  for (let dz = 0; dz < N; dz++) {
    for (let dx = 0; dx < N; dx++) {
      const x = x0 + dx, z = z0 + dz, o = (dz * N + dx) * 4;
      const c = s.coarse(x, z);
      const biome = w.biome[c] as number;
      const water = s.isWater(x, z), river = !water && s.isRiver(x, z);
      heightsAt(x, z, tmp);
      corners.set(tmp, o);
      // Na escada o desenho é plano, com os degraus por cima; para quem anda, ela vale como a rampa no mesmo lugar.
      if (w.relief === 'escada' && !water && !river) { cellCorners(s, x, z, 'rampa', other, 0); corners.set(other, o); }
      const a = tmp[0] as number, b = tmp[1] as number, cc = tmp[2] as number, d = tmp[3] as number;
      walk[dz * N + dx] = water || river ? 0 : 1;
      const r0 = hash2(x, z, 31), speck = 1 + (r0 - 0.5) * 0.045;
      const city = near.find((q) => Math.hypot(q.x - x - 0.5, q.z - z - 0.5) < q.r);
      if (water) {
        const color = shade(biome === Biome.DeepOcean ? p.deep : p.shallow, 1 + (r0 - 0.5) * 0.05);
        land.quad([x, a, z], [x, d, z + 1], [x + 1, cc, z + 1], [x + 1, b, z], shade(p.sideLow, 0.8));
        sea.quad([x, seaY, z], [x, seaY, z + 1], [x + 1, seaY, z + 1], [x + 1, seaY, z], color);
      } else if (river) {
        land.quad([x, a, z], [x, d, z + 1], [x + 1, cc, z + 1], [x + 1, b, z], shade(p.shallow, speck));
      } else {
        // Terra: cor do bioma, misturando com a do bioma vizinho na mesma célula grande só pela ondulação da borda.
        // Petróleo aparente (decisão de 2026-11-05): parte da jazida aflora como poça preta; a outra parte fica escondida.
        const oil = (w.deposit[c] as number) === Resource.Oil && hash2(Math.floor(x / 3), Math.floor(z / 3), 41) < 0.55;
        const road = city && ((x - Math.round(city.x)) % 4 === 0 || (z - Math.round(city.z)) % 4 === 0);
        const color = oil ? ([0.05, 0.045, 0.06] as RGB) : road ? p.road : shade(p.biome[biome] as RGB, speck);
        // Diagonal que acompanha a inclinação, para a rampa não dobrar errado.
        if (Math.abs(a - cc) <= Math.abs(b - d)) land.quad([x, a, z], [x, d, z + 1], [x + 1, cc, z + 1], [x + 1, b, z], color);
        else { land.tri([x, a, z], [x, d, z + 1], [x + 1, b, z], color); land.tri([x + 1, b, z], [x, d, z + 1], [x + 1, cc, z + 1], color); }
        // Escada: degraus de pedra nos trechos sorteados de cada degrau.
        if (w.relief === 'escada') {
          const stair = p.road;
          for (const [ox, oz, band] of [[1, 0, z], [-1, 0, z], [0, 1, x], [0, -1, x]] as const) {
            if (!(hash2(Math.floor(band / 8), 7, 21) * 5 > ((band % 8) + 8) % 8)) continue;
            const up = s.level(x + ox, z + oz, 0.22) * 0.22 - a;
            if (up < 0.15 || up > 0.23) continue;
            for (let k = 0; k < 3; k++) {
              // Do pé (longe da parede) ao topo (junto dela), na metade da célula que encosta no degrau.
              const off = 0.5 - ((2.5 - k) / 3) * 0.5;
              land.box(x + 0.5 + ox * off, a, a + (up * (k + 1)) / 3, z + 0.5 + oz * off, ox ? 0.09 : 0.46, oz ? 0.09 : 0.46, stair);
            }
          }
        }
        // Objetos: nunca em rua ou rio.
        if (!road) decorate(s, w, put, x, z, biome, c, (a + b + cc + d) / 4, city, pick);
      }
      // Paredes do degrau e penhasco da borda do pedaço (coberto pelo vizinho quando ele existe).
      const ownEdge = [[a, d, x, z, x, z + 1], [cc, b, x + 1, z + 1, x + 1, z], [d, cc, x, z + 1, x + 1, z + 1], [b, a, x + 1, z, x, z]] as const;
      const dirs = [[-1, 0, 1, 2], [1, 0, 3, 0], [0, 1, 0, 1], [0, -1, 2, 3]] as const;
      for (let e = 0; e < 4; e++) {
        const dir = dirs[e] as readonly [number, number, number, number];
        const ax = dx + dir[0], az = dz + dir[1];
        const edge = ax < 0 || az < 0 || ax >= N || az >= N;
        heightsAt(x + dir[0], z + dir[1], other);
        const nA = other[dir[2]] as number, nB = other[dir[3]] as number;
        const own = ownEdge[e] as readonly [number, number, number, number, number, number];
        const top0 = own[0], top1 = own[1];
        // Borda do pedaço: sempre desce até a base (penhasco com camadas de terra, escondido quando há vizinho).
        const low0 = edge ? BASE : nA, low1 = edge ? BASE : nB;
        if (low0 >= top0 && low1 >= top1) continue;
        const mkColor = edge ? shade(p.sideLow, 1) : shade(p.side, 0.96 + r0 * 0.08);
        if (edge) {
          const mid = -1.2;
          land.quad([own[2], mid, own[3]], [own[4], mid, own[5]], [own[4], top1, own[5]], [own[2], top0, own[3]], shade(p.side, 1));
          land.quad([own[2], BASE, own[3]], [own[4], BASE, own[5]], [own[4], mid, own[5]], [own[2], mid, own[3]], mkColor);
        } else land.quad([own[2], low0, own[3]], [own[4], low1, own[5]], [own[4], top1, own[5]], [own[2], top0, own[3]], mkColor);
      }
    }
  }
  const instances = {} as Record<Kind, Float32Array>;
  for (const k of KINDS) instances[k] = new Float32Array(inst[k]);
  return { cx, cz, terrain: land.build(), sea: sea.build(), instances, corners, walk, ms: performance.now() - started };
}

function decorate(s: Sampler, w: WorldData, put: (k: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, c: RGB) => void, x: number, z: number, biome: number, coarse: number, y: number, city: City | undefined, pick: <T>(a: readonly T[], r: number) => T): void {
  const p = w.palette;
  void s;
  const r = (k: number) => hash2(x, z, k);
  if (city) {
    const near = 1 - Math.hypot(city.x - x - 0.5, city.z - z - 0.5) / city.r;
    const big = city.r > 8;
    const size = big ? 0.42 : 0.38;
    if (r(50) > (big ? 0.95 : 0.55)) return;
    const h = big ? 0.3 + near * near * (0.6 + r(51) * 1.9) : 0.26 + r(51) * 0.08;
    const rot = big ? 0 : Math.floor(r(52) * 4) * (Math.PI / 2);
    put('parede', x + 0.5, y, z + 0.5, size * 2, h, size * 2, rot, pick(p.walls, r(53)));
    put('telhado', x + 0.5, y + h, z + 0.5, size * 2, 0.45 * size * 2, size * 2, rot, pick(p.roofs, r(54)));
    return;
  }
  // Jazida (item 1.9): pedrinhas facetadas e angulosas, da cor do minério, na referência `recursos/jazidas.png`.
  const dep = w.deposit[coarse] as number;
  if (dep > 0 && dep !== Resource.Oil && r(60) < 0.55) {
    const sc = 0.9 + r(61) * 1.4;
    const c = shade(p.resources[dep] as RGB, 0.85 + r(63) * 0.3);
    put('pedra', x + 0.2 + r(62) * 0.6, y, z + 0.2 + r(64) * 0.6, sc, sc, sc, r(65) * 6.28, c);
    return;
  }
  const table: Partial<Record<number, number>> = { [Biome.TemperateForest]: 0.62, [Biome.TropicalForest]: 0.8, [Biome.Taiga]: 0.62, [Biome.Swamp]: 0.3, [Biome.Grassland]: 0.06, [Biome.Savanna]: 0.09, [Biome.Tundra]: 0.03, [Biome.Steppe]: 0.03, [Biome.Mountain]: 0.1, [Biome.HotDesert]: 0.018, [Biome.ColdDesert]: 0.012, [Biome.Beach]: 0.01 };
  const want = w.density * (table[biome] ?? 0);
  for (let k = Math.floor(want + r(70)); k > 0; k--) {
    const tx = x + 0.12 + r(71 + k) * 0.76, tz = z + 0.12 + r(81 + k) * 0.76, sc = 0.8 + r(91 + k) * 0.55, rot = r(101 + k) * 6.28;
    const leaves = (p.leaves[biome] ?? p.leaves[Biome.TemperateForest]) as readonly RGB[];
    const col = pick(leaves, r(111 + k));
    switch (biome) {
      case Biome.Taiga: case Biome.Mountain:
        put('pinheiro', tx, y, tz, sc, sc * 1.05, sc, rot, col);
        break;
      case Biome.Savanna: case Biome.Steppe:
        put('acacia', tx, y, tz, sc * 1.2, sc * 1.1, sc * 1.2, rot, col);
        put('tronco', tx, y, tz, sc * 1.1, sc * 1.9, sc * 1.1, rot, p.trunk);
        break;
      case Biome.TropicalForest:
        put('tropical', tx, y, tz, sc, sc * 1.1, sc, rot, col);
        put('tronco', tx, y, tz, sc, sc * 2.4, sc, rot, p.trunk);
        break;
      case Biome.HotDesert: case Biome.ColdDesert:
        if (r(121 + k) < 0.5) put('cacto', tx, y, tz, sc, sc, sc, rot, col);
        else put('rocha', tx, y, tz, sc * 1.8, sc * 1.1, sc * 1.8, rot, mix(p.biome[biome] as RGB, [0.45, 0.4, 0.35], 0.45));
        break;
      case Biome.Tundra: case Biome.Beach:
        put('arbusto', tx, y, tz, sc, sc, sc, rot, col);
        break;
      default:
        put('copa', tx, y, tz, sc, sc, sc, rot, col);
        put('tronco', tx, y, tz, sc, sc, sc, rot, p.trunk);
    }
  }
}
