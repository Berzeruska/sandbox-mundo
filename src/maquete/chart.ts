import { FACES, faceCoordToPoint, faceOfPoint, type Vec3 } from '../world/cubesphere';

/**
 * Mapa plano em volta de uma face do cubo, para os pedaços atravessarem as arestas (T3).
 *
 * Cada pedaço é montado nas coordenadas da própria face (`X` = x fino, `Z` = N − y fino) e não depende de quem está olhando. O mapa só diz onde pôr cada
 * pedaço no plano: a face central fica como está e as 4 vizinhas abrem em volta dela, giradas de 90° em 90°. Como só gira, trocar de face central não refaz nenhum pedaço.
 * Nos cantos do cubo só 3 faces se encontram e sobra um quadrante vazio no plano: ele é preenchido copiando a aresta, em leque, e o pedaço vira "virtual".
 */
export const DETAIL = 4;
export const CHUNK_CELLS = 32;
/** Células grandes por lado de pedaço. */
export const CHUNK_COARSE = CHUNK_CELLS / DETAIL;

/** Direções na grade da face: +x, -x, +y, -y. */
const DIR: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface FaceLink {
  to: number;
  /** Eixos da face vizinha, escritos nos eixos (x, y) da face de origem, com ela aberta no plano. */
  ux: number;
  uy: number;
  vx: number;
  vy: number;
}

const dot = (a: Vec3 | readonly number[], b: Vec3 | readonly number[]) => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);

function computeLinks(): FaceLink[][] {
  return FACES.map((f) => DIR.map(([dx, dy]) => {
    const e: Vec3 = dx !== 0 ? [f.u[0] * dx, f.u[1] * dx, f.u[2] * dx] : [f.v[0] * dy, f.v[1] * dy, f.v[2] * dy];
    const t = dx !== 0 ? f.v : f.u;
    const to = FACES.findIndex((g) => g.n[0] === e[0] && g.n[1] === e[1] && g.n[2] === e[2]);
    const g = FACES[to] as (typeof FACES)[number];
    // Abrir a dobra: a direção ao longo da aresta fica; "descer" a face vizinha vira seguir em frente.
    const open = (w: Vec3): [number, number] => {
      const a = dot(w, t), b = -dot(w, f.n);
      return dx !== 0 ? [b * dx, a] : [a, b * dy];
    };
    const [ux, uy] = open(g.u), [vx, vy] = open(g.v);
    return { to, ux, uy, vx, vy };
  }));
}

export const FACE_LINKS: readonly (readonly FaceLink[])[] = computeLinks();

/** Ponto da grade fina da face central (pode passar da borda) → face real e posição nela. `fan` = caiu no quadrante vazio do canto. */
export interface FinePoint { face: number; x: number; y: number; fan: boolean }

export function resolveFine(face: number, x: number, y: number, size: number): FinePoint {
  let fan = false;
  // Nos dois lados ao mesmo tempo: leque. O ponto escorrega para a aresta da vizinha em x.
  const overX = x < 0 ? -x : x > size ? x - size : 0, overY = y < 0 ? -y : y > size ? y - size : 0;
  if (overX > 0 && overY > 0) {
    const r = Math.hypot(overX, overY);
    x = x < 0 ? -r : size + r;
    y = y < 0 ? 0 : size;
    fan = true;
  }
  let dir = -1;
  if (x < 0) dir = 1; else if (x > size) dir = 0; else if (y < 0) dir = 3; else if (y > size) dir = 2;
  if (dir < 0) return { face, x, y, fan };
  const l = (FACE_LINKS[face] as readonly FaceLink[])[dir] as FaceLink, d = DIR[dir] as readonly [number, number];
  const cx = x - size / 2 - d[0] * size, cy = y - size / 2 - d[1] * size;
  return { face: l.to, x: cx * l.ux + cy * l.uy + size / 2, y: cx * l.vx + cy * l.vy + size / 2, fan };
}

/** Índice da célula grande, mesmo fora da face (vizinha, ou leque no canto). */
export function coarseIndex(n: number, face: number, cx: number, cy: number): number {
  if (cx >= 0 && cy >= 0 && cx < n && cy < n) return face * n * n + cy * n + cx;
  const p = resolveFine(face, cx + 0.5, cy + 0.5, n);
  const x = Math.max(0, Math.min(n - 1, Math.floor(p.x))), y = Math.max(0, Math.min(n - 1, Math.floor(p.y)));
  return p.face * n * n + y * n + x;
}

/** Onde pôr um pedaço no plano: x, z, cos e sin do giro. Mesma fórmula do desenho: X = x + cos·X₀ + sin·Z₀; Z = z − sin·X₀ + cos·Z₀. */
export type Place = readonly [number, number, number, number];

export const IDENTITY_PLACE: Place = [0, 0, 1, 0];

/** O pedaço que ocupa a posição (`pcx`, `pcz`) no plano da face central. */
export interface ChartChunk {
  /** Chave única do pedaço. */
  key: number;
  face: number;
  cx: number;
  cz: number;
  place: Place;
  /** Quantos quartos de volta ele está girado no plano, para saber que lado dá para onde. */
  turns: number;
}

export function chunkKey(face: number, cx: number, cz: number): number {
  return (face + 1) * 1_000_000 + (cz + 256) * 512 + cx + 256;
}

/** Pedaço virtual do canto do cubo: depende da face central. */
const virtualKey = (chart: number, pcx: number, pcz: number): number => (chart + 1) * 100_000_000 + (pcz + 256) * 512 + pcx + 256;

export function chartChunk(chart: number, pcx: number, pcz: number, n: number): ChartChunk {
  const per = (n * DETAIL) / CHUNK_CELLS, size = n * DETAIL;
  const inX = pcx >= 0 && pcx < per, inZ = pcz >= 0 && pcz < per;
  if (inX && inZ) return { key: chunkKey(chart, pcx, pcz), face: chart, cx: pcx, cz: pcz, place: IDENTITY_PLACE, turns: 0 };
  if (!inX && !inZ) return { key: virtualKey(chart, pcx, pcz), face: chart, cx: pcx, cz: pcz, place: IDENTITY_PLACE, turns: 0 };
  // Plano: Z = N − y. Sair por Z < 0 é sair por y > N.
  const dir = pcx >= per ? 0 : pcx < 0 ? 1 : pcz < 0 ? 2 : 3;
  const l = (FACE_LINKS[chart] as readonly FaceLink[])[dir] as FaceLink, d = DIR[dir] as readonly [number, number];
  const cos = l.ux, sin = l.uy;
  const half = size / 2;
  const tx = half + size * d[0] - half * cos + half * l.vx;
  const tz = half - size * d[1] + half * sin - half * l.vy;
  // Pedaço no plano central → pedaço na vizinha (inverso do giro).
  const x0 = pcx * CHUNK_CELLS + CHUNK_CELLS / 2 - tx, z0 = pcz * CHUNK_CELLS + CHUNK_CELLS / 2 - tz;
  const lx = cos * x0 - sin * z0, lz = sin * x0 + cos * z0;
  const cx = Math.floor(lx / CHUNK_CELLS), cz = Math.floor(lz / CHUNK_CELLS);
  const turns = cos === 1 ? 0 : sin === 1 ? 1 : cos === -1 ? 2 : 3;
  return { key: chunkKey(l.to, cx, cz), face: l.to, cx, cz, place: [tx, tz, cos, sin], turns };
}

/** Sobre a esfera: da face e posição fina para o ponto 3D. */
export function finePoint(face: number, x: number, y: number, size: number, out: Vec3 = [0, 0, 0]): Vec3 {
  return faceCoordToPoint(face, (x / size) * 2 - 1, (y / size) * 2 - 1, out);
}

/** Do ponto na esfera para a face e posição fina. */
export function pointToFine(p: readonly number[], size: number): { face: number; x: number; y: number } {
  const face = faceOfPoint(p[0] as number, p[1] as number, p[2] as number), f = FACES[face] as (typeof FACES)[number];
  const k = dot(p, f.n), a = Math.atan(dot(p, f.u) / k) / (Math.PI / 4), b = Math.atan(dot(p, f.v) / k) / (Math.PI / 4);
  return { face, x: ((a + 1) / 2) * size, y: ((b + 1) / 2) * size };
}

/** Da posição fina de uma face vizinha para o plano da face central; null se ela não encosta. */
export function fineToChart(chart: number, face: number, x: number, y: number, size: number): { X: number; Z: number } | null {
  if (face === chart) return { X: x, Z: size - y };
  const links = FACE_LINKS[chart] as readonly FaceLink[];
  for (let d = 0; d < 4; d++) {
    const l = links[d] as FaceLink;
    if (l.to !== face) continue;
    const dir = DIR[d] as readonly [number, number];
    const gx = x - size / 2, gy = y - size / 2;
    const cx = gx * l.ux + gy * l.vx + dir[0] * size + size / 2, cy = gx * l.uy + gy * l.vy + dir[1] * size + size / 2;
    return { X: cx, Z: size - cy };
  }
  return null;
}

/** Vetor no plano da face (x, y da grade) para o plano Z invertido. */
export function chartPointToSphere(chart: number, X: number, Z: number, size: number): Vec3 {
  const p = resolveFine(chart, X, size - Z, size);
  return finePoint(p.face, Math.max(0, Math.min(size, p.x)), Math.max(0, Math.min(size, p.y)), size);
}
