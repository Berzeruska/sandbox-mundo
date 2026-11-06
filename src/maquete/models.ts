import { sequence } from './hash';

/**
 * Modelos facetados das plantas e pedras, desenhados a partir das folhas em `docs/img/referencias/plantas/` e
 * `recursos/`. Cada modelo é uma lista de triângulos com normal própria (facetas) e escurecimento na base (oclusão).
 * Tamanho em células finas; a origem é o pé do modelo.
 */
export type Rgb = readonly [number, number, number];
export type V3 = readonly [number, number, number];

/** x, y, z, nx, ny, nz, r, g, b, luz (0–1) por vértice. */
export const MODEL_FLOATS = 10;

export class Model {
  private out: number[] = [];

  /** Triângulo com a frente voltada para longe de `inside`. */
  tri(a: V3, b: V3, c: V3, color: Rgb, inside: V3, light: readonly [number, number, number] = [1, 1, 1]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0], my = (a[1] + b[1] + c[1]) / 3 - inside[1], mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    const flip = nx * mx + ny * my + nz * mz < 0;
    const order = flip ? [a, c, b] : [a, b, c];
    const lights = flip ? [light[0], light[2], light[1]] : [light[0], light[1], light[2]];
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    for (let k = 0; k < 3; k++) {
      const p = order[k] as V3;
      this.out.push(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2], lights[k] as number);
    }
  }

  /** Folha ou lâmina: as duas faces. */
  blade(a: V3, b: V3, c: V3, color: Rgb, light: readonly [number, number, number] = [1, 1, 1]): void {
    const inside: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 - 1, (a[2] + b[2] + c[2]) / 3];
    this.tri(a, b, c, color, inside, light);
    const other: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 + 1, (a[2] + b[2] + c[2]) / 3];
    this.tri(a, b, c, color, other, light);
  }

  build(): Float32Array {
    return new Float32Array(this.out);
  }
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V: readonly V3[] = [[-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0], [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T], [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1]];
const ICO_F: readonly (readonly [number, number, number])[] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const shadeOf = shade;
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];

/** Bola facetada e irregular (copa, arbusto, pedra). `detail` 1 divide cada face em 4. `foot` corta a parte de baixo. */
export function lump(m: Model, c: V3, r: V3, color: Rgb, seed: number, opts: { detail?: 0 | 1; rough?: number; tone?: number; low?: number; foot?: number } = {}): void {
  const rand = sequence(seed);
  const rough = opts.rough ?? 0.14, tone = opts.tone ?? 0.1, low = opts.low ?? 0.6, foot = opts.foot ?? -Infinity;
  const pts = new Map<string, V3>();
  const unit = (p: V3): V3 => {
    const k = `${Math.round(p[0] * 40)},${Math.round(p[1] * 40)},${Math.round(p[2] * 40)}`;
    let q = pts.get(k);
    if (!q) {
      const l = Math.hypot(p[0], p[1], p[2]) || 1, g = 1 + (rand() * 2 - 1) * rough;
      q = [(p[0] / l) * g, (p[1] / l) * g, (p[2] / l) * g];
      pts.set(k, q);
    }
    return q;
  };
  const world = (p: V3): V3 => [c[0] + p[0] * r[0], Math.max(foot, c[1] + p[1] * r[1]), c[2] + p[2] * r[2]];
  const emit = (a: V3, b: V3, d: V3): void => {
    const pa = world(a), pb = world(b), pd = world(d);
    const lightOf = (p: number) => low + (1 - low) * Math.min(1, Math.max(0, (p + 1) / 1.5));
    const up = (a[1] + b[1] + d[1]) / 3;
    const tint = shade(color, 1 + (rand() * 2 - 1) * tone + up * 0.08);
    m.tri(pa, pb, pd, tint, c, [lightOf(a[1]), lightOf(b[1]), lightOf(d[1])]);
  };
  for (const f of ICO_F) {
    const a = ICO_V[f[0]] as V3, b = ICO_V[f[1]] as V3, d = ICO_V[f[2]] as V3;
    if (!opts.detail) { emit(unit(a), unit(b), unit(d)); continue; }
    const mid = (p: V3, q: V3): V3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    const ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
    for (const [p, q, s] of [[a, ab, da], [ab, b, bd], [da, bd, d], [ab, bd, da]] as const) emit(unit(p), unit(q), unit(s));
  }
}

/** Haste de seção poligonal entre dois pontos. */
export function limb(m: Model, a: V3, b: V3, ra: number, rb: number, color: Rgb, sides = 5, lightA = 0.7, lightB = 1): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const d: V3 = [dx / len, dy / len, dz / len];
  const ref: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = d[1] * ref[2] - d[2] * ref[1], uy = d[2] * ref[0] - d[0] * ref[2], uz = d[0] * ref[1] - d[1] * ref[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const u: V3 = [ux / ul, uy / ul, uz / ul];
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const ring = (o: V3, r: number, i: number): V3 => {
    const t = (i / sides) * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [o[0] + u[0] * cs + v[0] * sn, o[1] + u[1] * cs + v[1] * sn, o[2] + u[2] * cs + v[2] * sn];
  };
  const inside: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  for (let i = 0; i < sides; i++) {
    const c = shade(color, 0.92 + (i % 3) * 0.07);
    const a0 = ring(a, ra, i), a1 = ring(a, ra, i + 1), b0 = ring(b, rb, i), b1 = ring(b, rb, i + 1);
    m.tri(a0, a1, b1, c, inside, [lightA, lightA, lightB]);
    if (rb > 0.001) m.tri(a0, b1, b0, c, inside, [lightA, lightB, lightB]);
    if (rb > 0.001) m.tri(b0, b1, b, shade(c, 1.05), inside, [lightB, lightB, lightB]);
  }
}

/** Saia de pinheiro: anel de baixo mais largo, topo fino, borda irregular. */
function pineTier(m: Model, y0: number, y1: number, r0: number, r1: number, color: Rgb, seed: number, sides = 8): void {
  const rand = sequence(seed);
  const a0 = rand() * 6.28;
  const rim: V3[] = [];
  for (let i = 0; i < sides; i++) {
    const t = a0 + (i / sides) * Math.PI * 2, rr = r0 * (0.92 + rand() * 0.16);
    rim.push([Math.cos(t) * rr, y0 + (rand() - 0.5) * 0.08, Math.sin(t) * rr]);
  }
  const inside: V3 = [0, (y0 + y1) / 2, 0];
  for (let i = 0; i < sides; i++) {
    const p = rim[i] as V3, q = rim[(i + 1) % sides] as V3;
    const t0 = a0 + (i / sides) * Math.PI * 2, t1 = a0 + ((i + 1) / sides) * Math.PI * 2;
    const c = shade(color, 0.92 + rand() * 0.16);
    if (r1 <= 0.001) m.tri(p, q, [0, y1, 0], c, inside, [0.72, 0.72, 1]);
    else {
      const p2: V3 = [Math.cos(t0) * r1, y1, Math.sin(t0) * r1], q2: V3 = [Math.cos(t1) * r1, y1, Math.sin(t1) * r1];
      m.tri(p, q, q2, c, inside, [0.72, 0.72, 1]);
      m.tri(p, q2, p2, c, inside, [0.72, 1, 1]);
    }
    m.tri(p, q, [0, y0 + 0.05, 0], shade(color, 0.55), [0, y0 + 1, 0], [0.5, 0.5, 0.5]);
  }
}

export const TRUNK = rgb(128, 84, 54);
export const TRUNK_DARK = rgb(112, 72, 48);

/** Pinheiro da taiga (`plantas/frio.png`): 4–5 saias, tronco curto. */
export function pine(seed: number, color: Rgb, tiers = 4, sides = 8): Float32Array {
  const m = new Model();
  limb(m, [0, 0, 0], [0, 0.95, 0], 0.25, 0.18, TRUNK_DARK, 5, 0.72, 0.9);
  const height = 3.75 + (seed % 3) * 0.28;
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const y0 = 0.72 + f * (height - 1.0), y1 = y0 + (height - 0.72) / tiers * 1.05;
    const r0 = 1.18 * (1 - f * 0.8), r1 = k === tiers - 1 ? 0 : r0 * 0.42;
    pineTier(m, y0, y1, r0, r1, shade(color, 0.92 + f * 0.2), seed * 7 + k * 13, sides);
  }
  return m.build();
}

/** Carvalho (copa larga em tufos, `plantas/temperado.png`). */
export function broadTree(seed: number, color: Rgb, lumps = 7): Float32Array {
  const m = new Model();
  const rand = sequence(seed * 31 + 5);
  limb(m, [0, 0, 0], [0, 1.2, 0], 0.34, 0.24, TRUNK, 6, 0.75, 0.95);
  limb(m, [0, 1, 0], [0.7, 1.75, 0.2], 0.17, 0.08, TRUNK, 4, 0.8, 0.8);
  limb(m, [0, 1, 0], [-0.65, 1.8, -0.2], 0.17, 0.08, TRUNK, 4, 0.8, 0.8);
  lump(m, [0, 2.05, 0], [1.15, 0.85, 1.15], color, seed * 3 + 1, { detail: 1, rough: 0.1, tone: 0.09, low: 0.58 });
  for (let k = 0; k < lumps - 1; k++) {
    const t = (k / (lumps - 1)) * Math.PI * 2 + rand() * 0.5, d = 0.75 + rand() * 0.35;
    const r = 0.5 + rand() * 0.25;
    lump(m, [Math.cos(t) * d, 1.62 + rand() * 0.75, Math.sin(t) * d], [r, r * 0.82, r], shade(color, 0.94 + rand() * 0.14), seed * 11 + k, { rough: 0.12, tone: 0.09, low: 0.52 });
  }
  return m.build();
}

/** Árvore média de copa redonda (`plantas/temperado.png`). */
export function roundTree(seed: number, color: Rgb): Float32Array {
  const m = new Model();
  limb(m, [0, 0, 0], [0, 1.25, 0], 0.22, 0.14, TRUNK, 5, 0.75, 0.95);
  lump(m, [0, 2, 0], [0.98, 1.05, 0.98], color, seed * 5 + 3, { detail: 1, rough: 0.09, tone: 0.1, low: 0.6 });
  return m.build();
}

/** Árvore de copa achatada (a da savana e do pântano na folha-mestra; acácia em `plantas/quente.png`): galhos à mostra e copa em placas. */
export function flatTree(seed: number, color: Rgb, trunk: Rgb, spread = 1.5): Float32Array {
  const m = new Model();
  const rand = sequence(seed * 17 + 9);
  const lean = (rand() - 0.5) * 0.3;
  limb(m, [0, 0, 0], [lean, 1.0, 0], 0.24, 0.15, trunk, 6, 0.72, 0.95);
  const top = 1.62;
  lump(m, [lean, top + 0.12, 0], [spread * 0.82, 0.42, spread * 0.82], color, seed * 13 + 7, { detail: 1, rough: 0.08, tone: 0.08, low: 0.5 });
  const plates = 4;
  for (let k = 0; k < plates; k++) {
    const t = (k / plates) * 6.283 + rand() * 0.6, d = spread * (0.5 + rand() * 0.22);
    const ex = lean + Math.cos(t) * d, ez = Math.sin(t) * d, ey = top - 0.1 + rand() * 0.14;
    limb(m, [lean, 0.82, 0], [ex * 0.8, ey - 0.1, ez * 0.8], 0.09, 0.05, trunk, 4, 0.85, 0.85);
    const r = spread * (0.42 + rand() * 0.14);
    lump(m, [ex, ey, ez], [r, 0.28, r], shadeOf(color, 0.96 + rand() * 0.12), seed * 29 + k, { rough: 0.1, tone: 0.08, low: 0.5 });
  }
  return m.build();
}

/** Tufo de arbustos baixos, 2–5 bolinhas (o "chão" da folha-mestra). */
export function bushClump(seed: number, color: Rgb, count = 4): Float32Array {
  const m = new Model();
  const rand = sequence(seed * 19 + 2);
  for (let k = 0; k < count; k++) {
    const t = rand() * 6.28, d = k === 0 ? 0 : 0.28 + rand() * 0.32, r = k === 0 ? 0.36 : 0.18 + rand() * 0.14;
    lump(m, [Math.cos(t) * d, r * 0.72, Math.sin(t) * d], [r, r * 0.9, r], shade(color, 0.92 + rand() * 0.2), seed * 23 + k, { rough: 0.14, tone: 0.1, low: 0.56, foot: 0 });
  }
  return m.build();
}

/** Capim: lâminas finas em touceira (`plantas/temperado.png`, "Tall Field Grass"). */
export function grassTuft(seed: number, color: Rgb, count = 7, height = 0.8): Float32Array {
  const m = new Model();
  const rand = sequence(seed * 41 + 3);
  for (let k = 0; k < count; k++) {
    const t = rand() * 6.28, lean = 0.15 + rand() * 0.35, h = height * (0.65 + rand() * 0.45), w = 0.06;
    const cx = Math.cos(t), cz = Math.sin(t);
    const c = shade(color, 0.85 + rand() * 0.3);
    m.blade([cx * 0.08 - cz * w, 0, cz * 0.08 + cx * w], [cx * 0.08 + cz * w, 0, cz * 0.08 - cx * w], [cx * lean, h, cz * lean], c, [0.7, 0.7, 1]);
  }
  return m.build();
}

/** Pedra cinza facetada. */
export function rock(seed: number, color: Rgb): Float32Array {
  const m = new Model();
  lump(m, [0, 0.2, 0], [0.62, 0.5, 0.5], color, seed * 3 + 11, { rough: 0.22, tone: 0.13, low: 0.62, foot: 0 });
  if (seed % 2 === 0) lump(m, [0.48, 0.1, 0.25], [0.3, 0.26, 0.28], color, seed * 3 + 12, { rough: 0.2, tone: 0.13, low: 0.62, foot: 0 });
  return m.build();
}

/** Cacto alto com braços (`plantas/seco-e-alagado.png`). */
export function cactus(seed: number, color: Rgb, tall = 1.9): Float32Array {
  const m = new Model();
  limb(m, [0, 0, 0], [0, tall, 0], 0.2, 0.15, color, 6, 0.72, 1);
  const sideA = seed % 2 === 0 ? 1 : -1;
  limb(m, [0, tall * 0.42, 0], [sideA * 0.42, tall * 0.48, 0], 0.09, 0.09, color, 5, 0.85, 0.9);
  limb(m, [sideA * 0.42, tall * 0.46, 0], [sideA * 0.42, tall * 0.76, 0], 0.09, 0.07, color, 5, 0.9, 1);
  limb(m, [0, tall * 0.55, 0], [-sideA * 0.36, tall * 0.6, 0.05], 0.08, 0.08, color, 5, 0.85, 0.9);
  limb(m, [-sideA * 0.36, tall * 0.58, 0.05], [-sideA * 0.36, tall * 0.88, 0.05], 0.08, 0.06, color, 5, 0.9, 1);
  return m.build();
}

/** Junco: lâminas altas, com pendão escuro em algumas. */
export function reed(seed: number, color: Rgb): Float32Array {
  const m = new Model();
  const rand = sequence(seed * 43 + 7);
  for (let k = 0; k < 7; k++) {
    const t = rand() * 6.28, h = 0.7 + rand() * 0.55, lean = 0.05 + rand() * 0.15, w = 0.05;
    const cx = Math.cos(t), cz = Math.sin(t);
    m.blade([cx * 0.1 - cz * w, 0, cz * 0.1 + cx * w], [cx * 0.1 + cz * w, 0, cz * 0.1 - cx * w], [cx * (0.1 + lean), h, cz * (0.1 + lean)], shade(color, 0.85 + rand() * 0.25), [0.7, 0.7, 1]);
  }
  return m.build();
}
