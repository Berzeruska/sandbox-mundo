import { newArray } from '../core/shared';
/**
 * Geometria do planeta: cubo de 6 faces, cada uma uma grade N × N, projetado na esfera.
 *
 * Coordenadas:
 * - célula: (face, x, y), com índice linear `face * N * N + y * N + x`;
 * - coordenada de face equiangular (a, b) em [-1, 1]: o ângulo, e não a distância no cubo,
 *   é dividido igualmente — isso deixa as células com tamanho parecido no globo todo;
 * - ponto 3D na esfera de raio 1; eixo Y é o norte (polo norte = (0, 1, 0)).
 *
 * Os polos ficam no centro das faces +Y e -Y: sem distorção nenhuma.
 */

export type Vec3 = [number, number, number];

export interface FaceFrame {
  /** Normal da face (centro dela na esfera). */
  n: Vec3;
  /** Eixo da coordenada `a` (x da grade). */
  u: Vec3;
  /** Eixo da coordenada `b` (y da grade). */
  v: Vec3;
}

/** As 6 faces. O shader do globo é gerado a partir desta tabela (não duplicar à mão). */
export const FACES: readonly FaceFrame[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, // 0: +X
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }, // 1: -X
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // 2: +Y (polo norte)
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] }, // 3: -Y (polo sul)
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, // 4: +Z
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // 5: -Z
];

export const FACE_COUNT = 6;

/** Direções dos vizinhos, na ordem guardada em `neighbors`: +x, -x, +y, -y. */
export const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const QUARTER_PI = Math.PI / 4;

function frame(face: number): FaceFrame {
  const f = FACES[face];
  if (!f) throw new Error(`Face inválida: ${face}`);
  return f;
}

/** Face cujo eixo domina o ponto (não precisa estar normalizado). */
export function faceOfPoint(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? 0 : 1;
  if (ay >= az) return y > 0 ? 2 : 3;
  return z > 0 ? 4 : 5;
}

/** Coordenada equiangular (a, b) → ponto na esfera. */
export function faceCoordToPoint(face: number, a: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { n, u, v } = frame(face);
  const cu = Math.tan(a * QUARTER_PI);
  const cv = Math.tan(b * QUARTER_PI);
  return cubeToSphere(n, u, v, cu, cv, out);
}

function cubeToSphere(n: Vec3, u: Vec3, v: Vec3, cu: number, cv: number, out: Vec3): Vec3 {
  const x = n[0] + cu * u[0] + cv * v[0];
  const y = n[1] + cu * u[1] + cv * v[1];
  const z = n[2] + cu * u[2] + cv * v[2];
  const len = Math.hypot(x, y, z);
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  return out;
}

/** Ponto (qualquer comprimento) → face e coordenada equiangular (a, b). */
export function pointToFaceCoord(x: number, y: number, z: number): { face: number; a: number; b: number } {
  const face = faceOfPoint(x, y, z);
  const { n, u, v } = frame(face);
  const dn = x * n[0] + y * n[1] + z * n[2];
  const cu = (x * u[0] + y * u[1] + z * u[2]) / dn;
  const cv = (x * v[0] + y * v[1] + z * v[2]) / dn;
  return { face, a: Math.atan(cu) / QUARTER_PI, b: Math.atan(cv) / QUARTER_PI };
}

/** Área (esferorradianos) do triângulo esférico de vértices unitários a, b, c. */
function sphericalTriangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const triple =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const bc = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
  const ca = c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
  return 2 * Math.atan2(Math.abs(triple), 1 + ab + bc + ca);
}

/** Ângulo (radianos) no vértice b entre os arcos b→a e b→c, medido no plano tangente. */
function cornerAngle(a: Vec3, b: Vec3, c: Vec3): number {
  const tangent = (q: Vec3): Vec3 => {
    const d = q[0] * b[0] + q[1] * b[1] + q[2] * b[2];
    return [q[0] - d * b[0], q[1] - d * b[1], q[2] - d * b[2]];
  };
  const u = tangent(a);
  const v = tangent(c);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v)))));
}

export type Projection = 'equiangular' | 'gnomonic';

/** Coordenada de face → coordenada no cubo, para cada projeção (só a equiangular é usada no jogo). */
function toCube(c: number, projection: Projection): number {
  return projection === 'equiangular' ? Math.tan(c * QUARTER_PI) : c;
}

/** Os 4 cantos de uma célula na esfera, em volta (sentido x+, depois y+). */
export function cellCorners(face: number, x: number, y: number, n: number, projection: Projection = 'equiangular'): Vec3[] {
  const { n: fn, u, v } = frame(face);
  const coord = (k: number): number => (k / n) * 2 - 1;
  return [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ].map(([cx, cy]) => cubeToSphere(fn, u, v, toCube(coord(cx as number), projection), toCube(coord(cy as number), projection), [0, 0, 0]));
}

/** Área da célula (esferorradianos) e seus 4 ângulos internos (radianos). */
export function cellShape(
  face: number,
  x: number,
  y: number,
  n: number,
  projection: Projection = 'equiangular',
): { area: number; angles: number[] } {
  const [a, b, c, d] = cellCorners(face, x, y, n, projection) as [Vec3, Vec3, Vec3, Vec3];
  return {
    area: sphericalTriangleArea(a, b, c) + sphericalTriangleArea(a, c, d),
    angles: [cornerAngle(d, a, b), cornerAngle(a, b, c), cornerAngle(b, c, d), cornerAngle(c, d, a)],
  };
}

/** Latitude e longitude em radianos. */
export function pointToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const len = Math.hypot(x, y, z);
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / len))), lon: Math.atan2(x, z) };
}

export function latLonToPoint(lat: number, lon: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(lat);
  out[0] = c * Math.sin(lon);
  out[1] = Math.sin(lat);
  out[2] = c * Math.cos(lon);
  return out;
}

/** Grade completa do planeta com resolução N, com posições e vizinhos pré-calculados. */
export class CubeSphere {
  readonly n: number;
  readonly cellCount: number;
  /** Centro de cada célula na esfera: x, y, z intercalados. */
  readonly positions: Float32Array;
  /** 4 vizinhos por célula, na ordem de `DIRS`. */
  readonly neighbors: Int32Array;
  /** Ângulo aproximado (radianos) entre centros de células vizinhas. */
  readonly cellAngle: number;

  private visitStamp: Uint32Array;
  private stamp = 0;

  /**
   * `shared`: posições e vizinhos já calculados por outro ajudante (mesma N), usados sem cópia.
   */
  constructor(n: number, shared?: { positions: Float32Array; neighbors: Int32Array }) {
    if (!Number.isInteger(n) || n < 2) throw new Error(`Resolução inválida: ${n}`);
    this.n = n;
    this.cellCount = FACE_COUNT * n * n;
    this.cellAngle = Math.PI / 2 / n;
    this.visitStamp = new Uint32Array(this.cellCount);
    if (shared) {
      if (shared.positions.length !== this.cellCount * 3 || shared.neighbors.length !== this.cellCount * 4) {
        throw new Error('Grade compartilhada com tamanho diferente');
      }
      this.positions = shared.positions;
      this.neighbors = shared.neighbors;
      return;
    }
    this.positions = newArray(Float32Array, this.cellCount * 3);
    this.neighbors = newArray(Int32Array, this.cellCount * 4);

    const p: Vec3 = [0, 0, 0];
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = this.index(face, x, y);
          this.cellToPoint(face, x, y, p);
          this.positions[i * 3] = p[0];
          this.positions[i * 3 + 1] = p[1];
          this.positions[i * 3 + 2] = p[2];
          for (let d = 0; d < 4; d++) {
            const dir = DIRS[d] as [number, number];
            this.neighbors[i * 4 + d] = this.computeNeighbor(face, x, y, dir[0], dir[1]);
          }
        }
      }
    }
  }

  index(face: number, x: number, y: number): number {
    return face * this.n * this.n + y * this.n + x;
  }

  faceOf(i: number): number {
    return Math.floor(i / (this.n * this.n));
  }

  xOf(i: number): number {
    return i % this.n;
  }

  yOf(i: number): number {
    return Math.floor(i / this.n) % this.n;
  }

  /** Centro da célula, em coordenada equiangular. */
  cellCenterCoord(c: number): number {
    return ((c + 0.5) / this.n) * 2 - 1;
  }

  cellToPoint(face: number, x: number, y: number, out: Vec3 = [0, 0, 0]): Vec3 {
    return faceCoordToPoint(face, this.cellCenterCoord(x), this.cellCenterCoord(y), out);
  }

  /** Ponto (qualquer comprimento, não nulo) → índice da célula que o contém. */
  pointToCell(x: number, y: number, z: number): number {
    // Versão sem alocação de pointToFaceCoord: é chamada milhões de vezes pelo clima.
    const face = faceOfPoint(x, y, z);
    const { n: fn, u, v } = FACES[face] as FaceFrame;
    const dn = x * fn[0] + y * fn[1] + z * fn[2];
    const a = Math.atan((x * u[0] + y * u[1] + z * u[2]) / dn) / QUARTER_PI;
    const b = Math.atan((x * v[0] + y * v[1] + z * v[2]) / dn) / QUARTER_PI;
    const n = this.n;
    const gx = Math.min(n - 1, Math.max(0, Math.floor((a + 1) * 0.5 * n)));
    const gy = Math.min(n - 1, Math.max(0, Math.floor((b + 1) * 0.5 * n)));
    return face * n * n + gy * n + gx;
  }

  /**
   * O mesmo que `pointToCell(v[0], v[1], v[2])`. Recebe o vetor em vez dos três números: nas buscas
   * por célula da recomposição (centenas de milhares por vez), passar números com vírgula para uma
   * função não embutida cria um objeto por número, e isso virava lixo para a limpeza de memória.
   */
  pointToCellOf(v: ArrayLike<number>): number {
    return this.pointToCell(v[0] as number, v[1] as number, v[2] as number);
  }

  neighbor(i: number, dir: number): number {
    return this.neighbors[i * 4 + dir] as number;
  }

  /**
   * Todas as células cujo centro está a até `angle` radianos do ponto (unitário) dado.
   * Busca em largura a partir da célula do ponto; custo proporcional à área do círculo.
   */
  cellsInCap(px: number, py: number, pz: number, angle: number): number[] {
    const cosLimit = Math.cos(angle);
    const start = this.pointToCell(px, py, pz);
    const stamp = this.nextStamp();
    const result: number[] = [start];
    this.visitStamp[start] = stamp;
    for (let head = 0; head < result.length; head++) {
      const c = result[head] as number;
      for (let d = 0; d < 4; d++) {
        const nb = this.neighbors[c * 4 + d] as number;
        if (this.visitStamp[nb] === stamp) continue;
        this.visitStamp[nb] = stamp;
        const dot =
          (this.positions[nb * 3] as number) * px +
          (this.positions[nb * 3 + 1] as number) * py +
          (this.positions[nb * 3 + 2] as number) * pz;
        if (dot >= cosLimit) result.push(nb);
      }
    }
    return result;
  }

  private nextStamp(): number {
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.visitStamp.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  /**
   * Vizinho na direção (dx, dy). Dentro da face é direto; na borda, estende o plano da face um
   * pouquinho além da aresta e vê em qual célula da face vizinha esse ponto cai. Como as arestas
   * das duas faces têm a mesma parametrização, a célula encontrada é exatamente a do outro lado.
   */
  private computeNeighbor(face: number, x: number, y: number, dx: number, dy: number): number {
    const n = this.n;
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < n && ny >= 0 && ny < n) return this.index(face, nx, ny);

    const EPS = 1e-6;
    const along = (c: number): number => Math.tan(this.cellCenterCoord(c) * QUARTER_PI);
    const beyond = (c: number): number => (c < 0 ? -1 - EPS : 1 + EPS);
    const cu = nx < 0 || nx >= n ? beyond(nx) : along(nx);
    const cv = ny < 0 || ny >= n ? beyond(ny) : along(ny);
    const { n: fn, u, v } = frame(face);
    const p = cubeToSphere(fn, u, v, cu, cv, [0, 0, 0]);
    return this.pointToCell(p[0], p[1], p[2]);
  }
}
