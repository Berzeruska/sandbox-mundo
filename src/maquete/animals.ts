import { Biome } from '../world/biomes';
import { hash3, sequence } from './hash';
import { limb, lump, MODEL_FLOATS, Model, rgb, type Rgb, type V3 } from './models';

/**
 * Animais (T7), só o desenho e o andar: as espécies aprovadas em `docs/04-ecologia.md`, com forma e poses das folhas em `animais/` e as correções do `LEIAME.md`.
 * Sem simulação de ecologia. A cabeça aponta para +x. 1 unidade = 1 célula fina; o humano da escala teria ~1,3.
 */
export const POSES = ['idle', 'walk1', 'walk2', 'eat', 'dead'] as const;
export type Pose = (typeof POSES)[number];
export const ANIMALS = ['rena', 'loboArtico', 'lebre', 'cervo', 'alce', 'javali', 'lobo', 'urso', 'bisao', 'antilope', 'zebra', 'elefante', 'leao', 'capivara', 'macaco', 'onca', 'jacare', 'camelo', 'cabra', 'aguia', 'cardume', 'baleia', 'cachalote', 'tubarao', 'lula', 'lulaGigante'] as const;
export type Animal = (typeof ANIMALS)[number];
export const SWIMMERS: ReadonlySet<Animal> = new Set(['cardume', 'baleia', 'cachalote', 'tubarao', 'lula', 'lulaGigante']);

const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

interface Body {
  len: number; h: number; w: number; leg: number; legR: number; neck: number; neckUp: number; head: number;
  coat: Rgb; belly?: Rgb; legs?: Rgb; face?: Rgb; rump?: number; chest?: number;
}

let rigOut = { x: 0, y: 0, top: 0 };

interface Built { m: Model; hx: number; hy: number; hz: number; top: number; rear: number; eat: boolean }

/** Quatro patas, tronco, pescoço e cabeça, na pose pedida. */
function quadruped(b0: Body, _pose: Pose, seed: number): Built {
  void _pose;
  const m = new Model();
  // Corpo mais cheio que os parâmetros (D1: os animais estavam magros), como nas folhas.
  const b: Body = { ...b0, h: b0.h * 1.28, w: b0.w * 1.26, legR: b0.legR * 1.4 };
  rigOut = { x: b.len * 0.42, y: b.leg + b.h * 0.72, top: b.leg + b.h * 0.14 };
  const legs = b.legs ?? shade(b.coat, 0.82), face = b.face ?? b.coat, rump = b.rump ?? 0.9, chest = b.chest ?? 1;
  const by = b.leg + b.h / 2, stride = b.leg * 0.42;
  const swing = 0, eat = false;
  for (const [sx, sz, phase] of [[0.36, 1, 1], [0.36, -1, -1], [-0.36, 1, -1], [-0.36, -1, 1]] as const) {
    const x = sx * b.len, z = sz * b.w * 0.34, foot = x + swing * phase * stride;
    const knee: V3 = [x + (foot - x) * 0.45 + 0.02, b.leg * 0.48, z];
    limb(m, [x, b.leg + b.h * 0.2, z], knee, b.legR * 1.25, b.legR * 0.7, legs, 6, 0.9, 0.84);
    limb(m, knee, [foot, b.leg * 0.08, z], b.legR * 0.7, b.legR * 0.56, shade(legs, 0.92), 5, 0.84, 0.76);
    limb(m, [foot, b.leg * 0.09, z], [foot + 0.01, 0, z], b.legR * 0.62, b.legR * 0.7, shade(legs, 0.5), 4, 0.7, 0.66);
  }
  lump(m, [b.len * 0.2, by + b.h * 0.02, 0], [b.len * 0.4, (b.h / 2) * chest, b.w / 2], b.coat, seed + 1, { detail: 1, rough: 0.03, tone: 0.06, low: 0.7 });
  lump(m, [-b.len * 0.22, by, 0], [b.len * 0.4, (b.h / 2) * rump, (b.w / 2) * 0.96], shade(b.coat, 0.97), seed + 2, { detail: 1, rough: 0.03, tone: 0.06, low: 0.7 });
  if (b.belly) lump(m, [0, by - b.h * 0.28, 0], [b.len * 0.36, b.h * 0.24, b.w * 0.42], b.belly, seed + 3, { rough: 0.03, tone: 0.04, low: 0.86 });
  const nx = b.len * 0.42, ny = by + b.h * 0.2;
  const hx = eat ? nx + b.neck * 0.62 : nx + b.neck * (1 - b.neckUp * 0.55), hy = eat ? Math.max(b.head * 0.4, 0.08) : ny + b.neck * b.neckUp;
  limb(m, [nx - b.len * 0.06, ny - b.h * 0.08, 0], [hx, hy, 0], b.h * 0.42, b.h * 0.2, shade(b.coat, 0.98), 7, 0.84, 1);
  lump(m, [hx + b.head * 0.3, hy, 0], [b.head * 0.68, b.head * 0.48, b.head * 0.46], face, seed + 4, { detail: 1, rough: 0.03, tone: 0.06, low: 0.8 });
  lump(m, [hx + b.head * 0.86, hy - b.head * 0.12, 0], [b.head * 0.34, b.head * 0.27, b.head * 0.27], shade(face, 0.92), seed + 5, { rough: 0.03, tone: 0.05, low: 0.82 });
  return { m, hx, hy, hz: 0, top: by + b.h / 2, rear: -b.len * 0.56, eat };
}

function ear(m: Model, x: number, y: number, z: number, l: number, color: Rgb): void {
  m.blade([x - l * 0.2, y, z - l * 0.22], [x + l * 0.2, y, z + l * 0.22], [x - l * 0.1, y + l, z + Math.sign(z) * l * 0.28], color);
}
function earsOn(k: Built, b: Body, l: number, color: Rgb): void {
  const y = k.hy + b.head * 0.2, x = k.hx + b.head * 0.02;
  ear(k.m, x, y, b.head * 0.26, l, color);
  ear(k.m, x, y, -b.head * 0.26, l, color);
}
function tail(k: Built, y: number, len: number, droop: number, r: number, color: Rgb, tip?: Rgb): void {
  const a: V3 = [k.rear, y, 0], c: V3 = [k.rear - len, y - droop, 0];
  limb(k.m, a, c, r, r * 0.5, color, 4, 0.9, 0.9);
  if (tip) lump(k.m, c, [r * 1.5, r * 1.8, r * 1.5], tip, 3, { rough: 0.05, low: 0.9 });
}
function antlers(k: Built, b: Body, size: number, color: Rgb, wide: boolean): void {
  const y = k.hy + b.head * 0.26, x = k.hx - b.head * 0.02;
  for (const s of [1, -1]) {
    const up: V3 = [x - size * 0.1, y + size * (wide ? 0.16 : 0.7), s * size * (wide ? 0.3 : 0.42)];
    limb(k.m, [x, y, s * b.head * 0.18], up, 0.035, 0.024, color, 3, 1, 1);
    if (wide) {
      // Alce: pá larga.
      const near: V3 = [x - size * 0.02, y + size * 0.14, s * size * 0.3];
      // Alce (`animais/floresta-1.png`): haste curta, pá larga e pontas na borda.
      const tipA: V3 = [x + size * 0.22, y + size * 0.42, s * size * 0.8], tipB: V3 = [x - size * 0.42, y + size * 0.42, s * size * 0.9];
      k.m.blade(near, tipA, tipB, color);
      for (let t = 0; t < 5; t++) {
        const u = t / 4, bx = tipA[0] + (tipB[0] - tipA[0]) * u, by = tipA[1] + (tipB[1] - tipA[1]) * u, bz = tipA[2] + (tipB[2] - tipA[2]) * u;
        limb(k.m, [bx, by - 0.01, bz], [bx - size * 0.05, by + size * 0.26, bz + s * size * 0.1], 0.028, 0.008, shade(color, 0.96), 3, 1, 1);
      }
    } else {
      limb(k.m, up, [x - size * 0.34, y + size * 1.2, s * size * 0.64], 0.024, 0.012, color, 3, 1, 1);
      limb(k.m, [x - size * 0.06, y + size * 0.42, s * size * 0.28], [x + size * 0.32, y + size * 0.76, s * size * 0.34], 0.022, 0.01, color, 3, 1, 1);
      limb(k.m, [x - size * 0.16, y + size * 0.88, s * size * 0.5], [x + size * 0.22, y + size * 1.14, s * size * 0.6], 0.02, 0.01, color, 3, 1, 1);
    }
  }
}
function horns(k: Built, b: Body, size: number, color: Rgb, curve: number): void {
  const y = k.hy + b.head * 0.22, x = k.hx;
  for (const s of [1, -1]) {
    const mid: V3 = [x - size * 0.4 * curve, y + size * 0.7, s * b.head * 0.3];
    limb(k.m, [x, y, s * b.head * 0.16], mid, 0.045, 0.03, color, 4, 1, 1);
    limb(k.m, mid, [x - size * curve, y + size * (1.1 - curve * 0.5), s * b.head * 0.42], 0.03, 0.012, color, 4, 1, 1);
  }
}

/** Troca a cor das facetas pela regra (listras, pintas). */
function recolor(data: Float32Array, rule: (x: number, y: number, z: number, r: number, g: number, b: number, i: number) => Rgb | null): void {
  for (let o = 0; o < data.length; o += MODEL_FLOATS * 3) {
    const x = ((data[o] as number) + (data[o + 10] as number) + (data[o + 20] as number)) / 3, y = ((data[o + 1] as number) + (data[o + 11] as number) + (data[o + 21] as number)) / 3, z = ((data[o + 2] as number) + (data[o + 12] as number) + (data[o + 22] as number)) / 3;
    const c = rule(x, y, z, data[o + 6] as number, data[o + 7] as number, data[o + 8] as number, o);
    if (c) for (let v = 0; v < 3; v++) { data[o + v * 10 + 6] = c[0]; data[o + v * 10 + 7] = c[1]; data[o + v * 10 + 8] = c[2]; }
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

/** Corpo de nadador: fuso facetado de 8 lados, afinando para a cauda. */
function spindle(m: Model, len: number, r: number, color: Rgb, belly: Rgb, head = 1): void {
  const rings = [[1, 0.25 * head], [0.72, 0.8], [0.35, 1], [0, 0.95], [-0.4, 0.66], [-0.75, 0.32], [-1, 0.1]] as const;
  for (let i = 0; i + 1 < rings.length; i++) {
    const [xa, ra] = rings[i] as readonly [number, number], [xb, rb] = rings[i + 1] as readonly [number, number];
    for (let k = 0; k < 8; k++) {
      const t0 = (k / 8) * 6.283, t1 = ((k + 1) / 8) * 6.283;
      const p = (x: number, rr: number, t: number): V3 => [x * len, Math.sin(t) * rr * r, Math.cos(t) * rr * r];
      const low = Math.sin((t0 + t1) / 2) < -0.2;
      const col = low ? belly : shade(color, 0.94 + ((k + i) % 3) * 0.05);
      m.tri(p(xa, ra, t0), p(xa, ra, t1), p(xb, rb, t1), col, [(xa + xb) * 0.5 * len, 0, 0]);
      m.tri(p(xa, ra, t0), p(xb, rb, t1), p(xb, rb, t0), col, [(xa + xb) * 0.5 * len, 0, 0]);
    }
  }
}

function capEnds(m: Model, len: number, r: number, color: Rgb, head: number): void {
  // Ponta da frente fechada: sem isso o bicho parecia sem cabeça (A4).
  const R = 0.25 * head * r, tip: V3 = [len * 1.14, 0, 0];
  for (let k = 0; k < 8; k++) {
    const t0 = (k / 8) * 6.283, t1 = ((k + 1) / 8) * 6.283;
    m.tri([len, Math.sin(t0) * R, Math.cos(t0) * R], [len, Math.sin(t1) * R, Math.cos(t1) * R], tip, color, [len * 0.9, 0, 0]);
  }
}

function flukes(m: Model, x: number, span: number, len: number, color: Rgb): void {
  fin(m, [x, 0, 0], [x - len, 0.04, span], [x - len * 0.5, 0, 0], color);
  fin(m, [x, 0, 0], [x - len, 0.04, -span], [x - len * 0.5, 0, 0], color);
}

function squid(m: Model, len: number, r: number, color: Rgb, seed: number): void {
  const rand = sequence(seed);
  lump(m, [-len * 0.35, 0, 0], [len * 0.55, r, r], color, seed, { rough: 0.03, tone: 0.06, low: 0.85 });
  fin(m, [-len * 0.75, 0, 0], [-len * 1.05, 0, r * 1.3], [-len * 0.55, 0, r * 0.7], shade(color, 0.92));
  fin(m, [-len * 0.75, 0, 0], [-len * 1.05, 0, -r * 1.3], [-len * 0.55, 0, -r * 0.7], shade(color, 0.92));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.283, l = len * (0.7 + rand() * 0.5);
    const mid: V3 = [len * 0.5 + l * 0.4, Math.sin(a) * r * 0.5, Math.cos(a) * r * 0.9];
    limb(m, [len * 0.12, Math.sin(a) * r * 0.3, Math.cos(a) * r * 0.3], mid, r * 0.12, r * 0.08, color, 3, 0.95, 0.95);
    limb(m, mid, [len * 0.5 + l, Math.sin(a) * r * 0.9, Math.cos(a) * r * 1.3], r * 0.08, r * 0.03, color, 3, 0.95, 0.95);
  }
}

function build(a: Animal, pose: Pose): Float32Array {
  // "morto" parte do parado; os nadadores abanam nos quadros de andar.
  const shapePose = 'idle' as Pose;
  rigOut = { x: 0, y: 0, top: 0 };
  let data: Float32Array;
  switch (a) {
    case 'rena': {
      const b: Body = { len: 1.25, h: 0.5, w: 0.42, leg: 0.58, legR: 0.055, neck: 0.5, neckUp: 0.72, head: 0.3, coat: rgb(130, 106, 84), belly: rgb(214, 206, 188), legs: rgb(110, 92, 76), face: rgb(150, 128, 104) };
      const k = quadruped(b, shapePose, 11); earsOn(k, b, 0.13, b.coat); antlers(k, b, 0.5, rgb(170, 150, 118), false); tail(k, k.top - 0.12, 0.14, 0.08, 0.05, rgb(226, 220, 206));
      data = k.m.build(); break;
    }
    case 'loboArtico': case 'lobo': {
      const coat = a === 'lobo' ? rgb(112, 112, 116) : rgb(226, 230, 234);
      const b: Body = { len: 1.02, h: 0.34, w: 0.28, leg: 0.42, legR: 0.045, neck: 0.3, neckUp: 0.5, head: 0.28, coat, belly: a === 'lobo' ? rgb(176, 174, 170) : rgb(244, 246, 248), rump: 0.86 };
      const k = quadruped(b, shapePose, a === 'lobo' ? 21 : 13); earsOn(k, b, 0.12, shade(coat, 0.8)); tail(k, k.top - 0.12, 0.42, 0.26, 0.07, shade(coat, 0.92));
      data = k.m.build(); break;
    }
    case 'lebre': {
      const b: Body = { len: 0.46, h: 0.26, w: 0.2, leg: 0.1, legR: 0.03, neck: 0.1, neckUp: 0.8, head: 0.17, coat: rgb(226, 224, 216), rump: 1.1 };
      const k = quadruped(b, shapePose, 15); earsOn(k, b, 0.24, rgb(214, 208, 198)); tail(k, k.top - 0.08, 0.05, 0, 0.05, rgb(250, 250, 250));
      data = k.m.build(); break;
    }
    case 'cervo': {
      const b: Body = { len: 1.2, h: 0.46, w: 0.36, leg: 0.68, legR: 0.05, neck: 0.56, neckUp: 0.72, head: 0.28, coat: rgb(186, 106, 56), belly: rgb(228, 208, 176), legs: rgb(152, 92, 54) };
      const k = quadruped(b, shapePose, 17); earsOn(k, b, 0.14, b.coat); antlers(k, b, 0.55, rgb(150, 116, 80), false); tail(k, k.top - 0.1, 0.12, 0.08, 0.05, rgb(232, 224, 208));
      data = k.m.build(); break;
    }
    case 'alce': {
      const b: Body = { len: 1.55, h: 0.72, w: 0.52, leg: 0.86, legR: 0.07, neck: 0.5, neckUp: 0.42, head: 0.42, coat: rgb(92, 66, 50), legs: rgb(128, 96, 72), chest: 1.16, rump: 0.86 };
      const k = quadruped(b, shapePose, 19); earsOn(k, b, 0.15, b.coat); antlers(k, b, 0.62, rgb(146, 112, 80), true); tail(k, k.top - 0.16, 0.08, 0.05, 0.05, b.coat);
      data = k.m.build(); break;
    }
    case 'javali': {
      const b: Body = { len: 0.88, h: 0.44, w: 0.36, leg: 0.24, legR: 0.05, neck: 0.1, neckUp: 0.2, head: 0.34, coat: rgb(82, 70, 64), chest: 1.14, rump: 0.92 };
      const k = quadruped(b, shapePose, 23); earsOn(k, b, 0.09, shade(b.coat, 0.8));
      limb(k.m, [k.hx + 0.26, k.hy - 0.06, 0.08], [k.hx + 0.36, k.hy + 0.05, 0.1], 0.018, 0.006, rgb(240, 236, 224), 3);
      limb(k.m, [k.hx + 0.26, k.hy - 0.06, -0.08], [k.hx + 0.36, k.hy + 0.05, -0.1], 0.018, 0.006, rgb(240, 236, 224), 3);
      data = k.m.build(); break;
    }
    case 'urso': {
      const b: Body = { len: 1.25, h: 0.74, w: 0.66, leg: 0.34, legR: 0.13, neck: 0.22, neckUp: 0.3, head: 0.42, coat: rgb(92, 62, 42), rump: 1.04 };
      const k = quadruped(b, shapePose, 27); earsOn(k, b, 0.09, shade(b.coat, 0.8));
      data = k.m.build(); break;
    }
    case 'bisao': {
      const b: Body = { len: 1.42, h: 0.74, w: 0.56, leg: 0.42, legR: 0.08, neck: 0.16, neckUp: 0.1, head: 0.42, coat: rgb(88, 58, 40), chest: 1.32, rump: 0.74, legs: rgb(62, 44, 34) };
      const k = quadruped(b, shapePose, 29); horns(k, b, 0.18, rgb(216, 206, 182), 0.2); tail(k, k.top - 0.34, 0.2, 0.18, 0.03, rgb(62, 44, 34), rgb(52, 38, 30));
      data = k.m.build(); break;
    }
    case 'antilope': {
      const b: Body = { len: 0.94, h: 0.34, w: 0.26, leg: 0.6, legR: 0.035, neck: 0.42, neckUp: 0.76, head: 0.22, coat: rgb(182, 108, 62), belly: rgb(236, 222, 200) };
      const k = quadruped(b, shapePose, 31); earsOn(k, b, 0.1, b.coat);
      for (const s of [1, -1]) { const y = k.hy + 0.06, x = k.hx; limb(k.m, [x, y, s * 0.04], [x - 0.14, y + 0.3, s * 0.13], 0.018, 0.012, rgb(62, 50, 42), 3); limb(k.m, [x - 0.14, y + 0.3, s * 0.13], [x - 0.06, y + 0.56, s * 0.09], 0.012, 0.004, rgb(62, 50, 42), 3); }
      tail(k, k.top - 0.08, 0.12, 0.1, 0.03, rgb(60, 48, 40));
      data = k.m.build(); break;
    }
    case 'zebra': {
      const b: Body = { len: 1.16, h: 0.5, w: 0.36, leg: 0.58, legR: 0.055, neck: 0.46, neckUp: 0.66, head: 0.32, coat: rgb(238, 238, 234) };
      const k = quadruped(b, shapePose, 33); earsOn(k, b, 0.12, rgb(40, 40, 42)); tail(k, k.top - 0.1, 0.34, 0.28, 0.03, rgb(40, 40, 42));
      data = k.m.build();
      recolor(data, (x, _y, _z, r) => (r > 0.6 && Math.sin(x * 18) > 0.12 ? rgb(34, 34, 38) : null));
      break;
    }
    case 'elefante': {
      const b: Body = { len: 2.05, h: 1.26, w: 1.05, leg: 0.92, legR: 0.21, neck: 0.2, neckUp: 0.1, head: 0.7, coat: rgb(136, 130, 122), rump: 0.96 };
      const k = quadruped(b, shapePose, 35);
      const hx = k.hx + 0.28, hy = k.hy;
      for (const s of [1, -1]) k.m.blade([hx - 0.34, hy + 0.3, s * 0.3], [hx - 0.46, hy - 0.46, s * 0.62], [hx - 0.92, hy + 0.1, s * 0.72], shade(b.coat, 0.92));
      limb(k.m, [hx + 0.34, hy - 0.08, 0], [hx + 0.52, hy - 0.6, 0], 0.14, 0.08, b.coat, 5, 0.95, 0.9);
      limb(k.m, [hx + 0.52, hy - 0.6, 0], [hx + 0.54, Math.max(0.05, hy - 1.15), 0], 0.08, 0.05, b.coat, 5, 0.9, 0.85);
      for (const s of [1, -1]) limb(k.m, [hx + 0.28, hy - 0.26, s * 0.2], [hx + 0.66, hy - 0.42, s * 0.24], 0.04, 0.012, rgb(244, 240, 228), 4);
      tail(k, k.top - 0.3, 0.3, 0.5, 0.03, b.coat);
      data = k.m.build(); break;
    }
    case 'leao': {
      const b: Body = { len: 1.18, h: 0.46, w: 0.36, leg: 0.42, legR: 0.07, neck: 0.22, neckUp: 0.4, head: 0.34, coat: rgb(208, 158, 88), rump: 0.88 };
      const k = quadruped(b, shapePose, 37);
      lump(k.m, [k.hx + 0.02, k.hy, 0], [0.27, 0.31, 0.32], rgb(136, 84, 44), 7, { detail: 1, rough: 0.09, tone: 0.1, low: 0.8 });
      lump(k.m, [k.hx + 0.2, k.hy - 0.02, 0], [0.2, 0.17, 0.17], b.coat, 8, { rough: 0.03, low: 0.86 });
      earsOn(k, b, 0.08, rgb(136, 84, 44)); tail(k, k.top - 0.1, 0.46, 0.2, 0.03, b.coat, rgb(96, 62, 36));
      data = k.m.build(); break;
    }
    case 'capivara': {
      const b: Body = { len: 0.76, h: 0.44, w: 0.36, leg: 0.16, legR: 0.05, neck: 0.1, neckUp: 0.4, head: 0.3, coat: rgb(150, 98, 58), rump: 1.08 };
      const k = quadruped(b, shapePose, 39); earsOn(k, b, 0.05, shade(b.coat, 0.8));
      data = k.m.build(); break;
    }
    case 'macaco': {
      const b: Body = { len: 0.42, h: 0.3, w: 0.24, leg: 0.34, legR: 0.035, neck: 0.1, neckUp: 0.8, head: 0.2, coat: rgb(92, 62, 44), belly: rgb(214, 196, 170), face: rgb(226, 206, 180) };
      const k = quadruped(b, shapePose, 41);
      limb(k.m, [k.rear, k.top - 0.1, 0], [k.rear - 0.36, k.top + 0.1, 0], 0.025, 0.02, b.coat, 3, 1, 1);
      limb(k.m, [k.rear - 0.36, k.top + 0.1, 0], [k.rear - 0.24, k.top + 0.44, 0], 0.02, 0.012, b.coat, 3, 1, 1);
      data = k.m.build(); break;
    }
    case 'onca': {
      const b: Body = { len: 1.08, h: 0.38, w: 0.3, leg: 0.36, legR: 0.06, neck: 0.16, neckUp: 0.3, head: 0.3, coat: rgb(216, 164, 80), belly: rgb(236, 224, 196), rump: 0.92 };
      const k = quadruped(b, shapePose, 43); earsOn(k, b, 0.07, shade(b.coat, 0.8)); tail(k, k.top - 0.08, 0.5, 0.14, 0.035, b.coat, rgb(44, 36, 30));
      data = k.m.build();
      recolor(data, (x, y, z, _r, g, _b, i) => (g > 0.55 && g < 0.72 && hash3(i, Math.round(x * 9), Math.round((y + z) * 9)) < 0.34 ? rgb(62, 46, 34) : null));
      break;
    }
    case 'jacare': {
      const coat = rgb(70, 118, 58), m = new Model(), f = shapePose;
      lump(m, [0, 0.14, 0], [0.62, 0.13, 0.26], coat, 45, { detail: 1, rough: 0.05, tone: 0.1, low: 0.8 });
      limb(m, [0.5, 0.14, 0], [1.05, 0.1, 0], 0.15, 0.07, shade(coat, 0.96), 5, 0.9, 1);
      lump(m, [0.72, 0.15, 0], [0.26, 0.08, 0.13], shade(coat, 1.05), 46, { rough: 0.04, low: 0.86 });
      limb(m, [-0.5, 0.14, 0], [-1.3, 0.09, f === 'walk1' ? 0.14 : f === 'walk2' ? -0.14 : 0], 0.16, 0.02, coat, 5, 0.9, 1);
      for (const [x, z, p] of [[0.34, 1, 1], [0.34, -1, -1], [-0.32, 1, -1], [-0.32, -1, 1]] as const) {
        const sw = f === 'walk1' ? p * 0.1 : f === 'walk2' ? -p * 0.1 : 0;
        limb(m, [x, 0.12, z * 0.2], [x + sw + 0.08, 0, z * 0.42], 0.05, 0.035, shade(coat, 0.9), 4, 0.9, 0.8);
      }
      data = m.build(); break;
    }
    case 'camelo': {
      const b: Body = { len: 1.25, h: 0.5, w: 0.38, leg: 0.8, legR: 0.055, neck: 0.56, neckUp: 0.55, head: 0.3, coat: rgb(202, 158, 96), legs: rgb(186, 146, 92) };
      const k = quadruped(b, shapePose, 47);
      lump(k.m, [-0.02, k.top + 0.08, 0], [0.34, 0.32, 0.22], b.coat, 9, { rough: 0.05, tone: 0.06, low: 0.8, foot: k.top - 0.1 });
      earsOn(k, b, 0.08, b.coat); tail(k, k.top - 0.14, 0.2, 0.2, 0.025, shade(b.coat, 0.7));
      data = k.m.build(); break;
    }
    case 'cabra': {
      const b: Body = { len: 0.92, h: 0.42, w: 0.3, leg: 0.42, legR: 0.05, neck: 0.3, neckUp: 0.68, head: 0.26, coat: rgb(92, 84, 76), legs: rgb(70, 64, 58) };
      const k = quadruped(b, shapePose, 49); earsOn(k, b, 0.08, b.coat); horns(k, b, 0.6, rgb(120, 104, 80), 0.9); tail(k, k.top - 0.1, 0.08, 0, 0.03, b.coat);
      data = k.m.build(); break;
    }
    case 'aguia': {
      const m = new Model(), brown = rgb(84, 58, 40), white = rgb(240, 240, 236), yellow = rgb(232, 176, 50);
      const flying = pose !== 'idle' && pose !== 'eat' && pose !== 'dead';
      lump(m, [0, 0.42, 0], [0.34, 0.16, 0.15], brown, 51, { rough: 0.06, tone: 0.08, low: 0.8 });
      lump(m, [0.34, 0.46, 0], [0.13, 0.11, 0.1], white, 52, { rough: 0.04, low: 0.92 });
      m.tri([0.44, 0.46, 0.03], [0.44, 0.46, -0.03], [0.56, 0.42, 0], yellow, [0.3, 0.46, 0]);
      fin(m, [-0.3, 0.42, 0.08], [-0.3, 0.42, -0.08], [-0.58, 0.4, 0], white);
      const flap = pose === 'walk1' ? 0.42 : pose === 'walk2' ? -0.22 : flying ? 0.1 : -0.34;
      const span = flying ? 1.05 : 0.34;
      for (const s of [1, -1]) {
        fin(m, [0.16, 0.46, s * 0.1], [-0.2, 0.46, s * 0.1], [0, 0.46 + flap * span * 0.5, s * span * 0.55], brown);
        fin(m, [0.04, 0.46 + flap * span * 0.5, s * span * 0.55], [-0.2, 0.46 + flap * span * 0.5, s * span * 0.55], [-0.14, 0.46 + flap * span, s * span], shade(brown, 0.86));
      }
      if (!flying) for (const s of [1, -1]) limb(m, [0, 0.3, s * 0.06], [0.02, 0, s * 0.07], 0.022, 0.014, yellow, 3, 1, 0.9);
      data = m.build(); break;
    }
    case 'cardume': {
      const m = new Model(), rand = sequence(53), body = rgb(112, 140, 164);
      for (let k = 0; k < 9; k++) {
        const x = (rand() - 0.5) * 1.1, z = (rand() - 0.5) * 0.9, l = 0.13 + rand() * 0.05, w = 0.04, c = shade(body, 0.9 + rand() * 0.25);
        m.blade([x + l, 0.04, z], [x - l * 0.2, 0.04, z + w], [x - l * 0.2, 0.04, z - w], c);
        m.blade([x - l * 0.2, 0.04, z + w], [x - l * 0.2, 0.04, z - w], [x - l, 0.04, z], c);
        m.blade([x - l, 0.04, z], [x - l * 1.4, 0.04, z + w], [x - l * 1.4, 0.04, z - w], c);
      }
      data = m.build(); break;
    }
    case 'baleia': {
      const m = new Model(), c = rgb(44, 66, 112);
      spindle(m, 2.5, 0.62, c, rgb(214, 216, 216)); capEnds(m, 2.5, 0.62, c, 1); flukes(m, -2.4, 0.7, 0.55, c);
      fin(m, [0.7, -0.1, 0.5], [0.2, -0.2, 0.5], [0.1, -0.3, 1.25], c); fin(m, [0.7, -0.1, -0.5], [0.2, -0.2, -0.5], [0.1, -0.3, -1.25], c);
      data = m.build(); break;
    }
    case 'cachalote': {
      const m = new Model(), c = rgb(112, 112, 116);
      spindle(m, 2.2, 0.55, c, rgb(150, 148, 146), 3); capEnds(m, 2.2, 0.55, c, 3); flukes(m, -2.15, 0.62, 0.48, c);
      data = m.build(); break;
    }
    case 'tubarao': {
      const m = new Model(), c = rgb(112, 124, 134);
      spindle(m, 1.2, 0.26, c, rgb(226, 228, 226)); capEnds(m, 1.2, 0.26, c, 1); fin(m, [0.1, 0.22, 0], [-0.26, 0.22, 0], [-0.24, 0.62, 0], c);
      fin(m, [-1.1, 0, 0], [-1.42, 0.42, 0], [-1.3, 0, 0], c); fin(m, [-1.1, 0, 0], [-1.36, -0.24, 0], [-1.3, 0, 0], c);
      fin(m, [0.3, -0.1, 0.2], [0, -0.14, 0.22], [-0.1, -0.16, 0.6], c); fin(m, [0.3, -0.1, -0.2], [0, -0.14, -0.22], [-0.1, -0.16, -0.6], c);
      data = m.build(); break;
    }
    case 'lula': { const m = new Model(); squid(m, 0.42, 0.13, rgb(196, 112, 84), 55); data = m.build(); break; }
    case 'lulaGigante': { const m = new Model(); squid(m, 1.4, 0.36, rgb(164, 62, 52), 57); data = m.build(); break; }
  }
  rigs.set(a, rigOut);
  if (SWIMMERS.has(a)) {
    if (pose === 'dead') {
      // Boia de lado.
      const c = Math.cos(1.2), s = Math.sin(1.2), out = new Float32Array(data);
      for (let o = 0; o < out.length; o += MODEL_FLOATS) { const y = out[o + 1] as number, z = out[o + 2] as number, ny = out[o + 4] as number, nz = out[o + 5] as number; out[o + 1] = c * y - s * z; out[o + 2] = s * y + c * z; out[o + 4] = c * ny - s * nz; out[o + 5] = s * ny + c * nz; }
      data = out;
    }
    return data;
  }
  return pose === 'dead' ? lieDown(data) : data;
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
  [Biome.ShallowOcean]: [['cardume', 6, 12], ['tubarao', 1, 2]],
  [Biome.DeepOcean]: [['baleia', 1, 3], ['cachalote', 1, 3], ['cardume', 6, 12]],
};
