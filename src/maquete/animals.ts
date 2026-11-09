import { Biome } from '../world/biomes';
import { hash3, sequence } from './hash';
import { limb, lump, MODEL_FLOATS, Model, rgb, type Rgb, type V3 } from './models';

/**
 * Modelos dos animais: as espécies aprovadas em `docs/04-ecologia.md` e a classe mítica, com forma, proporção e cores das folhas em `animais/` e as correções do `LEIAME.md`.
 * Cada corpo é um casco facetado: um tubo de seção em polígono que segue a linha do dorso (garupa, lombo, cernelha) e outro que segue pescoço, crânio e focinho, como nas folhas.
 * A cabeça aponta para +x. 1 unidade = 1 célula fina; o humano da escala teria ~1,3.
 */
export const POSES = ['idle', 'walk1', 'walk2', 'eat', 'dead'] as const;
export type Pose = (typeof POSES)[number];
export const ANIMALS = ['rena', 'loboArtico', 'lebre', 'cervo', 'alce', 'javali', 'lobo', 'urso', 'bisao', 'antilope', 'zebra', 'elefante', 'leao', 'capivara', 'macaco', 'onca', 'jacare', 'camelo', 'cabra', 'aguia', 'cardume', 'baleia', 'cachalote', 'tubarao', 'lula', 'lulaGigante', 'dragao', 'kraken', 'baleiaBranca'] as const;
export type Animal = (typeof ANIMALS)[number];
export const SWIMMERS: ReadonlySet<Animal> = new Set(['cardume', 'baleia', 'cachalote', 'tubarao', 'lula', 'lulaGigante', 'kraken', 'baleiaBranca']);
/** Classe mítica (`docs/04-ecologia.md`): só deus as põe no mundo; nenhuma nasce sozinha. */
export const MYTHIC: ReadonlySet<Animal> = new Set(['dragao', 'kraken', 'baleiaBranca']);

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Ponto do caminho de um tubo: x, y, meia-espessura no plano do corpo, meia-largura (z). */
type Pt = readonly [number, number, number, number];
interface TubeOpts {
  sides?: number | undefined;
  belly?: Rgb | undefined;
  back?: Rgb | undefined;
  capA?: boolean | undefined;
  capB?: boolean | undefined;
  tone?: number | undefined;
  seed?: number | undefined;
  /** Divide cada trecho em tantas fatias (listras). */
  split?: number | undefined;
  /** Cor da faceta: fatia, lado, centro. */
  paint?: ((i: number, k: number, x: number, y: number, z: number, n: number) => Rgb | null) | undefined;
}

/** Casco facetado ao longo de um caminho no plano do corpo: a seção fica de pé em relação ao caminho, então serve para tronco, pescoço, cabeça, cauda e tromba. */
function tube(m: Model, path0: readonly Pt[], color: Rgb, o: TubeOpts = {}): void {
  const S = o.sides ?? 8, tone = o.tone ?? 0.05, seed = o.seed ?? 1, K = 1.04;
  let path = path0;
  if (o.split && o.split > 1) {
    const out: Pt[] = [];
    for (let i = 0; i + 1 < path0.length; i++) {
      const a = path0[i] as Pt, b = path0[i + 1] as Pt;
      for (let q = 0; q < o.split; q++) { const t = q / o.split; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]); }
    }
    out.push(path0[path0.length - 1] as Pt);
    path = out;
  }
  const n = path.length, rings: V3[][] = [], dirs: [number, number][] = [];
  // Caminho escrito da cabeça para a cauda: o lado de cima continua sendo o de cima.
  const flipUp = ((path[n - 1] as Pt)[0] < (path[0] as Pt)[0]) ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const p = path[i] as Pt, a = path[Math.max(0, i - 1)] as Pt, b = path[Math.min(n - 1, i + 1)] as Pt;
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l;
    dirs.push([tx / l, ty / l]);
    const ring: V3[] = [];
    for (let k = 0; k < S; k++) {
      const t = ((k + 0.5) / S) * 6.2832, sn = Math.sin(t) * K, cs = Math.cos(t) * K;
      ring.push([p[0] + nx * p[2] * sn, p[1] + ny * p[2] * sn, p[3] * cs]);
    }
    rings.push(ring);
  }
  const shadeK = (c: Rgb, i: number, k: number): Rgb => { const q = 1 + (hash3(seed + i * 7, k, 5) - 0.5) * 2 * tone; return [c[0] * q, c[1] * q, c[2] * q]; };
  for (let i = 0; i + 1 < n; i++) {
    const p = path[i] as Pt, q = path[i + 1] as Pt, inside: V3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0];
    const r0 = rings[i] as V3[], r1 = rings[i + 1] as V3[];
    for (let k = 0; k < S; k++) {
      const k2 = (k + 1) % S, up = Math.sin(((k + 1) / S) * 6.2832) * flipUp;
      const a = r0[k] as V3, b = r0[k2] as V3, c = r1[k2] as V3, d = r1[k] as V3;
      const cx = (a[0] + b[0] + c[0] + d[0]) / 4, cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4;
      const base = o.paint?.(i, k, cx, cy, cz, n - 1) ?? (o.belly && up < -0.45 ? o.belly : o.back && up > 0.55 ? o.back : color);
      const low = up < -0.45 ? 0.86 : 1;
      m.tri(a, b, c, shadeK(base, i, k), inside, [low, low, low]);
      m.tri(a, c, d, shadeK(base, i + 31, k), inside, [low, low, low]);
    }
  }
  const cap = (i: number, sign: number): void => {
    const p = path[i] as Pt, d = dirs[i] as [number, number], ring = rings[i] as V3[];
    const tip: V3 = [p[0] + d[0] * sign * p[2] * 0.3, p[1] + d[1] * sign * p[2] * 0.3, 0], inside: V3 = [p[0] - d[0] * sign * 0.1, p[1] - d[1] * sign * 0.1, 0];
    for (let k = 0; k < S; k++) {
      const a = ring[k] as V3, b = ring[(k + 1) % S] as V3;
      const base = o.paint?.(i === 0 ? 0 : n - 2, k, tip[0], tip[1], (a[2] + b[2]) / 2, n - 1) ?? color;
      m.tri(a, b, tip, shadeK(base, i + 53, k), inside);
    }
  };
  if (o.capA !== false) cap(0, -1);
  if (o.capB !== false) cap(n - 1, 1);
}

/** Quadrúpede: medidas tiradas das folhas. */
interface Quad {
  /** Comprimento, meia-altura e meia-largura do tronco; altura da perna até a barriga. */
  L: number; R: number; W: number; leg: number;
  /** Perfil do tronco: posição (-0,5 garupa a 0,5 peito), subida (× R), altura e largura relativas. */
  prof?: readonly (readonly [number, number, number, number])[];
  /** Pescoço: comprimento, ângulo (rad), espessura na base e no alto. */
  neck: readonly [number, number, number, number];
  /** Cabeça: comprimento, meia-altura, meia-largura, ângulo. */
  head: readonly [number, number, number, number];
  /** Perna: raio em cima e embaixo. */
  legR: readonly [number, number];
  coat: Rgb; belly?: Rgb; back?: Rgb; legs?: Rgb; hoof?: Rgb; neckColor?: Rgb; face?: Rgb; muzzle?: Rgb;
  seed: number;
  split?: number;
  paint?: TubeOpts['paint'];
  legPaint?: (y: number) => Rgb | null;
  sides?: number;
}
interface Built { m: Model; q: Quad; cy: number; top: number; hx: number; hy: number; hs: number; nx: number; ny: number; dx: number; dy: number; rear: number; neckX: number; neckY: number; eat: boolean }

let rigOut = { x: 0, y: 0, top: 0 };
const DEER: readonly (readonly [number, number, number, number])[] = [[-0.5, 0.06, 0.62, 0.6], [-0.36, 0.05, 0.98, 0.96], [-0.1, 0, 1, 1], [0.18, 0, 1.06, 1], [0.38, 0.04, 0.98, 0.92], [0.5, 0.1, 0.66, 0.62]];

/** Tronco, pernas, pescoço e cabeça. Devolve os pontos onde entram orelha, chifre, cauda e juba. */
function quadruped(q: Quad): Built {
  const m = new Model(), cy = q.leg + q.R, legs = q.legs ?? shade(q.coat, 0.84), hoof = q.hoof ?? shade(legs, 0.42);
  const neckX = q.L * 0.36, neckY = cy + q.R * 0.3;
  rigOut = { x: neckX, y: neckY, top: q.leg * 0.98 };
  // Pernas: coxa grossa, canela fina e casco.
  for (const [sx, sz] of [[0.36, 1], [0.36, -1], [-0.36, 1], [-0.36, -1]] as const) {
    const x = sx * q.L, z = sz * q.W * 0.66, front = sx > 0;
    const knee: V3 = [x + (front ? 0.03 : -0.05) * q.leg, q.leg * 0.52, z], ankle: V3 = [x + (front ? 0 : 0.03) * q.leg, q.leg * 0.11, z];
    const col = (y: number): Rgb => q.legPaint?.(y) ?? legs;
    limb(m, [x, q.leg + q.R * 0.25, z * 0.92], knee, q.legR[0], (q.legR[0] + q.legR[1]) * 0.5, col(q.leg * 0.8), 6, 0.92, 0.86);
    limb(m, knee, ankle, (q.legR[0] + q.legR[1]) * 0.5, q.legR[1], shade(col(q.leg * 0.3), 0.94), 5, 0.86, 0.78);
    // Casco reto para baixo: a sola fica rente ao chão, sem afundar.
    limb(m, ankle, [ankle[0], 0, z], q.legR[1] * 1.05, q.legR[1] * 1.25, hoof, 5, 0.74, 0.68);
  }
  const prof = q.prof ?? DEER;
  tube(m, prof.map((s) => [s[0] * q.L, cy + s[1] * q.R, s[2] * q.R, s[3] * q.W] as Pt), q.coat, { sides: q.sides ?? 8, belly: q.belly, back: q.back, seed: q.seed, split: q.split, paint: q.paint });
  // Pescoço e cabeça num casco só: base dentro do tronco, alto do pescoço, crânio, focinho e nariz.
  const [nl, na, r0, r1] = q.neck, [hl, hr, hw, ha] = q.head;
  const ca = Math.cos(na), sa = Math.sin(na), dx = Math.cos(ha), dy = Math.sin(ha);
  const tx = neckX + ca * nl, ty = neckY + sa * nl;
  const hx = tx + dx * hl * 0.2, hy = ty + dy * hl * 0.2, nx = tx + dx * hl, ny = ty + dy * hl;
  const face = q.face ?? q.neckColor ?? q.coat, muzzle = q.muzzle ?? shade(face, 0.9), neckColor = q.neckColor ?? q.coat;
  const path: Pt[] = [[neckX - ca * r0 * 0.5, neckY - sa * r0 * 0.5, r0, r0 * 0.82], [neckX + ca * nl * 0.5, neckY + sa * nl * 0.5, (r0 + r1) * 0.5, (r0 + r1) * 0.42], [tx - dx * hl * 0.05, ty - dy * hl * 0.05, Math.max(r1, hr * 0.92), Math.max(r1 * 0.82, hw * 0.9)], [hx + dx * hl * 0.06, hy + dy * hl * 0.06, hr, hw], [tx + dx * hl * 0.62, ty + dy * hl * 0.62 - hr * 0.1, hr * 0.62, hw * 0.62], [nx, ny - hr * 0.14, hr * 0.42, hw * 0.44]];
  const split = q.split ?? 1;
  tube(m, path, neckColor, { sides: q.sides ?? 8, seed: q.seed + 9, split: q.split, capA: false, belly: q.belly && !q.neckColor ? q.belly : undefined, paint: (i, k, x, y, z, n) => q.paint?.(i + 100, k, x, y, z, n) ?? (i >= 4 * split ? muzzle : i >= 2 * split ? face : null) });
  // Olhos: duas facetas escuras.
  const eye = shade(q.coat, 0.12);
  for (const s of [1, -1]) {
    const ex = hx + dx * hl * 0.2, ey = hy + dy * hl * 0.2 + hr * 0.3, ez = s * hw * 0.93;
    m.tri([ex - hr * 0.16, ey, ez], [ex + hr * 0.16, ey + hr * 0.06, ez * 0.98], [ex, ey + hr * 0.2, ez * 0.92], eye, [hx, hy, 0]);
  }
  return { m, q, cy, top: cy + q.R, hx, hy, hs: hl * 0.8, nx, ny, dx, dy, rear: -q.L * 0.5, neckX, neckY, eat: false };
}

function ear(m: Model, x: number, y: number, z: number, l: number, color: Rgb, w = 0.42): void {
  const s = Math.sign(z) || 1;
  m.blade([x - l * w, y, z - s * l * 0.1], [x + l * w * 0.6, y, z + s * l * 0.16], [x - l * 0.2, y + l, z + s * l * 0.34], color);
}
function earsOn(k: Built, l: number, color: Rgb, w = 0.42, tip?: Rgb): void {
  const q = k.q, y = k.hy + q.head[1] * 0.74, x = k.hx - q.head[0] * 0.08;
  for (const s of [1, -1]) {
    ear(k.m, x, y, s * q.head[2] * 0.72, l, color, w);
    if (tip) k.m.blade([x - l * 0.3, y + l * 0.72, s * (q.head[2] * 0.72 + l * 0.24)], [x - l * 0.08, y + l * 0.72, s * (q.head[2] * 0.72 + l * 0.3)], [x - l * 0.2, y + l * 1.04, s * (q.head[2] * 0.72 + l * 0.36)], tip);
  }
}
/** Cauda: um casco fino que sai da garupa. `curl` sobe a ponta (macaco). */
function tail(k: Built, y: number, len: number, droop: number, r: number, color: Rgb, tip?: Rgb, curl = 0): void {
  const x0 = k.rear + 0.04, path: Pt[] = [];
  const steps = curl ? 6 : 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = curl * t * t * 3.6;
    path.push([x0 - len * t * (curl ? Math.cos(a * 0.5) : 1), y - droop * t + (curl ? Math.sin(a) * len * 0.42 * t : 0), r * (1 - t * 0.55), r * (1 - t * 0.55)]);
  }
  tube(k.m, path, color, { sides: 5, seed: 77, tone: 0.04 });
  const end = path[path.length - 1] as Pt;
  if (tip) lump(k.m, [end[0], end[1], 0], [r * 1.9, r * 2.2, r * 1.9], tip, 3, { rough: 0.08, low: 0.9 });
}
/** Galhada: haste principal para trás e para fora, com pontas para cima (cervo, rena). */
function antlers(k: Built, size: number, color: Rgb, tines: number, spread = 0.5): void {
  const q = k.q, y = k.hy + q.head[1] * 0.8, x = k.hx - q.head[0] * 0.1;
  for (const s of [1, -1]) {
    const z0 = s * q.head[2] * 0.5;
    const a: V3 = [x - size * 0.16, y + size * 0.42, z0 + s * size * spread * 0.5], b: V3 = [x - size * 0.2, y + size * 0.86, z0 + s * size * spread], c: V3 = [x + size * 0.08, y + size * 1.22, z0 + s * size * spread * 0.86];
    limb(k.m, [x, y - 0.02, z0], a, size * 0.06, size * 0.05, color, 4, 1, 1);
    limb(k.m, a, b, size * 0.05, size * 0.04, color, 4, 1, 1);
    limb(k.m, b, c, size * 0.04, size * 0.015, color, 4, 1, 1);
    // Ponta da frente, perto da testa.
    limb(k.m, [x - size * 0.04, y + size * 0.12, z0 + s * size * 0.08], [x + size * 0.34, y + size * 0.3, z0 + s * size * 0.2], size * 0.04, size * 0.012, color, 3, 1, 1);
    for (let t = 0; t < tines; t++) {
      const u = (t + 0.6) / (tines + 0.4), px = a[0] + (b[0] - a[0]) * u, py = a[1] + (b[1] - a[1]) * u, pz = a[2] + (b[2] - a[2]) * u;
      limb(k.m, [px, py, pz], [px + size * (0.16 + t * 0.03), py + size * 0.34, pz + s * size * 0.06], size * 0.035, size * 0.01, color, 3, 1, 1);
    }
  }
}
/** Galhada do alce: haste curta e pá larga, com pontas na borda (`animais/floresta-1.png`). */
function palmate(k: Built, size: number, color: Rgb): void {
  const q = k.q, y = k.hy + q.head[1] * 0.8, x = k.hx - q.head[0] * 0.08;
  for (const s of [1, -1]) {
    const z0 = s * q.head[2] * 0.5, root: V3 = [x - size * 0.04, y + size * 0.16, z0 + s * size * 0.3];
    limb(k.m, [x, y - 0.02, z0], root, size * 0.07, size * 0.07, color, 4, 1, 1);
    // A pá: um leque de triângulos de duas faces, com a borda em pontas.
    const rim: V3[] = [];
    for (let t = 0; t <= 5; t++) {
      const a = -0.5 + t * 0.52, r = size * (0.62 + (t % 2) * 0.2);
      rim.push([root[0] + Math.sin(a) * r * 0.7 - size * 0.08, root[1] + Math.cos(a) * r * 0.62, root[2] + s * (size * 0.3 + Math.abs(Math.sin(a + 0.5)) * size * 0.34)]);
    }
    for (let t = 0; t + 1 < rim.length; t++) k.m.blade(root, rim[t] as V3, rim[t + 1] as V3, shade(color, 0.94 + (t % 2) * 0.1));
  }
}
/** Chifre em arco: pontos ao longo de uma curva para cima e para trás. `curl` fecha o arco (cabra-montesa). */
function horns(k: Built, size: number, color: Rgb, curl: number, out = 0.3, r = 0.06): void {
  const q = k.q, y = k.hy + q.head[1] * 0.78, x = k.hx - q.head[0] * 0.06;
  for (const s of [1, -1]) {
    let prev: V3 = [x, y - 0.02, s * q.head[2] * 0.45];
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, a = t * curl;
      const p: V3 = [x - Math.sin(a) * size * 0.75 + (curl < 0.4 ? size * 0.05 * t : 0), y + (curl < 0.4 ? t * size : Math.sin(Math.min(1.5708, a) + 0.0001) * size * 0.9 - Math.max(0, a - 1.5708) * size * 0.5), s * (q.head[2] * 0.45 + out * size * Math.sin(t * 2.6))];
      limb(k.m, prev, p, size * r * (1.1 - t * 0.75), size * r * (1.1 - (t + 1 / steps) * 0.85), i % 2 ? color : shade(color, 0.88), 4, 1, 1);
      prev = p;
    }
  }
}

/** Morto: deitado de lado no chão. */
function lieDown(data: Float32Array): Float32Array {
  const out = new Float32Array(data), c = Math.cos(1.45), s = Math.sin(1.45);
  let low = Infinity;
  for (let o = 0; o < out.length; o += MODEL_FLOATS) {
    const y = out[o + 1] as number, z = out[o + 2] as number, ny = out[o + 4] as number, nz = out[o + 5] as number;
    out[o + 1] = c * y - s * z; out[o + 2] = s * y + c * z;
    out[o + 4] = c * ny - s * nz; out[o + 5] = s * ny + c * nz;
    low = Math.min(low, out[o + 1] as number);
  }
  for (let o = 0; o < out.length; o += MODEL_FLOATS) { out[o + 1] = (out[o + 1] as number) - low + 0.02; out[o + 9] = (out[o + 9] as number) * 0.94; }
  return out;
}

function fin(m: Model, a: V3, b: V3, c: V3, color: Rgb): void { m.blade(a, b, c, color); }

/** Nadador: casco em fuso, com a barriga clara. `rings`: posição (× len) e raio (× r, × w). */
function swimmer(m: Model, len: number, r: number, w: number, rings: readonly (readonly [number, number, number])[], color: Rgb, belly: Rgb, seed: number, paint?: TubeOpts['paint']): void {
  tube(m, rings.map((q) => [q[0] * len, 0, q[1] * r, q[2] * w] as Pt), color, { sides: 8, belly, seed, tone: 0.045, paint });
}
function flukes(m: Model, x: number, span: number, len: number, color: Rgb): void {
  for (const s of [1, -1]) {
    fin(m, [x + len * 0.3, 0, 0], [x - len, 0.03, s * span], [x - len * 0.45, 0, s * span * 0.1], color);
    fin(m, [x + len * 0.3, 0, 0], [x - len * 0.2, 0.03, s * span * 0.55], [x - len, 0.03, s * span], shade(color, 0.92));
  }
}

/** Lula: manto em fuso com as barbatanas na ponta, olhos, oito braços e dois tentáculos longos (`animais/mar.png`). */
function squid(m: Model, len: number, r: number, color: Rgb, seed: number, limp = false): void {
  const rand = sequence(seed), pale = shade(color, 1.18);
  tube(m, [[-len * 1.0, 0, r * 0.12, r * 0.12], [-len * 0.8, 0, r * 0.62, r * 0.62], [-len * 0.4, 0, r, r], [0, 0, r * 0.9, r * 0.9], [len * 0.18, 0, r * 0.6, r * 0.6], [len * 0.36, 0, r * 0.66, r * 0.7]], color, { sides: 7, seed, belly: pale, tone: 0.06 });
  for (const s of [1, -1]) {
    fin(m, [-len * 1.0, 0, 0], [-len * 0.72, 0, s * r * 1.9], [-len * 0.5, 0, s * r * 0.8], shade(color, 0.9));
    m.tri([len * 0.26, r * 0.3, s * r * 0.66], [len * 0.36, r * 0.36, s * r * 0.68], [len * 0.3, r * 0.52, s * r * 0.6], rgb(20, 16, 20), [len * 0.3, 0, 0]);
  }
  for (let k = 0; k < 10; k++) {
    const long = k >= 8, a = (k / (long ? 2 : 8)) * 6.283 + (long ? 1.57 : 0.3), l = len * (long ? 1.9 : 0.8 + rand() * 0.4), th = r * (long ? 0.09 : 0.14);
    const sy = Math.sin(a), sz = Math.cos(a), wave = limp ? (rand() - 0.5) * 1.2 : 0;
    const path: V3[] = [[len * 0.34, sy * r * 0.34, sz * r * 0.34], [len * 0.34 + l * 0.4, sy * r * (0.8 + wave), sz * r * (0.9 + wave)], [len * 0.34 + l * 0.75, sy * r * (1.0 - wave), sz * r * (1.3 + wave)], [len * 0.34 + l, sy * r * 0.7, sz * r * 1.1]];
    for (let i = 0; i + 1 < path.length; i++) limb(m, path[i] as V3, path[i + 1] as V3, th * (1 - i * 0.26), th * (1 - (i + 1) * 0.26), i % 2 ? pale : color, 4, 0.95, 0.95);
    if (long) lump(m, path[3] as V3, [r * 0.34, r * 0.14, r * 0.2], pale, seed + k, { rough: 0.04, low: 0.9 });
  }
}

/** Tudo o que fica abaixo da linha da água puxa para o azul: o bicho é visto dentro do mar (`animais/mar.png`). */
function underwater(data: Float32Array, lift: number): Float32Array {
  const sea: Rgb = rgb(40, 104, 168);
  for (let o = 0; o < data.length; o += MODEL_FLOATS) {
    data[o + 1] = (data[o + 1] as number) + lift;
    const t = Math.max(0, Math.min(0.5, (0.06 - (data[o + 1] as number)) * 1.1));
    data[o + 6] = (data[o + 6] as number) + (sea[0] - (data[o + 6] as number)) * t;
    data[o + 7] = (data[o + 7] as number) + (sea[1] - (data[o + 7] as number)) * t;
    data[o + 8] = (data[o + 8] as number) + (sea[2] - (data[o + 8] as number)) * t;
  }
  return data;
}

function build(a: Animal, pose: Pose): Float32Array {
  rigOut = { x: 0, y: 0, top: 0 };
  let data: Float32Array;
  switch (a) {
    case 'rena': {
      // `animais/frio.png`: corpo castanho-escuro, pescoço e peito creme, galhada alta.
      const cream = rgb(214, 204, 178);
      const k = quadruped({ L: 1.3, R: 0.34, W: 0.26, leg: 0.64, neck: [0.46, 0.85, 0.24, 0.16], head: [0.44, 0.14, 0.11, -0.22], legR: [0.085, 0.045], coat: rgb(98, 72, 52), belly: rgb(84, 62, 46), legs: rgb(82, 60, 46), neckColor: cream, face: rgb(110, 82, 60), muzzle: rgb(70, 52, 42), seed: 11, paint: (i, _k, x) => (i < 100 && x > 0.3 ? cream : null) });
      earsOn(k, 0.15, rgb(98, 72, 52)); antlers(k, 0.72, rgb(176, 150, 112), 3, 0.62); tail(k, k.cy + 0.16, 0.14, 0.06, 0.07, cream);
      data = k.m.build(); break;
    }
    case 'loboArtico': case 'lobo': {
      // `animais/frio.png` e `floresta-2.png`: focinho comprido, orelhas em pé, cauda cheia e baixa. O lobo tem o dorso escuro e a barriga clara.
      const arctic = a === 'loboArtico', coat = arctic ? rgb(232, 236, 240) : rgb(120, 108, 98);
      const k = quadruped({ L: 1.08, R: 0.22, W: 0.17, leg: 0.48, prof: [[-0.5, 0.08, 0.6, 0.6], [-0.36, 0.06, 0.92, 0.92], [-0.1, -0.02, 0.9, 0.94], [0.2, 0, 1.08, 1.04], [0.4, 0.06, 1.0, 0.94], [0.5, 0.12, 0.7, 0.66]], neck: [0.26, 0.55, 0.2, 0.15], head: [0.42, 0.13, 0.115, -0.08], legR: [0.07, 0.04], coat, belly: arctic ? rgb(246, 248, 250) : rgb(184, 166, 146), back: arctic ? rgb(216, 222, 230) : rgb(62, 56, 56), legs: arctic ? rgb(224, 228, 234) : rgb(168, 150, 130), face: arctic ? coat : rgb(104, 94, 88), muzzle: arctic ? rgb(240, 242, 246) : rgb(196, 180, 160), hoof: arctic ? rgb(200, 204, 212) : rgb(70, 62, 58), seed: arctic ? 13 : 21 });
      earsOn(k, 0.17, arctic ? rgb(214, 220, 228) : rgb(58, 52, 52), 0.36);
      k.m.tri([k.nx + 0.02, k.ny - 0.01, 0.03], [k.nx + 0.02, k.ny - 0.01, -0.03], [k.nx + 0.05, k.ny + 0.03, 0], rgb(30, 28, 30), [k.hx, k.hy, 0]);
      tail(k, k.cy + 0.08, 0.5, 0.34, 0.1, arctic ? rgb(226, 230, 236) : rgb(92, 84, 78), undefined);
      data = k.m.build(); break;
    }
    case 'lebre': {
      // `animais/frio.png`: branca, sentada sobre as patas de trás, orelhas compridas de ponta preta.
      const white = rgb(236, 236, 232);
      const k = quadruped({ L: 0.5, R: 0.17, W: 0.14, leg: 0.1, prof: [[-0.5, 0.1, 0.7, 0.8], [-0.3, 0.2, 1.2, 1.1], [0, 0.1, 1.0, 1.0], [0.3, 0.05, 0.86, 0.86], [0.5, 0.1, 0.6, 0.6]], neck: [0.1, 1.0, 0.13, 0.11], head: [0.2, 0.1, 0.085, 0.0], legR: [0.045, 0.03], coat: white, belly: rgb(248, 248, 246), legs: rgb(226, 226, 222), hoof: rgb(214, 212, 206), seed: 15 });
      earsOn(k, 0.3, rgb(228, 226, 220), 0.22, rgb(40, 36, 36));
      lump(k.m, [k.rear - 0.01, k.cy + 0.02, 0], [0.06, 0.06, 0.06], rgb(252, 252, 252), 5, { rough: 0.05, low: 0.92 });
      data = k.m.build(); break;
    }
    case 'cervo': {
      // `animais/floresta-1.png`: castanho-alaranjado, barriga e garupa creme, galhada de várias pontas.
      const cream = rgb(232, 214, 182);
      const k = quadruped({ L: 1.22, R: 0.29, W: 0.22, leg: 0.74, neck: [0.56, 1.0, 0.19, 0.12], head: [0.38, 0.115, 0.09, -0.2], legR: [0.075, 0.036], coat: rgb(198, 112, 58), belly: cream, legs: rgb(168, 96, 54), hoof: rgb(60, 44, 36), face: rgb(190, 108, 58), muzzle: rgb(96, 62, 44), seed: 17, paint: (i, _k, x, y) => (i < 100 && x < -0.52 && y > 0.8 ? cream : null) });
      earsOn(k, 0.16, rgb(180, 100, 54)); antlers(k, 0.6, rgb(156, 122, 84), 2, 0.46); tail(k, k.cy + 0.14, 0.12, 0.08, 0.06, cream);
      data = k.m.build(); break;
    }
    case 'alce': {
      // `animais/floresta-1.png`: grande, cernelha alta, focinho comprido e caído, pernas mais claras, galhada em pá.
      const k = quadruped({ L: 1.62, R: 0.44, W: 0.32, leg: 0.94, prof: [[-0.5, -0.02, 0.6, 0.6], [-0.36, -0.02, 0.9, 0.94], [-0.1, 0, 0.96, 1], [0.18, 0.12, 1.16, 1.04], [0.38, 0.2, 1.06, 0.92], [0.5, 0.2, 0.7, 0.62]], neck: [0.42, 0.42, 0.3, 0.22], head: [0.7, 0.17, 0.13, -0.42], legR: [0.11, 0.055], coat: rgb(86, 60, 46), legs: rgb(140, 110, 88), hoof: rgb(50, 38, 32), muzzle: rgb(110, 84, 68), seed: 19 });
      earsOn(k, 0.17, rgb(86, 60, 46)); palmate(k, 0.7, rgb(170, 138, 100)); tail(k, k.cy + 0.1, 0.08, 0.05, 0.05, rgb(86, 60, 46));
      // Barbela debaixo do queixo.
      lump(k.m, [k.hx + 0.12, k.hy - 0.3, 0], [0.09, 0.16, 0.06], rgb(70, 50, 40), 6, { rough: 0.05, low: 0.86 });
      data = k.m.build(); break;
    }
    case 'javali': {
      // `animais/floresta-1.png`: cunha baixa, ombro alto, crina de cerdas no dorso, presas brancas.
      const k = quadruped({ L: 0.95, R: 0.31, W: 0.24, leg: 0.27, prof: [[-0.5, -0.06, 0.56, 0.6], [-0.34, -0.04, 0.86, 0.92], [-0.05, 0.02, 1.0, 1], [0.22, 0.1, 1.12, 1.02], [0.42, 0.06, 1.0, 0.92], [0.5, 0, 0.8, 0.76]], neck: [0.1, -0.1, 0.28, 0.24], head: [0.5, 0.21, 0.16, -0.16], legR: [0.075, 0.04], coat: rgb(92, 78, 70), back: rgb(52, 44, 42), belly: rgb(104, 90, 80), legs: rgb(58, 50, 46), muzzle: rgb(120, 100, 88), seed: 23 });
      earsOn(k, 0.11, rgb(58, 50, 46), 0.5);
      for (const s of [1, -1]) limb(k.m, [k.nx - 0.12, k.ny - 0.06, s * 0.07], [k.nx - 0.02, k.ny + 0.1, s * 0.11], 0.024, 0.006, rgb(244, 240, 226), 3);
      for (let i = 0; i < 6; i++) { const x = -0.36 + i * 0.16; k.m.blade([x - 0.07, k.top + 0.0, 0.02], [x + 0.07, k.top + 0.0, -0.02], [x - 0.02, k.top + 0.13, 0], rgb(44, 38, 36)); }
      tail(k, k.cy + 0.06, 0.16, 0.1, 0.03, rgb(58, 50, 46));
      data = k.m.build(); break;
    }
    case 'urso': {
      // `animais/floresta-2.png`: corpo pesado, pernas grossas, cabeça larga com focinho claro e orelhas redondas.
      const k = quadruped({ L: 1.35, R: 0.5, W: 0.42, leg: 0.4, prof: [[-0.5, -0.04, 0.66, 0.7], [-0.34, 0, 1.0, 1], [-0.05, 0.02, 1.02, 1.02], [0.2, 0.08, 1.06, 1], [0.4, 0.04, 0.94, 0.9], [0.5, 0, 0.72, 0.7]], neck: [0.2, 0.2, 0.4, 0.34], head: [0.56, 0.25, 0.24, -0.18], legR: [0.19, 0.15], coat: rgb(108, 70, 46), back: rgb(96, 62, 42), belly: rgb(92, 60, 40), legs: rgb(86, 56, 38), hoof: rgb(48, 34, 28), muzzle: rgb(164, 124, 88), seed: 27 });
      for (const s of [1, -1]) lump(k.m, [k.hx - 0.06, k.hy + 0.24, s * 0.2], [0.07, 0.08, 0.05], rgb(80, 52, 36), 4, { rough: 0.05, low: 0.9 });
      k.m.tri([k.nx + 0.01, k.ny - 0.03, 0.05], [k.nx + 0.01, k.ny - 0.03, -0.05], [k.nx + 0.05, k.ny + 0.04, 0], rgb(30, 24, 22), [k.hx, k.hy, 0]);
      data = k.m.build(); break;
    }
    case 'bisao': {
      // `animais/campo-savana.png`: corcova alta, frente escura e peluda, garupa mais clara e baixa, cabeça baixa, chifres curtos.
      const dark = rgb(66, 42, 30), rear = rgb(118, 78, 50);
      const k = quadruped({ L: 1.55, R: 0.44, W: 0.36, leg: 0.46, prof: [[-0.5, -0.1, 0.56, 0.6], [-0.36, -0.08, 0.82, 0.86], [-0.1, 0.02, 0.94, 0.96], [0.14, 0.3, 1.34, 1.06], [0.36, 0.3, 1.3, 1.04], [0.5, 0.12, 0.96, 0.86]], neck: [0.14, -0.5, 0.42, 0.34], head: [0.5, 0.25, 0.2, -0.62], legR: [0.11, 0.06], coat: rear, legs: rgb(56, 38, 30), neckColor: dark, face: dark, muzzle: rgb(44, 30, 24), seed: 29, paint: (i, _k, x) => (i < 100 && x > 0.1 ? dark : null) });
      horns(k, 0.22, rgb(222, 212, 190), 0.3, 0.9, 0.12);
      lump(k.m, [k.hx + 0.1, k.hy - 0.34, 0], [0.11, 0.2, 0.09], rgb(40, 28, 22), 7, { rough: 0.08, low: 0.84 });
      tail(k, k.cy + 0.02, 0.26, 0.34, 0.035, rgb(60, 42, 32), rgb(44, 30, 24));
      data = k.m.build(); break;
    }
    case 'antilope': {
      // `animais/campo-savana.png`: fino, pernas longas, dorso alaranjado, barriga branca, chifres compridos em lira.
      const k = quadruped({ L: 0.98, R: 0.21, W: 0.16, leg: 0.68, neck: [0.42, 1.05, 0.14, 0.09], head: [0.3, 0.095, 0.075, -0.2], legR: [0.055, 0.028], coat: rgb(196, 114, 62), belly: rgb(242, 232, 214), legs: rgb(204, 140, 90), hoof: rgb(48, 38, 34), muzzle: rgb(240, 228, 210), seed: 31 });
      earsOn(k, 0.13, rgb(196, 114, 62)); horns(k, 0.62, rgb(58, 46, 40), 0.36, 0.42, 0.045); tail(k, k.cy + 0.08, 0.14, 0.12, 0.03, rgb(54, 42, 36));
      data = k.m.build(); break;
    }
    case 'zebra': {
      // `animais/campo-savana.png`: listras de verdade, em fatias do corpo, do pescoço e das pernas; crina curta e focinho preto.
      const white = rgb(240, 240, 236), black = rgb(32, 32, 36);
      const stripe = (i: number): Rgb => (i % 2 ? black : white);
      const k = quadruped({ L: 1.2, R: 0.32, W: 0.23, leg: 0.62, neck: [0.5, 0.85, 0.21, 0.15], head: [0.44, 0.14, 0.105, -0.36], legR: [0.08, 0.042], coat: white, legs: white, hoof: black, muzzle: black, seed: 33, split: 4, paint: (i) => (i >= 100 ? (i - 100 >= 16 ? null : stripe(i - 100)) : stripe(i)), legPaint: (y) => (Math.floor(y * 14) % 2 ? black : white) });
      earsOn(k, 0.14, white, 0.4, black);
      // Crina em pé ao longo do pescoço, listrada.
      for (let i = 0; i < 6; i++) { const t = i / 6, x = k.neckX + (k.hx - k.neckX) * t - 0.1, y = k.neckY + (k.hy - k.neckY) * t + 0.16; k.m.blade([x - 0.05, y, 0.015], [x + 0.06, y + 0.05, -0.015], [x - 0.03, y + 0.15, 0], i % 2 ? black : white); }
      tail(k, k.cy + 0.1, 0.36, 0.34, 0.035, white, black);
      data = k.m.build(); break;
    }
    case 'elefante': {
      // `animais/campo-savana.png` e `campo-savana-2.png`: corpo alto, pernas em coluna, orelhas grandes, tromba até o chão e presas.
      const gray = rgb(144, 138, 130);
      const k = quadruped({ L: 2.15, R: 0.82, W: 0.66, leg: 1.0, prof: [[-0.5, -0.16, 0.66, 0.7], [-0.38, -0.04, 0.96, 0.98], [-0.1, 0.06, 1.04, 1.02], [0.2, 0.04, 1.02, 1], [0.4, -0.02, 0.92, 0.9], [0.5, -0.06, 0.74, 0.74]], neck: [0.2, 0.3, 0.62, 0.52], head: [0.72, 0.5, 0.4, -0.4], legR: [0.27, 0.24], coat: gray, belly: rgb(128, 122, 116), legs: rgb(132, 126, 120), hoof: rgb(196, 190, 176), muzzle: gray, face: gray, seed: 35 });
      const hx = k.hx, hy = k.hy;
      // Orelhas: placas grandes, abertas para os lados e para trás.
      for (const s of [1, -1]) {
        const top: V3 = [hx - 0.1, hy + 0.42, s * 0.36], back: V3 = [hx - 0.62, hy + 0.3, s * 0.92], low: V3 = [hx - 0.46, hy - 0.5, s * 0.8], front: V3 = [hx - 0.04, hy - 0.2, s * 0.42];
        k.m.blade(top, back, low, shade(gray, 0.92)); k.m.blade(top, low, front, shade(gray, 0.98));
      }
      // Tromba: desce da testa até perto do chão, com a ponta virada.
      tube(k.m, [[k.nx - 0.14, k.ny + 0.02, 0.2, 0.19], [k.nx + 0.1, k.ny - 0.3, 0.15, 0.15], [k.nx + 0.16, k.ny - 0.78, 0.12, 0.12], [k.nx + 0.12, Math.max(0.3, k.ny - 1.2), 0.095, 0.095], [k.nx + 0.2, 0.12, 0.08, 0.08]], gray, { sides: 6, seed: 36, capA: false });
      for (const s of [1, -1]) { limb(k.m, [k.nx - 0.12, k.ny - 0.18, s * 0.2], [k.nx + 0.22, k.ny - 0.42, s * 0.26], 0.06, 0.04, rgb(244, 240, 226), 5); limb(k.m, [k.nx + 0.22, k.ny - 0.42, s * 0.26], [k.nx + 0.5, k.ny - 0.34, s * 0.24], 0.04, 0.012, rgb(244, 240, 226), 5); }
      tail(k, k.cy + 0.3, 0.2, 0.9, 0.04, gray, rgb(70, 66, 62));
      data = k.m.build(); break;
    }
    case 'leao': {
      // `animais/campo-savana.png`: corpo dourado e liso, juba grande e angulosa em volta da cabeça até o peito, cauda com tufo.
      const tan = rgb(216, 166, 94), mane = rgb(132, 80, 42);
      const k = quadruped({ L: 1.25, R: 0.3, W: 0.23, leg: 0.46, prof: [[-0.5, 0, 0.62, 0.62], [-0.36, 0, 0.94, 0.94], [-0.1, -0.04, 0.9, 0.94], [0.2, 0, 1.06, 1.04], [0.4, 0.04, 1.02, 0.96], [0.5, 0.08, 0.76, 0.7]], neck: [0.26, 0.5, 0.26, 0.2], head: [0.42, 0.18, 0.17, -0.06], legR: [0.095, 0.055], coat: tan, belly: rgb(232, 196, 136), legs: rgb(206, 158, 90), hoof: rgb(184, 138, 80), muzzle: rgb(236, 208, 160), seed: 37 });
      lump(k.m, [k.hx - 0.12, k.hy - 0.06, 0], [0.34, 0.42, 0.38], mane, 7, { rough: 0.12, tone: 0.12, low: 0.78 });
      lump(k.m, [k.neckX + 0.06, k.neckY - 0.2, 0], [0.26, 0.34, 0.3], shade(mane, 0.9), 8, { rough: 0.12, tone: 0.1, low: 0.76 });
      // A cara por cima da juba.
      tube(k.m, [[k.hx - 0.02, k.hy, 0.18, 0.17], [k.hx + 0.16, k.hy - 0.03, 0.15, 0.14], [k.nx, k.ny - 0.03, 0.09, 0.09]], tan, { sides: 7, seed: 38, paint: (i) => (i >= 1 ? rgb(236, 208, 160) : null) });
      for (const s of [1, -1]) { lump(k.m, [k.hx - 0.02, k.hy + 0.2, s * 0.15], [0.05, 0.06, 0.04], tan, 9, { rough: 0.04, low: 0.92 }); k.m.tri([k.hx + 0.12, k.hy + 0.07, s * 0.15], [k.hx + 0.18, k.hy + 0.08, s * 0.14], [k.hx + 0.15, k.hy + 0.11, s * 0.13], rgb(30, 22, 18), [k.hx, k.hy, 0]); }
      k.m.tri([k.nx + 0.01, k.ny, 0.04], [k.nx + 0.01, k.ny, -0.04], [k.nx + 0.04, k.ny + 0.05, 0], rgb(60, 36, 30), [k.hx, k.hy, 0]);
      tail(k, k.cy + 0.1, 0.55, 0.3, 0.035, tan, rgb(96, 60, 34));
      data = k.m.build(); break;
    }
    case 'capivara': {
      // `animais/tropical-pantano.png`: barril castanho, cabeça quadrada e alta, orelhas pequenas, sem cauda.
      const k = quadruped({ L: 0.86, R: 0.3, W: 0.25, leg: 0.2, prof: [[-0.5, -0.04, 0.7, 0.74], [-0.34, 0.02, 1.02, 1], [-0.05, 0.04, 1.06, 1.04], [0.22, 0, 1.0, 1], [0.42, -0.02, 0.9, 0.9], [0.5, -0.02, 0.76, 0.76]], neck: [0.08, 0.2, 0.28, 0.25], head: [0.44, 0.2, 0.17, 0.02], legR: [0.07, 0.045], coat: rgb(166, 108, 62), belly: rgb(150, 98, 58), legs: rgb(122, 80, 50), hoof: rgb(70, 50, 38), muzzle: rgb(140, 92, 56), seed: 39 });
      // Focinho rombudo: a ponta não afina.
      lump(k.m, [k.nx - 0.07, k.ny + 0.03, 0], [0.12, 0.15, 0.13], rgb(146, 96, 58), 5, { rough: 0.04, tone: 0.05, low: 0.86 });
      earsOn(k, 0.07, rgb(110, 72, 46), 0.5);
      data = k.m.build(); break;
    }
    case 'macaco': {
      // `animais/tropical-pantano.png`: macaco-prego: castanho-escuro, cara e peito creme, cauda comprida e enrolada.
      const dark = rgb(82, 54, 38), cream = rgb(230, 210, 182);
      const k = quadruped({ L: 0.52, R: 0.17, W: 0.14, leg: 0.36, prof: [[-0.5, 0, 0.7, 0.7], [-0.3, 0.02, 1.0, 1], [0, 0.04, 1.0, 1], [0.3, 0.1, 1.0, 1], [0.5, 0.16, 0.74, 0.7]], neck: [0.1, 0.9, 0.13, 0.12], head: [0.22, 0.14, 0.125, -0.12], legR: [0.05, 0.034], coat: dark, belly: rgb(104, 72, 52), legs: dark, hoof: rgb(50, 34, 26), face: cream, muzzle: cream, seed: 41, paint: (i, _k, x, y) => (i < 100 && x > 0.2 && y < 0.5 ? cream : null) });
      // Topete escuro em cima da cara clara.
      lump(k.m, [k.hx - 0.05, k.hy + 0.08, 0], [0.13, 0.11, 0.135], dark, 4, { rough: 0.05, low: 0.9 });
      for (const s of [1, -1]) lump(k.m, [k.hx - 0.02, k.hy + 0.02, s * 0.13], [0.03, 0.045, 0.02], cream, 6, { rough: 0.03, low: 0.92 });
      tail(k, k.cy + 0.06, 0.62, 0.02, 0.035, dark, undefined, 1);
      data = k.m.build(); break;
    }
    case 'onca': {
      // `animais/tropical-pantano.png`: dourada com rosetas escuras, barriga creme, cabeça larga, cauda comprida com anéis.
      const gold = rgb(226, 170, 76), spot = rgb(46, 32, 26);
      const spots = (i: number, k: number, x: number, y: number, z: number): Rgb | null => (y > 0.36 && hash3(Math.round(x * 31) + i * 3, k, Math.round(z * 17) + 5) < 0.2 ? spot : null);
      const k = quadruped({ L: 1.15, R: 0.25, W: 0.2, leg: 0.4, prof: [[-0.5, 0, 0.62, 0.62], [-0.36, 0, 0.96, 0.96], [-0.1, -0.04, 0.92, 0.96], [0.2, 0, 1.04, 1.04], [0.4, 0.04, 1.0, 0.96], [0.5, 0.08, 0.76, 0.7]], neck: [0.2, 0.42, 0.22, 0.18], head: [0.38, 0.17, 0.16, -0.1], legR: [0.085, 0.05], coat: gold, belly: rgb(244, 232, 204), legs: gold, hoof: rgb(196, 150, 80), muzzle: rgb(244, 232, 204), seed: 43, split: 3, sides: 10, paint: (i, kk, x, y, z) => (i >= 100 ? (i - 100 >= 12 ? null : spots(i, kk, x, y, z)) : spots(i, kk, x, y, z)), legPaint: (y) => (Math.floor(y * 11) % 3 === 1 ? spot : null) });
      earsOn(k, 0.08, rgb(60, 44, 34), 0.5);
      k.m.tri([k.nx + 0.01, k.ny, 0.035], [k.nx + 0.01, k.ny, -0.035], [k.nx + 0.035, k.ny + 0.045, 0], rgb(70, 40, 36), [k.hx, k.hy, 0]);
      // Cauda com anéis.
      const tp: Pt[] = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; tp.push([k.rear + 0.04 - t * 0.62, k.cy + 0.08 - t * 0.3 + t * t * 0.22, 0.045 * (1 - t * 0.4), 0.045 * (1 - t * 0.4)]); }
      tube(k.m, tp, gold, { sides: 5, seed: 44, paint: (i) => (i % 2 || i >= 7 ? spot : null) });
      data = k.m.build(); break;
    }
    case 'jacare': {
      // `animais/tropical-pantano.png`: baixo e comprido, verde com a barriga clara, focinho longo e chato, cauda com crista.
      const green = rgb(70, 128, 62), pale = rgb(150, 176, 110), m = new Model();
      tube(m, [[-1.75, 0.1, 0.03, 0.03], [-1.2, 0.13, 0.1, 0.09], [-0.7, 0.17, 0.16, 0.2], [-0.2, 0.19, 0.18, 0.3], [0.3, 0.19, 0.17, 0.28], [0.6, 0.18, 0.14, 0.2], [0.85, 0.17, 0.11, 0.17], [1.2, 0.14, 0.07, 0.12], [1.5, 0.12, 0.05, 0.1]], green, { sides: 8, belly: pale, seed: 45, tone: 0.07 });
      // Olhos saltados e crista de placas no dorso e na cauda.
      for (const s of [1, -1]) lump(m, [0.84, 0.3, s * 0.1], [0.05, 0.05, 0.04], shade(green, 0.86), 3, { rough: 0.04, low: 0.9 });
      for (let i = 0; i < 12; i++) { const x = 0.4 - i * 0.17, y = 0.36 - Math.max(0, i - 5) * 0.035; m.blade([x - 0.07, y - 0.03, 0.02], [x + 0.07, y - 0.03, -0.02], [x - 0.03, y + 0.08, 0], shade(green, 0.76)); }
      for (const [x, z] of [[0.38, 1], [0.38, -1], [-0.4, 1], [-0.4, -1]] as const) {
        limb(m, [x, 0.16, z * 0.22], [x + 0.06, 0.12, z * 0.4], 0.065, 0.05, shade(green, 0.9), 5, 0.9, 0.84);
        limb(m, [x + 0.06, 0.12, z * 0.4], [x + 0.14, 0, z * 0.48], 0.05, 0.04, shade(green, 0.84), 4, 0.84, 0.76);
      }
      rigOut = { x: 0.55, y: 0.18, top: 0.1 };
      data = m.build(); break;
    }
    case 'camelo': {
      // `animais/camelo.png`: dromedário: uma corcova alta, pescoço comprido em arco, pernas longas, cor de areia.
      const sand = rgb(208, 160, 94);
      const k = quadruped({ L: 1.38, R: 0.36, W: 0.27, leg: 0.92, prof: [[-0.5, 0.04, 0.6, 0.62], [-0.38, 0.1, 0.94, 0.94], [-0.14, 0.56, 1.5, 0.96], [0.06, 0.6, 1.52, 0.94], [0.26, 0.14, 1.04, 0.98], [0.42, 0.02, 0.92, 0.9], [0.5, 0.0, 0.7, 0.66]], neck: [0.78, 1.0, 0.24, 0.13], head: [0.42, 0.125, 0.1, -0.18], legR: [0.085, 0.045], coat: sand, belly: rgb(196, 148, 86), legs: rgb(196, 150, 90), hoof: rgb(150, 112, 70), muzzle: rgb(190, 142, 84), seed: 47 });
      earsOn(k, 0.07, rgb(190, 142, 84), 0.5); tail(k, k.cy + 0.1, 0.12, 0.42, 0.03, rgb(170, 126, 76), rgb(120, 86, 54));
      data = k.m.build(); break;
    }
    case 'cabra': {
      // `animais/deserto-montanha-agua.png`: cabra-montesa: cinza-acastanhada, chifres grandes em arco para trás, barbicha.
      const coat = rgb(112, 98, 86);
      const k = quadruped({ L: 0.98, R: 0.27, W: 0.2, leg: 0.46, neck: [0.3, 0.9, 0.18, 0.13], head: [0.32, 0.115, 0.09, -0.28], legR: [0.07, 0.04], coat, belly: rgb(160, 146, 128), back: rgb(86, 74, 66), legs: rgb(78, 68, 60), hoof: rgb(40, 34, 30), muzzle: rgb(90, 78, 70), seed: 49 });
      earsOn(k, 0.1, coat, 0.5); horns(k, 0.66, rgb(126, 108, 84), 2.5, 0.16, 0.085); tail(k, k.cy + 0.12, 0.09, -0.04, 0.04, rgb(78, 68, 60));
      lump(k.m, [k.hx + 0.14, k.hy - 0.22, 0], [0.04, 0.11, 0.03], rgb(70, 60, 54), 5, { rough: 0.05, low: 0.88 });
      data = k.m.build(); break;
    }
    case 'aguia': {
      // `animais/deserto-montanha-agua.png`: águia de cabeça e cauda brancas, bico e pés amarelos. Parada no jogo é voando: asas abertas com as penas da ponta separadas.
      const m = new Model(), brown = rgb(84, 56, 38), dark = rgb(58, 40, 30), white = rgb(242, 242, 238), yellow = rgb(236, 180, 48);
      const perched = pose === 'eat' || pose === 'dead';
      tube(m, [[-0.34, 0.4, 0.07, 0.07], [-0.16, 0.42, 0.14, 0.13], [0.1, 0.43, 0.15, 0.14], [0.26, 0.45, 0.1, 0.1]], brown, { sides: 6, seed: 51 });
      tube(m, [[0.24, 0.46, 0.1, 0.095], [0.36, 0.48, 0.1, 0.09], [0.45, 0.46, 0.06, 0.06]], white, { sides: 6, seed: 52 });
      m.tri([0.45, 0.5, 0.035], [0.45, 0.5, -0.035], [0.58, 0.42, 0], yellow, [0.3, 0.46, 0]);
      m.tri([0.45, 0.44, 0.03], [0.45, 0.44, -0.03], [0.58, 0.42, 0], shade(yellow, 0.84), [0.3, 0.5, 0]);
      fin(m, [-0.3, 0.42, 0.1], [-0.3, 0.42, -0.1], [-0.66, 0.4, 0], white); fin(m, [-0.3, 0.42, 0.1], [-0.62, 0.4, 0.16], [-0.66, 0.4, 0], white); fin(m, [-0.3, 0.42, -0.1], [-0.62, 0.4, -0.16], [-0.66, 0.4, 0], white);
      if (perched) {
        for (const s of [1, -1]) { fin(m, [0.2, 0.52, s * 0.14], [-0.2, 0.5, s * 0.15], [-0.4, 0.3, s * 0.12], brown); limb(m, [0, 0.3, s * 0.06], [0.02, 0, s * 0.07], 0.024, 0.016, yellow, 3, 1, 0.9); }
      } else {
        for (const s of [1, -1]) {
          const root: V3 = [0.16, 0.48, s * 0.12], rootB: V3 = [-0.2, 0.47, s * 0.12], elbow: V3 = [0.12, 0.56, s * 0.72], elbowB: V3 = [-0.3, 0.54, s * 0.7], wrist: V3 = [0.02, 0.58, s * 1.2];
          fin(m, root, rootB, elbowB, brown); fin(m, root, elbowB, elbow, shade(brown, 1.08)); fin(m, elbow, elbowB, wrist, dark);
          // Penas da ponta, como dedos.
          for (let f = 0; f < 5; f++) { const bx = 0.04 - f * 0.1; fin(m, [bx, 0.57, s * 1.12], [bx - 0.09, 0.57, s * 1.1], [bx - 0.1 - f * 0.01, 0.6, s * (1.56 - f * 0.07)], f % 2 ? dark : shade(dark, 0.84)); }
        }
        for (const s of [1, -1]) limb(m, [-0.1, 0.34, s * 0.05], [-0.26, 0.3, s * 0.05], 0.022, 0.014, yellow, 3, 1, 0.9);
      }
      data = m.build(); break;
    }
    case 'cardume': {
      // `animais/deserto-montanha-agua.png`: peixes prateados e azulados, de corpo cheio, nadando juntos.
      const m = new Model(), rand = sequence(53), body = rgb(128, 160, 184);
      for (let k = 0; k < 9; k++) {
        const x = (rand() - 0.5) * 1.3, z = (rand() - 0.5) * 1.0, l = 0.2 + rand() * 0.07, c = shade(body, 0.86 + rand() * 0.3), y = 0.03 + rand() * 0.05;
        const sub = new Model();
        tube(sub, [[-l, 0, l * 0.06, l * 0.03], [-l * 0.4, 0, l * 0.3, l * 0.14], [l * 0.3, 0, l * 0.34, l * 0.16], [l, 0, l * 0.05, l * 0.04]], c, { sides: 5, seed: 53 + k, belly: rgb(226, 232, 236) });
        fin(sub, [-l * 0.95, 0, 0], [-l * 1.45, l * 0.36, 0], [-l * 1.45, -l * 0.36, 0], shade(c, 0.84));
        fin(sub, [l * 0.1, l * 0.3, 0], [-l * 0.3, l * 0.3, 0], [-l * 0.2, l * 0.58, 0], shade(c, 0.8));
        const d = sub.build();
        // Cada peixe deitado um pouco de lado: de cima, vê-se o flanco prateado.
        const tilt = 0.9, ct = Math.cos(tilt), st = Math.sin(tilt);
        for (let o = 0; o < d.length; o += MODEL_FLOATS * 3) {
          const tri: V3[] = [];
          for (let v = 0; v < 3; v++) { const px = d[o + v * 10] as number, py = d[o + v * 10 + 1] as number, pz = d[o + v * 10 + 2] as number; tri.push([px + x, ct * py - st * pz + y, st * py + ct * pz + z]); }
          m.tri(tri[0] as V3, tri[1] as V3, tri[2] as V3, [d[o + 6] as number, d[o + 7] as number, d[o + 8] as number], [x, y, z]);
        }
      }
      data = m.build(); break;
    }
    case 'baleia': {
      // `animais/baleia.png`: azul-escura, barriga clara, nadadeiras peitorais compridas e cauda larga.
      const m = new Model(), c = rgb(44, 70, 122), pale = rgb(206, 214, 222);
      swimmer(m, 2.7, 0.62, 0.6, [[1, 0.2, 0.26], [0.8, 0.66, 0.74], [0.45, 0.96, 1], [0, 1, 0.98], [-0.4, 0.74, 0.66], [-0.75, 0.36, 0.26], [-0.97, 0.14, 0.1]], c, pale, 59);
      flukes(m, -2.56, 0.95, 0.62, shade(c, 0.9));
      for (const s of [1, -1]) { fin(m, [1.2, -0.2, s * 0.5], [0.6, -0.26, s * 0.5], [0.1, -0.34, s * 1.75], shade(c, 0.94)); fin(m, [1.2, -0.2, s * 0.5], [0.1, -0.34, s * 1.75], [0.5, -0.3, s * 1.7], pale); }
      fin(m, [-0.9, 0.5, 0], [-1.3, 0.42, 0], [-1.26, 0.7, 0], shade(c, 0.86));
      data = m.build(); break;
    }
    case 'cachalote': case 'baleiaBranca': {
      // `animais/mar.png`: cabeça enorme e quadrada, mandíbula fina por baixo, corcova pequena no dorso. A baleia branca colossal (`miticos.png`) é o mesmo bicho, branco, maior, com cicatrizes e arpões.
      const white = a === 'baleiaBranca', m = new Model(), c = white ? rgb(232, 230, 222) : rgb(112, 112, 118), pale = white ? rgb(244, 242, 236) : rgb(150, 148, 148), k = white ? 1.9 : 1;
      swimmer(m, 2.4 * k, 0.6 * k, 0.5 * k, [[1, 0.84, 0.8], [0.9, 0.96, 0.92], [0.4, 1, 1], [-0.05, 0.94, 0.94], [-0.45, 0.62, 0.58], [-0.78, 0.3, 0.24], [-0.98, 0.12, 0.09]], c, pale, 61);
      // Mandíbula.
      tube(m, [[0.5 * k, -0.52 * k, 0.07 * k, 0.12 * k], [1.5 * k, -0.52 * k, 0.06 * k, 0.1 * k], [2.2 * k, -0.44 * k, 0.04 * k, 0.07 * k]], pale, { sides: 5, seed: 62 });
      flukes(m, -2.3 * k, 0.8 * k, 0.56 * k, shade(c, 0.9));
      fin(m, [-0.9 * k, 0.5 * k, 0], [-1.3 * k, 0.4 * k, 0], [-1.2 * k, 0.66 * k, 0], shade(c, 0.86));
      for (const s of [1, -1]) fin(m, [0.5 * k, -0.3 * k, s * 0.44 * k], [0.1 * k, -0.34 * k, s * 0.42 * k], [0, -0.42 * k, s * 0.86 * k], shade(c, 0.9));
      if (white) {
        // Cicatrizes em X e arpões cravados.
        const scar = rgb(120, 92, 88), rand = sequence(63);
        for (let i = 0; i < 7; i++) {
          const x = (-0.6 + rand() * 2.2) * k, s = rand() < 0.5 ? 1 : -1, y = (0.25 + rand() * 0.3) * k, z = s * 0.5 * k * 0.86, l = 0.2 * k;
          for (const d of [1, -1]) m.blade([x - l, y - l * d, z * 1.02], [x + l, y + l * d, z * 1.02], [x + l * 0.9, y + l * d + 0.05, z * 1.04], scar);
        }
        for (let i = 0; i < 3; i++) { const x = (0.9 - i * 1.1) * k, s = i % 2 ? 1 : -1; limb(m, [x, 0.5 * k, s * 0.2 * k], [x - 0.3, 0.5 * k + 0.9, s * 0.5 * k], 0.035, 0.03, rgb(110, 84, 60), 4); }
      }
      data = m.build(); break;
    }
    case 'tubarao': {
      // `animais/mar.png`: cinza com a barriga branca, barbatana alta no dorso, cauda em foice de pé.
      const m = new Model(), c = rgb(118, 132, 144), pale = rgb(232, 234, 232);
      swimmer(m, 1.35, 0.27, 0.24, [[1, 0.08, 0.1], [0.8, 0.6, 0.62], [0.4, 0.98, 1], [0, 1, 0.96], [-0.45, 0.66, 0.58], [-0.82, 0.26, 0.2], [-1, 0.12, 0.08]], c, pale, 65);
      fin(m, [0.2, 0.24, 0], [-0.3, 0.24, 0], [-0.32, 0.72, 0], shade(c, 0.9));
      fin(m, [-1.26, 0, 0], [-1.72, 0.6, 0], [-1.48, 0.02, 0], shade(c, 0.9)); fin(m, [-1.26, 0, 0], [-1.62, -0.32, 0], [-1.48, 0.02, 0], shade(c, 0.84));
      for (const s of [1, -1]) fin(m, [0.5, -0.12, s * 0.2], [0.1, -0.16, s * 0.2], [-0.16, -0.22, s * 0.78], shade(c, 0.94));
      for (const s of [1, -1]) m.tri([0.98, 0.07, s * 0.14], [1.06, 0.08, s * 0.12], [1.02, 0.12, s * 0.12], rgb(16, 16, 20), [0.9, 0, 0]);
      data = m.build(); break;
    }
    case 'lula': { const m = new Model(); squid(m, 0.5, 0.14, rgb(214, 122, 92), 55, pose === 'dead'); data = m.build(); break; }
    case 'lulaGigante': { const m = new Model(); squid(m, 1.6, 0.4, rgb(176, 60, 50), 57, pose === 'dead'); data = m.build(); break; }
    case 'kraken': {
      // `animais/miticos.png`: polvo colossal, azul-acinzentado: manto alto, olhos, oito braços longos que se enrolam (vistas de cima e ataque ao barco).
      const m = new Model(), c = rgb(74, 92, 116), pale = rgb(138, 150, 168), rand = sequence(67);
      lump(m, [-0.9, 0.5, 0], [1.6, 1.15, 1.25], c, 67, { detail: 1, rough: 0.07, tone: 0.08, low: 0.74 });
      lump(m, [0.5, 0.25, 0], [0.9, 0.75, 1.0], shade(c, 1.06), 68, { rough: 0.06, tone: 0.06, low: 0.78 });
      for (const s of [1, -1]) { lump(m, [0.9, 0.62, s * 0.62], [0.2, 0.2, 0.16], rgb(214, 196, 120), 69, { rough: 0.03, low: 0.9 }); m.tri([1.04, 0.6, s * 0.74], [1.1, 0.68, s * 0.7], [1.0, 0.72, s * 0.76], rgb(14, 14, 18), [0.9, 0.62, s * 0.5]); }
      for (let k = 0; k < 8; k++) {
        const a = -1.3 + (k / 7) * 2.6 + (k % 2) * 0.12, len = 4.2 + rand() * 1.6, curl = (k % 2 ? 1 : -1) * (0.5 + rand() * 0.5);
        const path: Pt[] = [];
        let x = 0.9, z = Math.sin(a) * 0.6, dir = a;
        for (let i = 0; i <= 9; i++) {
          const t = i / 9, r = 0.4 * (1 - t * 0.86);
          path.push([x, 0.06 + Math.sin(t * 5 + k) * 0.16 * (1 - t), r, r]);
          // O braço é montado no plano x–y e depois girado: guarda z à parte.
          zs.push(z);
          dir += curl * 0.3 * (0.4 + t);
          x += Math.cos(dir) * (len / 9); z += Math.sin(dir) * (len / 9);
        }
        armTube(m, path, zs.splice(0), k % 2 ? c : shade(c, 0.92), pale, 70 + k);
      }
      data = m.build(); break;
    }
    case 'dragao': {
      // `animais/dragao.png`: corpo castanho-escuro, quatro patas, pescoço longo, dois chifres claros, crista vermelha no dorso, cauda comprida e asas de membrana escura com as hastes vermelhas.
      const dark = rgb(70, 48, 38), red = rgb(176, 36, 32), horn = rgb(226, 208, 170);
      const k = quadruped({ L: 2.5, R: 0.56, W: 0.46, leg: 0.8, prof: [[-0.5, -0.1, 0.6, 0.6], [-0.36, 0, 0.92, 0.94], [-0.1, 0.04, 1.0, 1], [0.2, 0.08, 1.06, 1.02], [0.4, 0.1, 0.94, 0.9], [0.5, 0.14, 0.7, 0.66]], neck: [1.2, 0.72, 0.4, 0.22], head: [0.9, 0.24, 0.2, -0.3], legR: [0.2, 0.1], coat: dark, belly: rgb(96, 68, 52), back: rgb(58, 40, 32), legs: rgb(62, 42, 34), hoof: rgb(30, 22, 20), muzzle: rgb(58, 40, 32), seed: 71 });
      // Chifres para trás e para cima.
      for (const s of [1, -1]) { limb(k.m, [k.hx - 0.06, k.hy + 0.18, s * 0.14], [k.hx - 0.4, k.hy + 0.52, s * 0.24], 0.07, 0.045, horn, 5); limb(k.m, [k.hx - 0.4, k.hy + 0.52, s * 0.24], [k.hx - 0.56, k.hy + 0.9, s * 0.2], 0.045, 0.01, horn, 5); limb(k.m, [k.hx + 0.02, k.hy + 0.12, s * 0.2], [k.hx - 0.22, k.hy + 0.2, s * 0.36], 0.04, 0.01, horn, 4); }
      // Cauda comprida e crista vermelha da nuca até a ponta.
      const tp: Pt[] = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; tp.push([k.rear + 0.1 - t * 2.9, k.cy - 0.04 - t * 0.9 + t * t * 0.5, 0.36 * (1 - t * 0.9), 0.34 * (1 - t * 0.9)]); }
      tube(k.m, tp, dark, { sides: 6, seed: 72, belly: rgb(96, 68, 52) });
      for (let i = 0; i < 20; i++) {
        const t = i / 19, onTail = t > 0.52, u = onTail ? (t - 0.52) / 0.48 : t / 0.52;
        const x = onTail ? k.rear + 0.1 - u * 2.7 : k.neckX + 0.5 - u * (k.neckX + 0.5 - k.rear), y = onTail ? k.cy + 0.3 - u * 0.9 + u * u * 0.5 - u * 0.26 : k.top + 0.02 + (1 - u) * 0.1, h = (onTail ? 0.26 * (1 - u * 0.7) : 0.3);
        k.m.blade([x + 0.1, y - 0.04, 0.02], [x - 0.1, y - 0.04, -0.02], [x - 0.08, y + h, 0], red);
      }
      for (let i = 0; i < 5; i++) { const t = i / 5, x = k.neckX + (k.hx - k.neckX) * t - 0.24 + t * 0.1, y = k.neckY + (k.hy - k.neckY) * t + 0.34; k.m.blade([x + 0.09, y - 0.06, 0.02], [x - 0.09, y - 0.1, -0.02], [x - 0.12, y + 0.2, 0], red); }
      // Asas: três hastes vermelhas saindo do ombro e a membrana escura entre elas, com a borda de trás em pontas.
      const folded = pose === 'dead';
      for (const s of [1, -1]) {
        const sh: V3 = [0.56, k.top - 0.06, s * 0.3];
        const tips: V3[] = folded
          ? [[0.9, k.top + 0.5, s * 0.7], [-0.2, k.top + 0.9, s * 0.8], [-1.2, k.top + 0.5, s * 0.7], [-1.6, k.top + 0.0, s * 0.5]]
          : [[1.5, k.top + 1.5, s * 1.9], [0.3, k.top + 2.3, s * 3.3], [-1.3, k.top + 1.6, s * 3.0], [-1.9, k.top + 0.5, s * 1.6]];
        const wrist: V3 = folded ? [0.5, k.top + 0.7, s * 0.6] : [0.9, k.top + 1.3, s * 1.3];
        limb(k.m, sh, wrist, 0.1, 0.07, red, 4, 1, 1);
        for (const tip of tips) limb(k.m, wrist, tip, 0.06, 0.02, red, 4, 1, 1);
        const mem = rgb(74, 40, 36);
        for (let i = 0; i + 1 < tips.length; i++) {
          const a = tips[i] as V3, b = tips[i + 1] as V3, mid: V3 = [(a[0] + b[0]) / 2 + (wrist[0] - (a[0] + b[0]) / 2) * 0.24, (a[1] + b[1]) / 2 + (wrist[1] - (a[1] + b[1]) / 2) * 0.24, (a[2] + b[2]) / 2 + (wrist[2] - (a[2] + b[2]) / 2) * 0.24];
          k.m.blade(wrist, a, mid, shade(mem, 0.94 + i * 0.06)); k.m.blade(wrist, mid, b, shade(mem, 1.0 + i * 0.06));
        }
        k.m.blade(sh, wrist, tips[3] as V3, shade(mem, 0.9));
      }
      data = k.m.build(); break;
    }
  }
  rigs.set(a, rigOut);
  if (SWIMMERS.has(a)) {
    if (pose === 'dead') {
      // Boia de lado.
      const c = Math.cos(1.2), s = Math.sin(1.2), out = new Float32Array(data);
      for (let o = 0; o < out.length; o += MODEL_FLOATS) { const y = out[o + 1] as number, z = out[o + 2] as number, ny = out[o + 4] as number, nz = out[o + 5] as number; out[o + 1] = c * y - s * z; out[o + 2] = s * y + c * z; out[o + 4] = c * ny - s * nz; out[o + 5] = s * ny + c * nz; }
      data = out;
    }
    return underwater(data, SWIM_LIFT[a] ?? 0.1);
  }
  return pose === 'dead' ? lieDown(data) : data;
}

/** Quanto o nadador sobe da linha da água: o dorso fica de fora e o resto se vê azulado, dentro do mar. */
const SWIM_LIFT: Partial<Record<Animal, number>> = { cardume: 0.1, baleia: 0.3, cachalote: 0.32, baleiaBranca: 0.6, tubarao: 0.16, lula: 0.1, lulaGigante: 0.22, kraken: 0.3 };

/** Braço do kraken: um tubo que serpenteia também para os lados. */
const zs: number[] = [];
function armTube(m: Model, path: readonly Pt[], z: readonly number[], color: Rgb, pale: Rgb, seed: number): void {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i] as Pt, b = path[i + 1] as Pt;
    limb(m, [a[0], a[1], z[i] as number], [b[0], b[1], z[i + 1] as number], a[2], b[2], (seed + i) % 3 ? color : pale, 5, 0.92, 0.92);
  }
}

const rigs = new Map<Animal, { x: number; y: number; top: number }>();
/** Base do pescoço e altura do quadril: o desenho dobra o pescoço e balança a perna em volta deles. */
export function animalRig(a: Animal): { x: number; y: number; top: number } {
  animalModel(a, 'idle');
  return rigs.get(a) ?? { x: 0, y: 0, top: 0 };
}

const cache = new Map<string, Float32Array>();
export function animalModel(a: Animal, pose: Pose): Float32Array {
  const key = `${a}:${pose}`;
  let m = cache.get(key);
  if (!m) { m = build(a, pose); cache.set(key, m); }
  return m;
}

/** Quem vive em cada bioma, com o tamanho de grupo da especificação (mínimo e máximo). */
export const FAUNA: Partial<Record<number, readonly (readonly [Animal, number, number])[]>> = {
  [Biome.Tundra]: [['rena', 3, 8], ['loboArtico', 2, 5], ['lebre', 1, 3]],
  [Biome.Ice]: [['loboArtico', 2, 4]],
  [Biome.Taiga]: [['alce', 1, 2], ['lobo', 3, 6], ['urso', 1, 1], ['lebre', 1, 3], ['rena', 3, 8]],
  [Biome.TemperateForest]: [['cervo', 2, 6], ['javali', 2, 6], ['lobo', 3, 6], ['urso', 1, 1], ['alce', 1, 2]],
  [Biome.Grassland]: [['bisao', 4, 12], ['cervo', 2, 6], ['antilope', 4, 12]],
  [Biome.Steppe]: [['bisao', 4, 12], ['antilope', 4, 12]],
  [Biome.Savanna]: [['zebra', 4, 10], ['antilope', 4, 12], ['elefante', 2, 6], ['leao', 2, 6]],
  [Biome.TropicalForest]: [['macaco', 3, 10], ['onca', 1, 1], ['capivara', 3, 8], ['javali', 2, 6]],
  [Biome.Swamp]: [['jacare', 1, 3], ['capivara', 3, 8]],
  [Biome.HotDesert]: [['camelo', 2, 5]],
  [Biome.ColdDesert]: [['camelo', 2, 5]],
  [Biome.Mountain]: [['cabra', 2, 6], ['aguia', 1, 1]],
  [Biome.SnowyPeak]: [['cabra', 2, 6], ['aguia', 1, 1]],
  [Biome.ShallowOcean]: [['cardume', 6, 12], ['tubarao', 1, 2], ['lula', 2, 6]],
  [Biome.DeepOcean]: [['baleia', 1, 3], ['cachalote', 1, 3], ['cardume', 6, 12], ['lulaGigante', 1, 1]],
};
