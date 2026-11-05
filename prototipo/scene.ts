import { Biome } from '../src/world/biomes';
import type { WorldState } from '../src/world/state';
import type { RGB, Style } from './styles';

/**
 * A cena do diorama do portão do M3: uma região de ~64×64 células do mundo de verdade, em dados neutros que
 * os três caminhos de desenho consomem (WebGL2, Three.js, sprites). 1 unidade = 1 célula; y para cima.
 */
export const REGION = 64;
/** Por vértice: posição (3), normal (3), cor (3), perna (1). */
export const VERTEX_FLOATS = 10;
/** Por instância: posição (3), escala (3), giro, fase, cor (3). */
export const INSTANCE_FLOATS = 11;

export interface Mesh {
  data: Float32Array;
  vertices: number;
}

export interface Instances {
  mesh: Mesh;
  data: Float32Array;
  count: number;
  /** Projeta sombra? */
  casts: boolean;
}

export interface Region {
  face: number;
  x0: number;
  y0: number;
  /** Altura em unidades (0 = nível do mar), por célula. */
  heights: Float32Array;
  water: Uint8Array;
}

export interface Scene {
  region: Region;
  style: Style;
  terrain: Mesh;
  water: Mesh;
  parts: Instances[];
  figures: Figures;
  triangles: number;
  buildMs: number;
  counts: { trees: number; buildings: number; figures: number };
  /** Cidade (primeira) e vilas: centro e raio, em células da região. */
  centers: { x: number; y: number; r: number }[];
  river: number[];
  /** Pontos para o guia de estilo. */
  spots: Record<'cidade' | 'vila' | 'montanha' | 'floresta', { x: number; z: number }>;
}

export interface Figures {
  body: Instances;
  blob: Instances;
  /** Por figura: x, z, direção. */
  walk: Float32Array;
  count: number;
}

class MeshBuilder {
  private out: number[] = [];
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
  /** Caixa centrada em (cx, cz), de y0 a y1 (faces de cima e lados; sem a de baixo). */
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
      const pa = [Math.cos(a) * r, y0, Math.sin(a) * r], pb = [Math.cos(b) * r, y0, Math.sin(b) * r];
      this.tri(pa, [0, y1, 0], pb, color);
    }
  }
  /** Copa redonda de faces lisas: octaedro subdividido uma vez (32 triângulos). */
  ball(cy: number, r: number, color: RGB): void {
    const n = (p: number[]) => { const l = Math.hypot(p[0] as number, p[1] as number, p[2] as number); return [(p[0] as number) / l, (p[1] as number) / l, (p[2] as number) / l]; };
    const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]] as number[][];
    const faces = [[0, 1, 2], [2, 1, 3], [3, 1, 5], [5, 1, 0], [2, 4, 0], [3, 4, 2], [5, 4, 3], [0, 4, 5]] as number[][];
    const place = (p: number[]) => [(p[0] as number) * r, cy + (p[1] as number) * r, (p[2] as number) * r];
    for (const f of faces) {
      const a = v[f[0] as number] as number[], b = v[f[1] as number] as number[], c = v[f[2] as number] as number[];
      const ab = n(a.map((x, i) => x + (b[i] as number))), bc = n(b.map((x, i) => x + (c[i] as number))), ca = n(c.map((x, i) => x + (a[i] as number)));
      for (const t of [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as number[][][]) this.tri(place(t[0] as number[]), place(t[1] as number[]), place(t[2] as number[]), color);
    }
  }
  build(): Mesh {
    return { data: new Float32Array(this.out), vertices: this.out.length / VERTEX_FLOATS };
  }
}

const WHITE: RGB = [1, 1, 1];

function canopyMesh(style: Style): Mesh {
  const m = new MeshBuilder();
  if (style.tree === 'cone') {
    m.cone(0.3, 0.8, 0.34, 6, WHITE);
    m.cone(0.62, 1.15, 0.25, 6, [1.08, 1.08, 1.08]);
  } else if (style.tree === 'round') m.ball(0.62, 0.34, WHITE);
  else m.box(0, 0.32, 0.95, 0, 0.27, 0.27, WHITE);
  return m.build();
}
function trunkMesh(): Mesh {
  const m = new MeshBuilder();
  m.box(0, 0, 0.36, 0, 0.055, 0.055, WHITE);
  return m.build();
}
function wallMesh(): Mesh {
  const m = new MeshBuilder();
  m.box(0, 0, 1, 0, 0.5, 0.5, WHITE);
  return m.build();
}
function roofMesh(style: Style): Mesh {
  const m = new MeshBuilder();
  if (style.roof === 'flat') {
    m.box(0, 0, 0.12, 0, 0.56, 0.56, WHITE);
    return m.build();
  }
  const e = 0.56;
  m.quad([-e, 0, e], [0, 0.6, e], [0, 0.6, -e], [-e, 0, -e], WHITE);
  m.quad([e, 0, -e], [0, 0.6, -e], [0, 0.6, e], [e, 0, e], WHITE);
  m.tri([e, 0, e], [0, 0.6, e], [-e, 0, e], [0.9, 0.9, 0.85]);
  m.tri([-e, 0, -e], [0, 0.6, -e], [e, 0, -e], [0.9, 0.9, 0.85]);
  return m.build();
}
/** O boneco: pernas (balançam no shader), corpo e cabeça. Altura 1 (a instância escala). */
function figureMesh(): Mesh {
  const m = new MeshBuilder();
  const skin: RGB = [1.25, 1.1, 0.95];
  m.box(-0.09, 0, 0.36, 0, 0.07, 0.08, [0.45, 0.42, 0.45], 1);
  m.box(0.09, 0, 0.36, 0, 0.07, 0.08, [0.45, 0.42, 0.45], -1);
  m.box(0, 0.36, 0.76, 0, 0.17, 0.11, WHITE);
  m.box(0, 0.76, 1, 0, 0.11, 0.11, skin);
  return m.build();
}
function blobMesh(): Mesh {
  const m = new MeshBuilder();
  const s = 10;
  for (let k = 0; k < s; k++) {
    const a = (k / s) * Math.PI * 2, b = ((k + 1) / s) * Math.PI * 2;
    m.tri([Math.cos(b), 0, Math.sin(b)], [Math.cos(a), 0, Math.sin(a)], [0, 0, 0], WHITE);
  }
  return m.build();
}

export interface RegionPlace {
  face: number;
  x0: number;
  y0: number;
  flip: boolean;
}

/** Número fixo por célula, para a cena ser sempre a mesma (o protótipo também é determinístico). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A melhor janela do mundo para o protótipo: muita terra, com mar, floresta, campo e montanha. */
export function pickRegion(world: WorldState): RegionPlace {
  const n = world.grid.n;
  let best: RegionPlace = { face: 0, x0: 0, y0: 0, flip: false };
  let bestScore = -1;
  for (let face = 0; face < 6; face++) {
    // Em metade das faces, x e y da grade formam um sistema espelhado visto de fora: `flip` desfaz, para casar com o globo.
    const g = world.grid;
    const [cx, cy, cz] = g.cellToPoint(face, n >> 1, n >> 1) as [number, number, number];
    const [ax, ay, az] = g.cellToPoint(face, (n >> 1) + 1, n >> 1) as [number, number, number];
    const [bx, by, bz] = g.cellToPoint(face, n >> 1, (n >> 1) + 1) as [number, number, number];
    const ux = ax - cx, uy = ay - cy, uz = az - cz, vx = cx - bx, vy = cy - by, vz = cz - bz;
    const flip = (uy * vz - uz * vy) * cx + (uz * vx - ux * vz) * cy + (ux * vy - uy * vx) * cz < 0;
    for (let y0 = 0; y0 + REGION <= n; y0 += 16) {
      for (let x0 = 0; x0 + REGION <= n; x0 += 16) {
        let land = 0, forest = 0, grass = 0, peak = 0;
        for (let y = 0; y < REGION; y += 2) {
          for (let x = 0; x < REGION; x += 2) {
            const c = world.grid.index(face, x0 + x, y0 + y);
            if (world.isWater(c)) continue;
            land++;
            const b = world.biome[c] as number;
            if (b === Biome.TemperateForest || b === Biome.Taiga || b === Biome.TropicalForest) forest++;
            if (b === Biome.Grassland || b === Biome.Savanna || b === Biome.Steppe) grass++;
            if (b === Biome.Mountain || b === Biome.SnowyPeak) peak++;
          }
        }
        const total = (REGION / 2) ** 2;
        const f = land / total;
        const score = (f > 0.55 && f < 0.95 ? 1 : 0.2) * (Math.min(forest / total, 0.3) + Math.min(grass / total, 0.3) + Math.min(peak / total, 0.12));
        if (score > bestScore) {
          bestScore = score;
          best = { face, x0, y0, flip };
        }
      }
    }
  }
  return best;
}

export interface BuildOptions {
  /** Multiplica árvores e bonecos. */
  load: number;
}

function push(out: number[], x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, phase: number, c: RGB): void {
  out.push(x, y, z, sx, sy, sz, rot, phase, c[0], c[1], c[2]);
}

export function buildScene(world: WorldState, at: RegionPlace, style: Style, options: BuildOptions): Scene {
  const start = performance.now();
  const rng = makeRng(0x51ed ^ (at.face * 977) ^ (at.x0 * 31) ^ at.y0);
  const size = REGION;
  const idx = (x: number, y: number) => y * size + x;
  const heights = new Float32Array(size * size);
  const water = new Uint8Array(size * size);
  const biome = new Uint8Array(size * size);
  const cellOf = (x: number, y: number) => world.grid.index(at.face, at.x0 + (at.flip ? size - 1 - x : x), at.y0 + y);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = cellOf(x, y);
      biome[idx(x, y)] = world.biome[c] as number;
      if (world.isWater(c)) {
        water[idx(x, y)] = 1;
        heights[idx(x, y)] = -style.step * 0.5;
      } else {
        // Degraus: sobe depressa no baixo e devagar no alto, para a montanha não virar uma torre.
        const m = Math.max(0, world.heightAboveSea(c));
        heights[idx(x, y)] = Math.round(Math.pow(m / 170, 0.8)) * style.step;
      }
    }
  }
  // Um rio: desce do ponto mais alto até o mar, sempre pelo vizinho mais baixo.
  let hx = 0, hy = 0;
  for (let y = 8; y < size - 8; y++) for (let x = 8; x < size - 8; x++) if ((heights[idx(x, y)] as number) > (heights[idx(hx, hy)] as number)) { hx = x; hy = y; }
  const river: number[] = [];
  for (let k = 0, x = hx, y = hy; k < 200 && !water[idx(x, y)]; k++) {
    river.push(idx(x, y));
    let nx = x, ny = y, best = Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ax = x + dx, ay = y + dy;
      if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
      const i = idx(ax, ay);
      if (river.includes(i)) continue;
      const v = (heights[i] as number) + rng() * 0.3;
      if (v < best) { best = v; nx = ax; ny = ay; }
    }
    if (best === Infinity) break;
    x = nx; y = ny;
  }
  const riverSet = new Set(river.slice(4));
  // Cidade e vilas nas maiores áreas planas de campo, longe do rio.
  const buildable = (i: number) => !water[i] && !riverSet.has(i) && (heights[i] as number) < 9 * style.step && biome[i] !== Biome.Mountain && biome[i] !== Biome.SnowyPeak;
  const flatScore = (cx: number, cy: number, r: number) => {
    let s = 0;
    const h0 = heights[idx(cx, cy)] as number;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const ax = cx + x, ay = cy + y;
      if (ax < 1 || ay < 1 || ax >= size - 1 || ay >= size - 1) { s -= 2; continue; }
      const i = idx(ax, ay);
      if (buildable(i) && Math.abs((heights[i] as number) - h0) <= style.step) s++;
    }
    return s;
  };
  const centers: { x: number; y: number; r: number }[] = [];
  const place = (r: number, count: number) => {
    for (let k = 0; k < count; k++) {
      let best = { x: 0, y: 0, s: -Infinity };
      for (let t = 0; t < 400; t++) {
        const x = 3 + Math.floor(rng() * (size - 6)), y = 3 + Math.floor(rng() * (size - 6));
        if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + r + 3)) continue;
        const s = flatScore(x, y, r);
        if (s > best.s) best = { x, y, s };
      }
      if (best.s > r * r) centers.push({ x: best.x, y: best.y, r });
    }
  };
  place(8, 1);
  place(3, 4);
  const road = new Uint8Array(size * size);
  const walls: number[] = [], roofs: number[] = [];
  let buildings = 0;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)] as T;
  const building = (x: number, z: number, y: number, w: number, h: number, d: number, tall: boolean) => {
    const rot = tall ? 0 : Math.floor(rng() * 4) * (Math.PI / 2);
    push(walls, x, y, z, w, h, d, rot, 0, pick(style.walls));
    const roofY = style.roof === 'flat' ? 1 : (tall ? 0.45 : 0.9);
    push(roofs, x, y + h, z, w, roofY * Math.min(w, d) * 1.1, d, rot, 0, pick(style.roofs));
    buildings++;
  };
  centers.forEach((c, n) => {
    const city = n === 0;
    for (let dy = -c.r; dy <= c.r; dy++) {
      for (let dx = -c.r; dx <= c.r; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        const i = idx(x, y);
        if (!buildable(i) || Math.hypot(dx, dy) > c.r + 0.5) continue;
        const h0 = heights[i] as number;
        if (city ? dx % 4 === 0 || dy % 4 === 0 : dx === 0 || dy === 0) {
          road[i] = 1;
          continue;
        }
        road[i] = 2;
        if (!city && rng() > 0.55) continue;
        const near = 1 - Math.hypot(dx, dy) / (c.r + 1);
        const slots = city ? 2 : 1;
        for (let sy = 0; sy < slots; sy++) for (let sx = 0; sx < slots; sx++) {
          const ox = city ? (sx + 0.5) / slots : 0.5, oz = city ? (sy + 0.5) / slots : 0.5;
          const w = city ? 0.38 : 0.42 + rng() * 0.16;
          const h = city ? 0.3 + near * near * (0.6 + rng() * 1.9) : 0.26 + rng() * 0.08;
          building(x + ox, y + oz, h0, w, h, w * (0.85 + rng() * 0.2), city && h > 0.55);
        }
      }
    }
  });
  // Relevo: topo de cada célula + paredes de cada degrau + o penhasco da borda da maquete.
  const land = new MeshBuilder(), sea = new MeshBuilder();
  const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
  const base = -3.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      const h = heights[i] as number;
      const k = 1 + (rng() - 0.5) * style.speckle * 2;
      const b = biome[i] as number;
      if (water[i]) {
        sea.quad([x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], shade(style.water, k * (b === Biome.DeepOcean ? 0.82 : 1)));
      } else if (riverSet.has(i)) {
        land.quad([x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], shade(style.water, k));
      } else {
        const color = road[i] === 1 ? style.road : shade(style.biome[b] as RGB, road[i] === 2 ? 1.02 : k);
        land.quad([x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], color);
      }
      const wall = (ax: number, ay: number, p0: number[], p1: number[]) => {
        const edge = ax < 0 || ay < 0 || ax >= size || ay >= size;
        const other = edge ? base : (heights[idx(ax, ay)] as number);
        if (other >= h) return;
        const top = shade(style.side, k), low = other <= h - style.step * 1.5 ? shade(style.sideLow, k) : top;
        const a = [p0[0] as number, other, p0[1] as number], b2 = [p1[0] as number, other, p1[1] as number], c = [p1[0] as number, h, p1[1] as number], d = [p0[0] as number, h, p0[1] as number];
        land.quad(a, b2, c, d, edge ? low : top);
      };
      wall(x, y + 1, [x, y + 1], [x + 1, y + 1]);
      wall(x, y - 1, [x + 1, y], [x, y]);
      wall(x + 1, y, [x + 1, y + 1], [x + 1, y]);
      wall(x - 1, y, [x, y], [x, y + 1]);
    }
  }
  // Árvores: densidade pelo bioma, nunca em rua, casa, rio ou mar.
  const leaves: number[] = [], trunks: number[] = [];
  const DENSITY: Partial<Record<number, number>> = {
    [Biome.TemperateForest]: 2.2, [Biome.TropicalForest]: 2.8, [Biome.Taiga]: 1.8, [Biome.Swamp]: 1,
    [Biome.Grassland]: 0.12, [Biome.Savanna]: 0.18, [Biome.Tundra]: 0.04, [Biome.Steppe]: 0.05, [Biome.Mountain]: 0.1,
  };
  let trees = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (water[i] || riverSet.has(i) || road[i]) continue;
      const want = (DENSITY[biome[i] as number] ?? 0) * options.load;
      for (let k = Math.floor(want + rng()); k > 0; k--) {
        const tx = x + 0.12 + rng() * 0.76, tz = y + 0.12 + rng() * 0.76, s = 0.42 + rng() * 0.34;
        const rot = rng() * 6.28;
        push(leaves, tx, heights[i] as number, tz, s, s, s, rot, rng(), pick(style.leaves));
        push(trunks, tx, heights[i] as number, tz, s, s, s, rot, rng(), style.trunk);
        trees++;
      }
    }
  }
  // Bonecos: em volta das vilas e da cidade, e alguns soltos.
  const count = Math.round(240 * options.load);
  const walk = new Float32Array(count * 3);
  const figureColors: RGB[] = [[0.8, 0.25, 0.2], [0.2, 0.4, 0.75], [0.85, 0.7, 0.25], [0.3, 0.6, 0.35], [0.6, 0.35, 0.6]];
  const body: number[] = [], blob: number[] = [];
  for (let k = 0; k < count; k++) {
    let x = 0, z = 0;
    for (let t = 0; t < 30; t++) {
      const c = centers.length && rng() < 0.8 ? (centers[Math.floor(rng() * centers.length)] as { x: number; y: number; r: number }) : { x: size / 2, y: size / 2, r: size / 2 - 2 };
      x = c.x + (rng() - 0.5) * 2 * c.r;
      z = c.y + (rng() - 0.5) * 2 * c.r;
      if (x > 1 && z > 1 && x < size - 1 && z < size - 1 && !water[idx(Math.floor(x), Math.floor(z))]) break;
    }
    walk[k * 3] = x; walk[k * 3 + 1] = z; walk[k * 3 + 2] = rng() * 6.28;
    const s = 0.34;
    push(body, x, 0, z, s, s, s, 0, rng() * 6.28, pick(figureColors));
    push(blob, x, 0, z, 0.13, 1, 0.13, 0, 0, [0, 0, 0]);
  }
  const parts: Instances[] = [
    { mesh: canopyMesh(style), data: new Float32Array(leaves), count: trees, casts: true },
    { mesh: trunkMesh(), data: new Float32Array(trunks), count: trees, casts: false },
    { mesh: wallMesh(), data: new Float32Array(walls), count: buildings, casts: true },
    { mesh: roofMesh(style), data: new Float32Array(roofs), count: buildings, casts: true },
  ];
  const figures: Figures = {
    body: { mesh: figureMesh(), data: new Float32Array(body), count, casts: false },
    blob: { mesh: blobMesh(), data: new Float32Array(blob), count, casts: false },
    walk,
    count,
  };
  const terrain = land.build(), waterMesh = sea.build();
  let triangles = (terrain.vertices + waterMesh.vertices) / 3;
  for (const p of [...parts, figures.body, figures.blob]) triangles += (p.mesh.vertices / 3) * p.count;
  // Pontos para as vistas do guia de estilo: o trecho de 11×11 células com mais árvores e o ponto mais alto.
  const treeGrid = new Float32Array(size * size);
  for (let k = 0; k < trees; k++) {
    const i = idx(Math.floor(leaves[k * 11] as number), Math.floor(leaves[k * 11 + 2] as number));
    treeGrid[i] = (treeGrid[i] as number) + 1;
  }
  let forest = { x: size / 2, z: size / 2, n: -1 };
  for (let y = 6; y < size - 6; y += 3) for (let x = 6; x < size - 6; x += 3) {
    let n = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) n += treeGrid[idx(x + dx, y + dy)] as number;
    if (n > forest.n) forest = { x, z: y, n };
  }
  const city = centers[0] ?? { x: size / 2, y: size / 2, r: 4 }, village = centers[1] ?? city;
  const spots = { cidade: { x: city.x, z: city.y }, vila: { x: village.x, z: village.y }, montanha: { x: hx, z: hy }, floresta: { x: forest.x, z: forest.z } };
  return {
    centers,
    river,
    spots,
    region: { face: at.face, x0: at.x0, y0: at.y0, heights, water },
    style,
    terrain,
    water: waterMesh,
    parts,
    figures,
    triangles,
    buildMs: performance.now() - start,
    counts: { trees, buildings, figures: count },
  };
}

/** Anda os bonecos (o que uma simulação de indivíduos faria) e grava posição e direção nas instâncias. */
export function stepFigures(scene: Scene, dt: number): void {
  const { walk, count, body, blob } = scene.figures;
  const { heights, water } = scene.region;
  const size = REGION;
  const speed = 0.55;
  for (let k = 0; k < count; k++) {
    let x = walk[k * 3] as number, z = walk[k * 3 + 1] as number, d = walk[k * 3 + 2] as number;
    const nx = x + Math.cos(d) * speed * dt, nz = z + Math.sin(d) * speed * dt;
    const i = Math.floor(nz) * size + Math.floor(nx);
    if (nx < 1 || nz < 1 || nx >= size - 1 || nz >= size - 1 || water[i]) d += 1.9 + (k % 5) * 0.2;
    else {
      x = nx;
      z = nz;
    }
    walk[k * 3] = x; walk[k * 3 + 1] = z; walk[k * 3 + 2] = d;
    const h = (heights[Math.floor(z) * size + Math.floor(x)] as number) + 0.01;
    const o = k * INSTANCE_FLOATS;
    body.data[o] = x; body.data[o + 1] = h; body.data[o + 2] = z; body.data[o + 6] = -d + Math.PI / 2;
    blob.data[o] = x; blob.data[o + 1] = h + 0.01; blob.data[o + 2] = z;
  }
}

/** Câmera do diorama. */
export interface View {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

export function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

export function lookAt(eye: readonly number[], at: readonly number[], up: readonly number[]): Float32Array {
  const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const z = norm([(eye[0] as number) - (at[0] as number), (eye[1] as number) - (at[1] as number), (eye[2] as number) - (at[2] as number)]) as [number, number, number];
  const x = norm([(up[1] as number) * z[2] - (up[2] as number) * z[1], (up[2] as number) * z[0] - (up[0] as number) * z[2], (up[0] as number) * z[1] - (up[1] as number) * z[0]]) as [number, number, number];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]] as [number, number, number];
  const dot = (a: readonly number[], b: readonly number[]) => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
    o[c * 4 + r] = s;
  }
  return o;
}

export function eyeOf(v: View): [number, number, number] {
  const cp = Math.cos(v.pitch);
  return [v.x + Math.sin(v.yaw) * cp * v.distance, Math.sin(v.pitch) * v.distance, v.z + Math.cos(v.yaw) * cp * v.distance];
}

export function viewProjection(v: View, aspect: number): Float32Array {
  return multiply(perspective(v.fov, aspect, 1, 800), lookAt(eyeOf(v), [v.x, 0, v.z], [0, 1, 0]));
}

/** Matriz da sombra: o sol olhando para a região inteira. */
export function sunMatrix(sun: readonly number[]): Float32Array {
  const c = REGION / 2;
  const eye = [c + (sun[0] as number) * 120, (sun[1] as number) * 120, c + (sun[2] as number) * 120];
  const view = lookAt(eye, [c, 0, c], [0, 1, 0]);
  const r = REGION * 0.78, near = 10, far = 260;
  const ortho = new Float32Array([1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
  return multiply(ortho, view);
}
