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
  /** Rio: só aqui um degrau no nível da água vira cachoeira. */
  river: Float32Array;
  /** Encosta de terraço: terra à mostra. */
  bank: Float32Array;
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
  /**
   * Terraços (`bioma/degraus-e-rampas.png`, blocos 4 e 5). `u` é a coordenada do patamar: a parte inteira é o nível.
   * A altura de um vértice no nível `L` é `keep × levelY(L, steps, phase) + add`: `keep` 0 solta o chão do patamar (praia, rio, cume), `add` soma o que não é degrau.
   */
  u: Float32Array;
  /** De quantos em quantos níveis há degrau: 1 no chão comum, 3 na montanha e no deserto. */
  steps: Uint8Array;
  /** Nível em que os degraus largos começam a contar (o chão ao pé da montanha). */
  phase: Int16Array;
  keep: Float32Array;
  add: Float32Array;
  /** Do que é a parede do degrau: 0 terra, 1 rocha, 2 arenito, 3 neve. */
  wall: Uint8Array;
  /** Patamar de grama da montanha e neve do cume: a cor do chão não vem do bioma. 0 nada, 1 patamar, 2 neve. */
  cap: Uint8Array;
  /** Para onde `u` cresce, por vértice (calculado por `prepareSteps`). */
  gradX: Float32Array;
  gradZ: Float32Array;
  /** Ligado por quem preenche `u`: sem isso a malha usa só `y` (réplica da folha-mestra). */
  stepped: boolean;
}

/** Altura de um degrau comum e altura do primeiro patamar, logo acima da praia. */
export const TERRACE = 0.85, TERRACE_BASE = 0.2;
/** Altura do patamar `level` para quem tem degrau a cada `stride` níveis. */
export function levelY(level: number, stride: number, phase = 0): number {
  // Abaixo de `phase` (o nível do chão ao pé da montanha) os degraus são os comuns: a montanha não cava um fosso em volta.
  return TERRACE_BASE + (stride === 1 || level < phase ? level : phase + Math.floor((level - phase) / stride) * stride) * TERRACE;
}
/** Altura do vértice `k` se ele estivesse no nível `level`. */
export function heightAtLevel(f: Fields, k: number, level: number): number {
  return (f.keep[k] as number) * levelY(level, f.steps[k] as number, f.phase[k] as number) + (f.add[k] as number);
}

export function newFields(size: number, margin: number): Fields {
  const stride = size + 1 + margin * 2, count = stride * stride;
  const a = () => new Float32Array(count);
  return { size, margin, stride, y: a(), water: new Float32Array(count).fill(-Infinity), r: a(), g: a(), b: a(), sand: a(), marsh: a(), river: a(), bank: a(), peak: a(), wr: new Float32Array(count).fill(WATER_DEEP[0]), wg: new Float32Array(count).fill(WATER_DEEP[1]), wb: new Float32Array(count).fill(WATER_DEEP[2]), shade: new Float32Array(count).fill(1), jx: a(), jz: a(), u: a(), steps: new Uint8Array(count).fill(1), phase: new Int16Array(count), keep: a(), add: a(), wall: new Uint8Array(count), cap: new Uint8Array(count), gradX: a(), gradZ: a(), stepped: false };
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
  const bank = ((f.bank[a] as number) + (f.bank[b] as number) + (f.bank[c] as number)) * third;
  if ((ny < 0.8 || bank > 0.6) && sand < 0.3 && (f.marsh[a] as number) < 0.5) {
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

const ROCK_A = rgb(124, 98, 84), ROCK_B = rgb(150, 122, 106), ROCK_C = rgb(98, 78, 70);
const SANDSTONE_A = rgb(196, 142, 92), SANDSTONE_B = rgb(160, 110, 76);
const SNOW_WALL = rgb(226, 232, 240), LEDGE_GRASS = rgb(118, 158, 66), SNOW_TOP = rgb(244, 246, 250);

/** Um ponto dentro do triângulo: pesos dos três vértices. */
type Bary = readonly [number, number, number];

/** Corta o polígono onde `u` fica do lado pedido do limite (Sutherland-Hodgman, com `u` linear no triângulo). */
function clip(poly: readonly Bary[], ua: number, ub: number, uc: number, limit: number, keepAbove: boolean): Bary[] {
  const out: Bary[] = [];
  const uOf = (p: Bary): number => p[0] * ua + p[1] * ub + p[2] * uc;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Bary, q = poly[(i + 1) % poly.length] as Bary;
    const up = uOf(p), uq = uOf(q), inP = keepAbove ? up >= limit : up < limit, inQ = keepAbove ? uq >= limit : uq < limit;
    if (inP) out.push(p);
    if (inP !== inQ) {
      const t = (limit - up) / (uq - up);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out;
}

/**
 * Triângulo do chão em terraços: cada faixa de nível vira um patamar plano e, em cada troca de nível, uma parede de terra (ou de rocha) com a base um pouco à frente.
 * As contas usam só valores dos vértices e das arestas, então o triângulo vizinho chega ao mesmo ponto: sem fresta e sem lasca solta.
 */
function steppedTriangle(out: VertexOut, f: Fields, a: number, b: number, c: number, ox: number, oz: number, seedX: number, seedZ: number): void {
  const s = f.stride, m = f.margin;
  const ids = [a, b, c] as const;
  const gx = (i: number) => (i % s) - m + ox, gz = (i: number) => Math.floor(i / s) - m + oz;
  const X = ids.map((i) => gx(i) + (f.jx[i] as number)), Z = ids.map((i) => gz(i) + (f.jz[i] as number));
  const U = ids.map((i) => f.u[i] as number);
  const ua = U[0] as number, ub = U[1] as number, uc = U[2] as number;
  const lo = Math.floor(Math.min(ua, ub, uc)), hi = Math.floor(Math.max(ua, ub, uc));
  const jitter = hash3(seedX, seedZ, 3) * 2 - 1;
  const third = 1 / 3, j = 1 + jitter * 0.018;
  let r = ((f.r[a] as number) + (f.r[b] as number) + (f.r[c] as number)) * third * j;
  let g = ((f.g[a] as number) + (f.g[b] as number) + (f.g[c] as number)) * third * j;
  let bl = ((f.b[a] as number) + (f.b[b] as number) + (f.b[c] as number)) * third * j;
  r = Math.min(1, r); g = Math.min(1, g); bl = Math.min(1, bl);
  const ground: Rgb = [r, g, bl], snowTone = 0.95 + jitter * 0.05, ledgeTone = 0.9 + jitter * 0.1;
  const snowColor: Rgb = [SNOW_TOP[0] * snowTone, SNOW_TOP[1] * snowTone, SNOW_TOP[2] * snowTone], ledgeColor: Rgb = [LEDGE_GRASS[0] * ledgeTone, LEDGE_GRASS[1] * ledgeTone, LEDGE_GRASS[2] * ledgeTone];
  const keepMean = ((f.keep[a] as number) + (f.keep[b] as number) + (f.keep[c] as number)) * third;
  /** Neve ou grama do patamar: decide o vértice que está naquela faixa (o mais perto dela, se nenhum estiver). */
  const capOf = (level: number, next: number): number => {
    let best = 0, gap = Infinity;
    for (let q = 0; q < 3; q++) {
      const uq = U[q] as number, d = uq < level ? level - uq : uq >= next ? uq - next + 1e-6 : 0;
      if (d < gap || (d === gap && (f.cap[ids[q] as number] as number) > best)) { gap = d; best = f.cap[ids[q] as number] as number; }
    }
    return best;
  };
  const marsh = (f.marsh[a] as number) >= 0.5;
  const at = (p: Bary, arr: Float32Array): number => p[0] * (arr[a] as number) + p[1] * (arr[b] as number) + p[2] * (arr[c] as number);
  const px = (p: Bary): number => p[0] * (X[0] as number) + p[1] * (X[1] as number) + p[2] * (X[2] as number);
  const pz = (p: Bary): number => p[0] * (Z[0] as number) + p[1] * (Z[1] as number) + p[2] * (Z[2] as number);
  const py = (p: Bary, level: number): number => p[0] * heightAtLevel(f, a, level) + p[1] * heightAtLevel(f, b, level) + p[2] * heightAtLevel(f, c, level);

  /** Um triângulo com a frente para o lado de `(dx, dy, dz)`. */
  const emit = (p: readonly [number, number, number][], dx: number, dy: number, dz: number, mask: readonly number[], col: Rgb, light: readonly number[]): void => {
    const A = p[0] as readonly [number, number, number], B = p[1] as readonly [number, number, number], C = p[2] as readonly [number, number, number];
    let nx = (B[2] - A[2]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[2] - A[2]);
    let ny = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
    let nz = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    const flip = nx * dx + ny * dy + nz * dz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    // A frente do triângulo é o lado para onde esta conta NÃO aponta (mesma ordem do resto da malha).
    for (const q of flip ? [0, 1, 2] : [0, 2, 1]) { const v = p[q] as readonly [number, number, number]; out.push(v[0], v[1], v[2], nx, ny, nz, mask[q] as number, col[0], col[1], col[2], light[q] as number); }
  };

  /** Patamar: o polígono da faixa, na altura do nível. */
  const flat = (poly: readonly Bary[], level: number, next: number): void => {
    if (poly.length < 3) return;
    const cap = capOf(level, next), snowy = cap === 2;
    const col = snowy ? snowColor : cap === 1 ? ledgeColor : ground;
    const pts = poly.map((p) => [px(p), py(p, level), pz(p)] as [number, number, number]);
    const sand = poly.map((p) => at(p, f.sand)), shade = poly.map((p) => at(p, f.shade));
    for (let i = 1; i + 1 < pts.length; i++) {
      const tri = [pts[0], pts[i], pts[i + 1]] as [number, number, number][];
      const [A, B, C] = tri as [[number, number, number], [number, number, number], [number, number, number]];
      // Chão solto e íngreme (margem de rio, costa alta): terra à mostra.
      const nyRaw = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
      const nl = Math.hypot((B[2] - A[2]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[2] - A[2]), nyRaw, (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1])) || 1;
      const steep = keepMean < 0.5 && Math.abs(nyRaw) / nl < 0.8 && ((sand[0] as number) + (sand[i] as number) + (sand[i + 1] as number)) / 3 < 0.3 && !marsh && cap === 0;
      if (steep) {
        const band = (A[1] + B[1] + C[1]) / 3 + hash3(seedX, 7, 1) * 0.5, e = band > 1.2 ? EARTH_TOP : band > 0 ? EARTH_MID : EARTH_LOW, k = 0.93 + jitter * 0.09;
        emit(tri, 0, 1, 0, [0, 0, 0], [e[0] * k, e[1] * k, e[2] * k], [shade[0] as number, shade[i] as number, shade[i + 1] as number]);
      } else emit(tri, 0, 1, 0, snowy ? [-1, -1, -1] : [sand[0] as number, sand[i] as number, sand[i + 1] as number], col, [shade[0] as number, shade[i] as number, shade[i + 1] as number]);
    }
  };

  if (lo === hi) { flat([[1, 0, 0], [0, 1, 0], [0, 0, 1]], lo, lo + 1); return; }
  // Só conta a troca de nível que muda a altura de algum vértice (na montanha, uma a cada três).
  const cuts: number[] = [];
  for (let t = lo + 1; t <= hi; t++) {
    if (Math.abs(heightAtLevel(f, a, t) - heightAtLevel(f, a, t - 1)) > 1e-4 || Math.abs(heightAtLevel(f, b, t) - heightAtLevel(f, b, t - 1)) > 1e-4 || Math.abs(heightAtLevel(f, c, t) - heightAtLevel(f, c, t - 1)) > 1e-4) cuts.push(t);
  }
  const whole: Bary[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let rest: Bary[] = whole;
  let level = lo;
  for (const t of cuts) {
    flat(clip(rest, ua, ub, uc, t, false), level, t);
    rest = clip(rest, ua, ub, uc, t, true);
    level = t;
  }
  flat(rest, level, hi + 1);

  // Paredes: uma por troca de nível, entre os dois pontos em que a curva de nível corta as arestas.
  const edges: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 0]];
  for (const t of cuts) {
    const ends: { p: Bary; run: number; ex: number; ez: number }[] = [];
    for (const [e0, e1] of edges) {
      const u0 = U[e0] as number, u1 = U[e1] as number;
      if ((u0 < t) === (u1 < t)) continue;
      const k = (t - u0) / (u1 - u0), w: [number, number, number] = [0, 0, 0];
      w[e0] = 1 - k; w[e1] = k;
      // O mesmo sorteio para os dois triângulos que dividem a aresta.
      const i0 = ids[e0] as number, i1 = ids[e1] as number;
      const hx = gx(i0) + gx(i1), hz = gz(i0) + gz(i1);
      // Ao longo da aresta, o lado baixo é conhecido: serve de garantia quando o gradiente dos vértices aponta para o lado errado (crista, sela).
      const lowFirst = u0 < t, ex = ((X[lowFirst ? e0 : e1] as number) - (X[lowFirst ? e1 : e0] as number)), ez = ((Z[lowFirst ? e0 : e1] as number) - (Z[lowFirst ? e1 : e0] as number));
      ends.push({ p: w, run: 0.9 + hash3(hx, hz, 71 + t) * 0.2, ex, ez });
    }
    if (ends.length !== 2) continue;
    // Do que é a parede: quem decide é o patamar de baixo (rocha debaixo da neve, terra debaixo da grama).
    let wallKind = -1;
    for (let q = 0; q < 3; q++) if ((U[q] as number) < t) wallKind = Math.max(wallKind, f.wall[ids[q] as number] as number);
    const quad = ends.map((e) => {
      const top = py(e.p, t), bottom = py(e.p, t - 1), h = top - bottom;
      // Para onde o terreno desce: do gradiente de `u` nos vértices.
      let dx = -at(e.p, f.gradX), dz = -at(e.p, f.gradZ);
      const dl = Math.hypot(dx, dz), el = Math.hypot(e.ex, e.ez) || 1;
      if (dl < 1e-6 || (dx * e.ex + dz * e.ez) / (dl * el) < 0.25) { dx = e.ex / el; dz = e.ez / el; } else { dx /= dl; dz /= dl; }
      const lean = (wallKind === 1 ? 0.34 : wallKind === 3 ? 0.4 : 0.42) * h * e.run;
      const x = px(e.p), z = pz(e.p);
      return { x, z, top, bottom, h, dx, dz, bx: x + dx * lean, bz: z + dz * lean, shade: at(e.p, f.shade) };
    });
    const [P, Q] = quad as [(typeof quad)[number], (typeof quad)[number]];
    if (P.h < 0.03 && Q.h < 0.03) continue;
    const dx = P.dx + Q.dx, dz = P.dz + Q.dz;
    const tone = hash3(seedX + t * 13, seedZ, 9), tone2 = hash3(seedX, seedZ + t * 7, 11);
    const colors = (row: number): [Rgb, Rgb] => {
      if (wallKind === 3) return [[SNOW_WALL[0] * (0.93 + tone * 0.07), SNOW_WALL[1] * (0.93 + tone * 0.07), SNOW_WALL[2] * (0.95 + tone * 0.05)], [SNOW_WALL[0] * (0.9 + tone2 * 0.08), SNOW_WALL[1] * (0.9 + tone2 * 0.08), SNOW_WALL[2] * (0.93 + tone2 * 0.06)]];
      if (wallKind === 1) {
        const pick = (h: number): Rgb => { const base = h < 0.4 ? ROCK_A : h < 0.75 ? ROCK_B : ROCK_C, k = (row ? 0.84 : 1) * (0.9 + h * 0.2); return [base[0] * k, base[1] * k, base[2] * k]; };
        return [pick(tone), pick(tone2)];
      }
      const base = wallKind === 2 ? (row ? SANDSTONE_B : SANDSTONE_A) : row ? EARTH_MID : EARTH_TOP;
      return [[base[0] * (0.93 + tone * 0.12), base[1] * (0.93 + tone * 0.12), base[2] * (0.93 + tone * 0.12)], [base[0] * (0.93 + tone2 * 0.12), base[1] * (0.93 + tone2 * 0.12), base[2] * (0.93 + tone2 * 0.12)]];
    };
    // Parede alta em duas fileiras: a de baixo mais escura, com a dobra saindo um pouco (rocha facetada, camadas de terra).
    const rows = Math.max(P.h, Q.h) > 1.3 ? 2 : 1;
    const mask = [0, 0, 0];
    for (let row = 0; row < rows; row++) {
      const t0 = row / rows, t1 = (row + 1) / rows, bulge = rows === 2 ? 0.12 : 0;
      const pt = (e: (typeof quad)[number], k: number): [number, number, number] => {
        const out2 = k === 0 ? 0 : k === 1 ? 1 : k + bulge;
        return [e.x + (e.bx - e.x) * out2, e.top - e.h * k - (k === 1 ? 0.03 : 0), e.z + (e.bz - e.z) * out2];
      };
      const p0 = pt(P, t0), q0 = pt(Q, t0), p1 = pt(P, t1), q1 = pt(Q, t1);
      const l0 = 1 - t0 * 0.16, l1 = 1 - t1 * 0.16;
      const [c0, c1] = colors(row);
      emit([p0, q0, q1], dx, 0.3, dz, mask, c0, [P.shade * l0, Q.shade * l0, Q.shade * l1]);
      emit([p0, q1, p1], dx, 0.3, dz, mask, c1, [P.shade * l0, Q.shade * l1, P.shade * l1]);
    }
  }
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

/**
 * Tira as lascas: crista ou vala fina (menos de 3 vértices de largura) que mal cruza um nível viraria um risco de terra solto no chão.
 * Abertura e fechamento de `u` numa vizinhança de 3×3: onde a faixa fina some, o vértice fica logo abaixo (ou acima) do nível.
 */
function dropSlivers(f: Fields): void {
  const s = f.stride, n = s * s, u = f.u;
  const pass = (src: Float32Array, dst: Float32Array, max: boolean): void => {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      let v = src[j * s + i] as number;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        const q = src[y * s + x] as number;
        if (max ? q > v : q < v) v = q;
      }
      dst[j * s + i] = v;
    }
  };
  const t1 = new Float32Array(n), opened = new Float32Array(n), closed = new Float32Array(n);
  pass(u, t1, false); pass(t1, opened, true);
  for (let k = 0; k < n; k++) { const top = Math.floor(opened[k] as number) + 1; if ((u[k] as number) >= top) u[k] = top - 0.001; }
  pass(u, t1, true); pass(t1, closed, false);
  for (let k = 0; k < n; k++) { const low = Math.floor(closed[k] as number); if ((u[k] as number) < low) u[k] = low + 0.001; }
}

/** Depois de preencher `u`, `keep` e `add`: grava a altura final em `y` e o lado para onde cada vértice desce. */
export function prepareSteps(f: Fields): void {
  const s = f.stride;
  f.stepped = true;
  dropSlivers(f);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const k = j * s + i;
    f.y[k] = heightAtLevel(f, k, Math.floor(f.u[k] as number));
    const l = i > 0 ? k - 1 : k, r = i < s - 1 ? k + 1 : k, d = j > 0 ? k - s : k, up = j < s - 1 ? k + s : k;
    f.gradX[k] = (f.u[r] as number) - (f.u[l] as number);
    f.gradZ[k] = (f.u[up] as number) - (f.u[d] as number);
  }
}

/** Altura do chão desenhado num ponto do pedaço (em células finas, a partir do canto), com os degraus: é onde a planta e o animal pisam. */
export function surfaceY(f: Fields, lx: number, lz: number): number {
  const s = f.stride, m = f.margin;
  const i = Math.max(0, Math.min(s - 2, Math.floor(lx) + m)), j = Math.max(0, Math.min(s - 2, Math.floor(lz) + m));
  const tx = Math.max(0, Math.min(1, lx + m - i)), tz = Math.max(0, Math.min(1, lz + m - j));
  const a = j * s + i, b = a + 1, d = a + s, c = d + 1;
  if (!f.stepped) return ((f.y[a] as number) * (1 - tx) + (f.y[b] as number) * tx) * (1 - tz) + ((f.y[d] as number) * (1 - tx) + (f.y[c] as number) * tx) * tz;
  const wa = (1 - tx) * (1 - tz), wb = tx * (1 - tz), wc = tx * tz, wd = (1 - tx) * tz;
  const level = Math.floor(wa * (f.u[a] as number) + wb * (f.u[b] as number) + wc * (f.u[c] as number) + wd * (f.u[d] as number));
  return wa * heightAtLevel(f, a, level) + wb * heightAtLevel(f, b, level) + wc * heightAtLevel(f, c, level) + wd * heightAtLevel(f, d, level);
}

/** Malha do chão. */
export function buildTerrain(f: Fields, ox: number, oz: number, seed: number, facets: readonly Facet[] = []): ArrayBuffer {
  const out = new VertexOut(f.size * f.size * 6);
  const s = f.stride, m = f.margin;
  for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) {
    const a = (j + m) * s + i + m, b = a + 1, d = a + s, c = d + 1;
    // Fundo do mar coberto de água: ninguém vê.
    const hide = (q: number): boolean => (f.water[q] as number) > (f.y[q] as number) + 0.35;
    // Só esconde o fundo se a água for mesmo desenhada ali: onde dois níveis se encontram (lago junto do mar) a água não fecha, e sem o fundo ficava um buraco.
    const wMax = Math.max(f.water[a] as number, f.water[b] as number, f.water[c] as number, f.water[d] as number), wMin = Math.min(f.water[a] as number, f.water[b] as number, f.water[c] as number, f.water[d] as number);
    if (hide(a) && hide(b) && hide(c) && hide(d) && wMax - wMin <= 0.25 && !(f.marsh[a] as number)) continue;
    const hx = seed * 31 + ox + i, hz = oz + j;
    // A diagonal segue a curva de nível: costa e barranco sem serra.
    const ac = Math.abs((f.y[a] as number) - (f.y[c] as number)), bd = Math.abs((f.y[b] as number) - (f.y[d] as number));
    const tri = f.stepped ? steppedTriangle : terrainTriangle;
    if (ac < bd || (ac === bd && hash3(hx, hz, 5) < 0.5)) {
      tri(out, f, a, c, b, ox, oz, hx, hz * 2);
      tri(out, f, a, d, c, ox, oz, hx, hz * 2 + 1);
    } else {
      tri(out, f, a, d, b, ox, oz, hx, hz * 2);
      tri(out, f, b, d, c, ox, oz, hx, hz * 2 + 1);
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
    // Vértice sem água própria: a água emprestada do vizinho nunca fica no ar, acima do chão dele.
    return Math.min(best, (f.y[i] as number) + 0.02);
  };
  const tri = (a: number, b: number, c: number, wa: number, wb: number, wc: number): void => {
    // Lago encostado no mar, ou em outro nível: nada de parede de água; aparece a margem de terra entre eles.
    if (Math.max(wa, wb, wc) - Math.min(wa, wb, wc) > 0.25 && !((f.river[a] as number) && (f.river[b] as number) && (f.river[c] as number))) return;
    const ax = px(a), az = pz(a), bx = px(b), bz = pz(b), cx = px(c), cz = pz(c);
    let nx = (bz - az) * (wc - wa) - (wb - wa) * (cz - az);
    let ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    let nz = (wb - wa) * (cx - ax) - (bx - ax) * (wc - wa);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const fall = ny < 0.85;
    for (const [i, w] of [[a, wa], [b, wb], [c, wc]] as const) {
      const depth = Math.max(0, Math.min(1, (w - (f.y[i] as number)) / 0.55));
      const mk = f.marsh[i] as number;
      const r = fall ? FALL[0] : (shallow[0] + ((f.wr[i] as number) - shallow[0]) * depth) * (1 - mk) + MARSH[0] * mk;
      const g = fall ? FALL[1] : (shallow[1] + ((f.wg[i] as number) - shallow[1]) * depth) * (1 - mk) + MARSH[1] * mk;
      const b2 = fall ? FALL[2] : (shallow[2] + ((f.wb[i] as number) - shallow[2]) * depth) * (1 - mk) + MARSH[2] * mk;
      out.push(px(i), w, pz(i), nx, ny, nz, fall ? 1 : 0, r, g, b2, 1);
    }
  };
  // Mar aberto: blocos de 4 células num só par de triângulos, com a mesma cor nos cantos.
  const block = 4, flat = new Uint8Array(f.size * f.size);
  for (let bj = 0; bj + block <= f.size; bj += block) for (let bi = 0; bi + block <= f.size; bi += block) {
    let ok = true;
    const w0 = f.water[(bj + m) * s + bi + m] as number;
    for (let j = bj; j <= bj + block && ok; j++) for (let i = bi; i <= bi + block; i++) {
      const q = (j + m) * s + i + m, w = f.water[q] as number;
      if (w !== w0 || w === -Infinity || w - (f.y[q] as number) < 1.15 || (f.marsh[q] as number) > 0) { ok = false; break; }
    }
    if (!ok) continue;
    for (let j = bj; j < bj + block; j++) for (let i = bi; i < bi + block; i++) flat[j * f.size + i] = 1;
    const a = (bj + m) * s + bi + m, b = a + block, d = a + block * s, c = d + block;
    tri(a, c, b, w0, w0, w0);
    tri(a, d, c, w0, w0, w0);
  }
  // Emenda do bloco com as células soltas ao lado: os vértices do meio do lado saem da linha reta (o deslocamento lateral) e abriam frestas no mar.
  const isFlat = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < f.size && j < f.size && flat[j * f.size + i] === 1;
  for (let bj = 0; bj + block <= f.size; bj += block) for (let bi = 0; bi + block <= f.size; bi += block) {
    if (!flat[bj * f.size + bi]) continue;
    const w0 = f.water[(bj + m) * s + bi + m] as number, at = (i: number, j: number): number => (j + m) * s + i + m;
    const seam = (start: number, step: number): void => { for (let q = 1; q + 1 <= block; q++) tri(start, start + step * q, start + step * (q + 1), w0, w0, w0); };
    if (!isFlat(bi, bj - 1)) seam(at(bi, bj), 1);
    if (!isFlat(bi, bj + block)) seam(at(bi, bj + block), 1);
    if (!isFlat(bi - 1, bj)) seam(at(bi, bj), s);
    if (!isFlat(bi + block, bj)) seam(at(bi + block, bj), s);
  }
  for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) {
    if (flat[j * f.size + i]) continue;
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
  /** Não balança ao vento (pedra, jazida, gelo). */
  rigid?: boolean;
  /** O mesmo modelo, simplificado, para ver de longe. */
  far?: Float32Array;
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
export function bakeProps(list: readonly Placement[], lod = false): ArrayBuffer {
  let total = 0;
  for (const p of list) total += (lod ? p.far ?? p.model : p.model).length / MODEL_FLOATS;
  const out = new VertexOut(Math.max(1, total));
  for (const p of list) {
    const m = lod ? p.far ?? p.model : p.model, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (let o = 0; o < m.length; o += MODEL_FLOATS) {
      const x = (m[o] as number) * p.scale, y = (m[o + 1] as number) * p.scale * p.stretch, z = (m[o + 2] as number) * p.scale;
      const nx = m[o + 3] as number, ny = m[o + 4] as number, nz = m[o + 5] as number;
      out.push(c * x + s * z + p.x, y + p.y, -s * x + c * z + p.z, c * nx + s * nz, ny, -s * nx + c * nz, p.rigid ? 0 : Math.min(1, y / 5), (m[o + 6] as number) * p.tint[0], (m[o + 7] as number) * p.tint[1], (m[o + 8] as number) * p.tint[2], m[o + 9] as number);
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
