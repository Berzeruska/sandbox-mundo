import { Biome } from '../src/world/biomes';
import { Resource, RESOURCE_INFO } from '../src/world/resources';
import type { RGB } from './styles';

/**
 * Item 1.7: o 2D de longe da referência C (`docs/img/referencias/longe-2D/opcoes-abc.png`) aplicado sobre o globo que já existe, sem refazê-lo. O shader do
 * jogo não muda: o protótipo edita o texto dele antes de compilar, só na própria página. Modos:
 *   chapado: só a cor forte da célula, sem borda ondulada;
 *   procedural: floresta em maciço, árvores soltas, montanhas e pedrinhas calculadas por pixel;
 *   atlas: os mesmos desenhos lidos de uma folha de ladrilhos;
 *   prerender: o planeta inteiro desenhado uma vez numa textura;
 *   misto: chapado de longe e atlas de perto.
 */
export type FarMode = 'jogo' | 'chapado' | 'procedural' | 'atlas' | 'prerender' | 'misto';
export const FAR_MODES: readonly FarMode[] = ['jogo', 'chapado', 'procedural', 'atlas', 'prerender', 'misto'];

const TILE = 16, VARIANTS = 4;
const glslColors = RESOURCE_INFO.map((r) => `vec3(${r.color.map((v) => ((v as number) / 255).toFixed(3)).join(',')})`).join(',');

/** Direção do norte na grade da face, para as montanhas sempre apontarem para cima. */
const COMMON = `
const vec3 FAR_RES[${RESOURCE_INFO.length}] = vec3[${RESOURCE_INFO.length}](${glslColors});
float farHash(ivec3 t, int k) {
  uint h = uint(t.x) * 73856093u ^ uint(t.y) * 19349663u ^ uint(t.z) * 83492791u ^ uint(k) * 2654435761u;
  h ^= h >> 13u; h *= 1540483477u; h ^= h >> 15u;
  return float(h & 1023u) / 1023.0;
}
struct FarCell { ivec3 t; int b; vec3 rgb; vec2 f; vec2 up; };
FarCell farCell(vec3 q) {
  int face; vec3 n; vec3 u; vec3 v;
  faceFrame(q, face, n, u, v);
  vec2 xy = vec2(dot(q, u), dot(q, v)) / dot(q, n);
  vec2 g = (atanQuarter(xy) + 1.0) * 0.5 * float(uN);
  ivec2 t0 = clamp(ivec2(floor(g)), ivec2(0), ivec2(uN - 1));
  vec4 c = texelFetch(uCells, ivec3(t0, face), 0);
  FarCell o;
  o.t = ivec3(t0, face);
  o.b = int(c.a * 255.0 + 0.5) & 15;
  o.rgb = c.rgb;
  o.f = g - vec2(t0);
  vec3 north = vec3(0.0, 1.0, 0.0) - q * q.y;
  vec2 up = vec2(dot(north, u), dot(north, v));
  o.up = abs(up.x) > abs(up.y) ? vec2(sign(up.x), 0.0) : vec2(0.0, sign(up.y));
  return o;
}
// Posição na célula com o norte para cima (x para a direita, y para cima, 0–1).
vec2 farLocal(FarCell c) {
  vec2 d = c.f - 0.5;
  return vec2(dot(d, vec2(c.up.y, -c.up.x)), dot(d, c.up)) + 0.5;
}
// Montanha da referência C: triângulo com neve, maior que a célula (blocos de 3 células), nem todo bloco tem.
vec3 farMountain(vec3 col, FarCell c, float cellPx) {
  vec2 right = vec2(c.up.y, -c.up.x);
  vec2 at = vec2(c.t.xy) + c.f;
  vec2 m = vec2(dot(at, right), dot(at, c.up)) / 3.0;
  vec2 block = floor(m);
  ivec3 id = ivec3(ivec2(block) + 4096, c.t.z);
  vec2 uv = floor((m - block) * max(3.0, floor(cellPx * 1.5))) / max(3.0, floor(cellPx * 1.5));
  if (farHash(id, 21) > 0.72) return col * 0.94;
  float cx = 0.5 + (farHash(id, 22) - 0.5) * 0.3, tall = 0.72 + 0.2 * farHash(id, 23), v = uv.y - 0.08;
  float half_ = 0.46 * (1.0 - v / tall);
  if (v < 0.0 || v > tall || abs(uv.x - cx) > half_) {
    // Sombra de um ponto na base.
    return v < 0.0 && v > -0.07 && abs(uv.x - cx) < 0.46 ? col * 0.66 : col * 0.94;
  }
  bool left = uv.x < cx;
  bool snow = v > tall * (c.b == 15 ? 0.42 : 0.68);
  if (snow) return left ? vec3(1.0) : vec3(0.8, 0.84, 0.92);
  return left ? col * 1.16 : col * 0.62;
}
vec3 farStones(vec3 col, FarCell c, vec2 lp, float K) {
  uint code = texelFetch(uDeposits, c.t, 0).r;
  if (code == 0u) return col;
  int type = int(code & 31u);
  if (type >= ${RESOURCE_INFO.length}) return col;
  if (type == 0) return col;
  if (type == ${Resource.Oil}) { // poça de petróleo aparente; a outra parte da jazida segue escondida
    if ((code & 128u) == 0u && farHash(c.t, 70) > 0.55) return col;
    return length(lp - 0.5) < 0.34 ? vec3(0.05, 0.045, 0.06) : col;
  }
  vec3 rc = FAR_RES[type];
  // Pedrinhas: blocos angulosos de 2 a 3 pontos, nunca discos, com uma face clara e outra escura.
  for (int k = 0; k < 3; k++) {
    vec2 at = vec2(farHash(c.t, 40 + k), farHash(c.t, 50 + k)) * 0.7 + 0.15;
    vec2 d = abs(lp - at);
    float s = 0.12 + 0.06 * farHash(c.t, 60 + k);
    if (d.x + d.y * 1.4 < s) return rc * (lp.y > at.y ? 1.15 : 0.72);
  }
  return col;
}
`;

const PROCEDURAL = `
vec3 farStyle(vec3 base, vec3 q, float cellPx) {
  FarCell c = farCell(q);
  vec3 col = c.rgb;
  bool water = c.b <= 1;
  if (water) return col;
  float K = clamp(floor(cellPx / 2.0), 1.0, 16.0);
  vec2 lp = farLocal(c);
  ivec2 vp = ivec2(floor(lp * K));
  if (c.b == 5 || c.b == 6 || c.b == 12) {
    // Floresta em maciço: pontos escuros e claros sobre a cor da mata.
    float h = farHash(c.t, vp.x + vp.y * 37 + 3);
    col *= h < 0.3 ? 0.72 : h < 0.68 ? 0.9 : 1.12;
  } else if (c.b == 14 || c.b == 15) {
    return farStones(farMountain(col, c, cellPx), c, lp, K);
  } else if (K >= 4.0 && c.b != 2 && c.b != 3 && c.b != 9 && c.b != 10) {
    // Árvores soltas: copa de 2 pontos, sombra de 1 ponto ao lado.
    float h = farHash(c.t, 11);
    if (h < 0.22) {
      vec2 at = floor(vec2(farHash(c.t, 12), farHash(c.t, 13)) * (K - 3.0) + 1.0);
      vec2 d = floor(lp * K) - at;
      if (d.x >= 0.0 && d.x < 2.0 && d.y >= 0.0 && d.y < 2.0) col = vec3(0.07, 0.34, 0.14) * (d.y > 0.5 ? 1.25 : 1.0);
      else if (d.y == -1.0 && d.x >= 1.0 && d.x < 3.0) col *= 0.62;
    }
  }
  return farStones(col, c, lp, K);
}`;

const ATLAS = `
uniform sampler2D uFarAtlas;
vec3 farStyle(vec3 base, vec3 q, float cellPx) {
  FarCell c = farCell(q);
  if (c.b <= 1) return c.rgb;
  vec2 lp = farLocal(c);
  float variant = floor(farHash(c.t, 2) * ${VARIANTS}.0);
  vec2 uv = (vec2(variant, float(c.b)) + clamp(vec2(lp.x, 1.0 - lp.y), 0.02, 0.98)) / vec2(${VARIANTS}.0, 16.0);
  vec3 col = textureLod(uFarAtlas, uv, max(0.0, log2(${TILE}.0 / max(cellPx, 1.0)))).rgb;
  if (c.b >= 14) col = farMountain(col, c, cellPx);
  return farStones(col, c, lp, 8.0);
}`;

const MISTO = `
uniform sampler2D uFarAtlas;
vec3 farStyle(vec3 base, vec3 q, float cellPx) {
  FarCell c = farCell(q);
  if (c.b <= 1 || cellPx < 4.0) return c.rgb;
  vec2 lp = farLocal(c);
  float variant = floor(farHash(c.t, 2) * ${VARIANTS}.0);
  vec2 uv = (vec2(variant, float(c.b)) + clamp(vec2(lp.x, 1.0 - lp.y), 0.02, 0.98)) / vec2(${VARIANTS}.0, 16.0);
  vec3 col = textureLod(uFarAtlas, uv, max(0.0, log2(${TILE}.0 / cellPx))).rgb;
  if (c.b >= 14) col = farMountain(col, c, cellPx);
  return farStones(col, c, lp, 8.0);
}`;

const CHAPADO = `
vec3 farStyle(vec3 base, vec3 q, float cellPx) {
  return farCell(q).rgb;
}`;

const PRERENDER = `
uniform highp sampler2DArray uFarBake;
vec3 farStyle(vec3 base, vec3 q, float cellPx) {
  int face; vec3 n; vec3 u; vec3 v;
  faceFrame(q, face, n, u, v);
  vec2 xy = vec2(dot(q, u), dot(q, v)) / dot(q, n);
  vec2 uv = (atanQuarter(xy) + 1.0) * 0.5;
  return textureLod(uFarBake, vec3(uv, float(face)), max(0.0, log2(${4 * 2}.0 / max(cellPx, 1.0)))).rgb;
}`;

/** Põe o estilo no texto do shader do globo. Quem chama passa isto no lugar do `gl.shaderSource` original. */
export function patchGlobeShader(source: string, mode: FarMode): string {
  if (mode === 'jogo' || !source.includes('vec3 surface') || !source.includes('faceFrame')) return source;
  const body = mode === 'procedural' ? PROCEDURAL : mode === 'atlas' ? ATLAS : mode === 'misto' ? MISTO : mode === 'prerender' ? PRERENDER : CHAPADO;
  const marker = '// Célula de perto no ponto q.';
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('shader do globo mudou: marcador não achado');
  let s = source.slice(0, at) + (mode === 'prerender' ? body : COMMON + body) + '\n' + source.slice(at);
  // Referência C: borda de pixel, sem ondulação; a célula é sempre lida no próprio ponto.
  s = s.replaceAll('float warpAmount = smoothstep(0.8, 2.5, cellPx) * (1.0 - sq);', 'float warpAmount = 0.0;');
  s = s.replaceAll('  return base;\n}', '  base = farStyle(base, q, cellPx);\n  return base;\n}');
  return s;
}

const hash = (a: number, b: number, k: number): number => {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** Um ladrilho de 16×16, no estilo da referência C, com o norte para cima (linha 0 = norte). */
function tile(biome: number, variant: number, base: RGB, out: Uint8ClampedArray, o: number, stride: number, forBake: boolean): void {
  const put = (x: number, y: number, c: readonly [number, number, number]) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = o + y * stride + x * 4;
    out[i] = c[0] * 255; out[i + 1] = c[1] * 255; out[i + 2] = c[2] * 255; out[i + 3] = 255;
  };
  const scale = (k: number): [number, number, number] => [base[0] * k, base[1] * k, base[2] * k];
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(x, y, scale(1));
  if (biome === Biome.Taiga || biome === Biome.TemperateForest || biome === Biome.TropicalForest) {
    // Maciço: blocos de 2 pontos, escuros e claros.
    for (let y = 0; y < TILE; y += 2) for (let x = 0; x < TILE; x += 2) {
      const h = hash(x + variant * 31, y, biome);
      const c = scale(h < 0.3 ? 0.68 : h < 0.68 ? 0.9 : 1.14);
      put(x, y, c); put(x + 1, y, c); put(x, y + 1, c); put(x + 1, y + 1, c);
    }
  } else if ((biome === Biome.Mountain || biome === Biome.SnowyPeak) && forBake) {
    const cx = 8 + Math.floor((hash(variant, biome, 1) - 0.5) * 3), top = 1 + variant % 2;
    for (let y = top; y < 15; y++) {
      const half = Math.floor((y - top) * 0.62) + 1;
      for (let x = cx - half; x <= cx + half; x++) {
        const snow = y - top < (biome === Biome.SnowyPeak ? 6 : 3);
        put(x, y, snow ? (x <= cx ? [1, 1, 1] : [0.82, 0.85, 0.92]) : x <= cx ? scale(1.12) : scale(0.66));
      }
    }
  } else if (biome === Biome.HotDesert || biome === Biome.ColdDesert) {
    // Ondas de areia, mais fortes na variante 0.
    if (variant === 0) for (let k = 0; k < 3; k++) {
      const y0 = 3 + k * 5, x0 = 1 + k * 3;
      for (let x = 0; x < 7; x++) put(x0 + x, y0 + (x >> 2), scale(0.86));
    }
  } else if (biome !== Biome.Beach && biome !== Biome.Ice && biome !== Biome.Mountain && biome !== Biome.SnowyPeak && variant === 0) {
    // Árvore solta: copa de 2 pontos e sombra de 1 ponto.
    const x = 3 + Math.floor(hash(variant, biome, 2) * 9), y = 3 + Math.floor(hash(biome, variant, 3) * 9);
    const dark: [number, number, number] = [0.07, 0.34, 0.14], leaf: [number, number, number] = [0.09, 0.42, 0.17];
    put(x + 1, y + 2, scale(0.62)); put(x + 2, y + 2, scale(0.62));
    put(x, y, leaf); put(x + 1, y, leaf); put(x, y + 1, dark); put(x + 1, y + 1, dark);
  }
}

/** A folha de ladrilhos: 16 biomas × 4 variantes. */
export function buildAtlas(palette: readonly RGB[], forBake = false): { data: Uint8ClampedArray; width: number; height: number } {
  const width = TILE * VARIANTS, height = TILE * 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let b = 0; b < 16; b++) for (let v = 0; v < VARIANTS; v++) tile(b, v, palette[b] as RGB, data, (b * TILE * width + v * TILE) * 4, width * 4, forBake);
  return { data, width, height };
}

export function uploadAtlas(gl: WebGL2RenderingContext, palette: readonly RGB[], unit: number): void {
  const a = buildAtlas(palette);
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, a.width, a.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(a.data.buffer));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
}

/** Pré-render: 8 pontos por célula em todo o planeta (uma vez; refeito onde mudar, na recomposição). */
export function bakePlanet(gl: WebGL2RenderingContext, n: number, cellBiome: (face: number, x: number, y: number) => number, up: (face: number) => [number, number], palette: readonly RGB[], unit: number): { ms: number; bytes: number } {
  const started = performance.now();
  const PER = 8, size = n * PER, step = Math.round(TILE / PER);
  const atlas = buildAtlas(palette, true);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  const levels = 4;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, 6);
  const px = new Uint8Array(size * size * 4);
  for (let face = 0; face < 6; face++) {
    const [ux, uy] = up(face);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const b = cellBiome(face, x, y), v = (Math.imul(x * 31 + face, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 30;
      for (let py = 0; py < PER; py++) for (let qx = 0; qx < PER; qx++) {
        const fx = (qx + 0.5) / PER - 0.5, fy = (py + 0.5) / PER - 0.5;
        const lx = fx * uy - fy * ux + 0.5, ly = fx * ux + fy * uy + 0.5;
        const ax = Math.min(TILE - 1, Math.floor(lx * TILE)), ay = Math.min(TILE - 1, Math.floor((1 - ly) * TILE));
        const s = ((b * TILE + ay) * atlas.width + v * TILE + ax) * 4;
        const o = ((y * PER + py) * size + x * PER + qx) * 4;
        px[o] = atlas.data[s] as number; px[o + 1] = atlas.data[s + 1] as number; px[o + 2] = atlas.data[s + 2] as number; px[o + 3] = 255;
      }
    }
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, face, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  void step;
  let bytes = 0;
  for (let l = 0; l < levels; l++) bytes += (size >> l) * (size >> l) * 4 * 6;
  return { ms: performance.now() - started, bytes };
}
