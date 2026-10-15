import { BIOME_COUNT, BIOME_INFO } from '../world/biomes';
import { FACES, type Vec3 } from '../world/cubesphere';
import { CONTINENTAL_BIT, MAX_SHADER_PLATES, NEAR_BOUNDARY_BIT, NEAR_BOUNDARY_CELLS, PLATE_MASK } from './plate-motion';

const vec = (v: Vec3): string => `vec3(${v.map((c) => c.toFixed(1)).join(', ')})`;

/** Escolha de face em GLSL, gerada da tabela FACES (mesmo desempate do código da CPU). */
function faceSelectGlsl(): string {
  const set = (face: number): string => {
    const f = FACES[face];
    if (!f) throw new Error('face');
    return `{ face = ${face}; n = ${vec(f.n)}; u = ${vec(f.u)}; v = ${vec(f.v)}; }`;
  };
  return `
void faceFrame(vec3 p, out int face, out vec3 n, out vec3 u, out vec3 v) {
  vec3 a = abs(p);
  if (a.x >= a.y && a.x >= a.z) {
    if (p.x > 0.0) ${set(0)} else ${set(1)}
  } else if (a.y >= a.z) {
    if (p.y > 0.0) ${set(2)} else ${set(3)}
  } else {
    if (p.z > 0.0) ${set(4)} else ${set(5)}
  }
}`;
}

export const VERTEX_SHADER = `#version 300 es
void main() {
  // Um triângulo que cobre a tela inteira, sem buffers.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;


/**
 * Funções que leem um conjunto de texturas (cores, placas, ângulos da composição), geradas duas
 * vezes: para a composição atual e para a anterior (transição suave). Gerar o código duas vezes
 * evita escolher a textura em tempo de execução: num ternário, muitas GPUs fazem as duas leituras.
 */
function setFunctions(sfx: string, cells: string, plates: string, base: string, maxDelta: string): string {
  return `
// Célula que contém o ponto p da esfera: cor (rgb) e código do bioma (a).
vec4 cellAt${sfx}(vec3 p) {
  ivec3 t = texelOf(p);
  return texelFetch(${cells}, t, 0);
}

uint plateAt${sfx}(vec3 p) {
  ivec3 t = texelOf(p);
  return texelFetch(${plates}, t, 0).r;
}

// Do referencial da placa para a textura (aplica o ângulo da composição).
vec3 toTexture${sfx}(int pl, vec3 a) {
  vec2 b = ${base}[pl];
  return rotCS(a, uPlateAxis[pl].xyz, b.x, b.y);
}

// Testa uma placa candidata: ela é dona de p se, desgirando p pela rotação dela, cai em território
// dela (com tolerância de ~0,7 célula ao arredondamento da textura; nesse caso a cor é lida no ponto
// vizinho que é dela, não no da outra placa). Continental fica por cima.
// Escrito sem arrays locais nem laços: alguns compiladores de GPU de celular falham com isso.
void tryPlate${sfx}(int pl, vec3 p, inout int best, inout bool bestCont, inout vec3 bestFix) {
  vec3 s = toTexture${sfx}(pl, toPlate(pl, p));
  uint v = plateAt${sfx}(s);
  vec3 thisFix = vec3(0.0);
  bool mine = int(v & ${PLATE_MASK}u) == pl;
  if (!mine) {
    float tol = uCellAngle * 0.7;
    vec3 es = normalize(vec3(s.z, 0.0, -s.x) + vec3(1e-6, 0.0, 0.0)) * tol;
    vec3 ns = cross(s, es);
    uint w = plateAt${sfx}(s + es);
    if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = es; }
    if (!mine) { w = plateAt${sfx}(s - es); if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = -es; } }
    if (!mine) { w = plateAt${sfx}(s + ns); if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = ns; } }
    if (!mine) { w = plateAt${sfx}(s - ns); if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = -ns; } }
  }
  if (!mine) return;
  bool cont = (v & ${CONTINENTAL_BIT}u) != 0u;
  if (best < 0 || (cont && !bestCont)) { best = pl; bestCont = cont; bestFix = thisFix; }
}

// Qual placa está em p agora (-1 = fenda nova onde as placas se afastam). Candidatas: a placa que
// estava em p e as que estavam em volta, até a distância que as placas andaram. Fenda sem
// afastamento (só arredondamento) fica com a placa que estava em p, como a recomposição faz.
int plateNow${sfx}(vec3 p, out vec3 fix) {
  fix = vec3(0.0);
  uint v0 = plateAt${sfx}(p);
  int pl0 = int(v0 & ${PLATE_MASK}u);
  // Atalho para o miolo da placa (a maior parte do planeta): longe de fronteira e com as placas
  // tendo andado menos que essa distância, só pode ser a própria placa.
  if ((v0 & ${NEAR_BOUNDARY_BIT}u) == 0u && ${maxDelta} < ${(NEAR_BOUNDARY_CELLS - 0.5).toFixed(1)} * uCellAngle) return pl0;
  vec3 e = vec3(p.z, 0.0, -p.x);
  e = dot(e, e) < 1e-12 ? vec3(1.0, 0.0, 0.0) : normalize(e);
  float dist = ${maxDelta} * 1.5;
  vec3 de = e * dist;
  vec3 dn = cross(p, e) * dist;
  int c1 = int(plateAt${sfx}(p + de) & ${PLATE_MASK}u);
  int c2 = int(plateAt${sfx}(p - de) & ${PLATE_MASK}u);
  int c3 = int(plateAt${sfx}(p + dn) & ${PLATE_MASK}u);
  int c4 = int(plateAt${sfx}(p - dn) & ${PLATE_MASK}u);
  int best = -1;
  bool bestCont = false;
  vec3 bestFix = vec3(0.0);
  tryPlate${sfx}(pl0, p, best, bestCont, bestFix);
  if (c1 != pl0) tryPlate${sfx}(c1, p, best, bestCont, bestFix);
  if (c2 != pl0 && c2 != c1) tryPlate${sfx}(c2, p, best, bestCont, bestFix);
  if (c3 != pl0 && c3 != c1 && c3 != c2) tryPlate${sfx}(c3, p, best, bestCont, bestFix);
  if (c4 != pl0 && c4 != c1 && c4 != c2 && c4 != c3) tryPlate${sfx}(c4, p, best, bestCont, bestFix);
  if (best >= 0) { fix = bestFix; return best; }
  if (c1 != pl0 && closing(pl0, c1, p) < 0.0) return -1;
  if (c2 != pl0 && closing(pl0, c2, p) < 0.0) return -1;
  if (c3 != pl0 && closing(pl0, c3, p) < 0.0) return -1;
  if (c4 != pl0 && closing(pl0, c4, p) < 0.0) return -1;
  return pl0;
}

// Cor da superfície no ponto p (antes da luz), com o conjunto de texturas ${sfx || "atual"}.
vec3 surface${sfx}(vec3 p, float cellPx) {
  // Com placas em movimento, o ruído (bordas e textura) fica preso à placa e a busca na textura
  // desfaz a rotação dela desde a composição. Parado, tudo acontece direto no ponto p.
  int pl = -1;
  bool gap = false;
  vec3 anchor = p;
  vec3 fix = vec3(0.0);
  if (uMoving == 1) {
    pl = plateNow${sfx}(p, fix);
    if (pl < 0) gap = true;
    else anchor = toPlate(pl, p);
  }

  // Bordas orgânicas: desloca o ponto com ruído (até ~1 célula) antes de escolher a célula.
  // A simulação continua na grade; só o desenho das fronteiras vira curva.
  vec3 q = anchor;
  float warpAmount = smoothstep(0.8, 2.5, cellPx);
  if (warpAmount > 0.0) {
    float f = 1.0 / (uCellAngle * 1.7);
    vec3 w = noise3(anchor * f) + 0.5 * noise3(anchor.zxy * f * 2.03 + 17.0);
    q = normalize(anchor + w * (uCellAngle * 0.7 * warpAmount));
  }
  if (pl >= 0) q = toTexture${sfx}(pl, q) + fix;
  vec4 cell = gap ? vec4(uRidgeColor, 0.0) : cellAt${sfx}(q);
  vec3 base = cell.rgb;

  // Textura sutil por bioma (floresta e montanha mais rugosas, água e gelo quase lisos).
  float detailAmount = smoothstep(1.5, 5.0, uCellAngle * 0.4 * uRadius);
  if (detailAmount > 0.0) {
    int biome = clamp(int(cell.a * 255.0 + 0.5), 0, ${BIOME_COUNT - 1});
    float fd = 1.0 / (uCellAngle * 0.4);
    float dn = noise3(anchor * fd).x + 0.5 * noise3(anchor.yzx * fd * 2.13 + 31.0).y;
    base *= 1.0 + DETAIL[biome] * dn * detailAmount;
  }

  return base;
}

`;
}


/** Variante simplificada: só a cor da célula, com bordas orgânicas e textura (sem placas). */
const SIMPLE_GLSL = `
vec4 cellAt(vec3 p) {
  return texelFetch(uCells, texelOf(p), 0);
}

vec3 surface(vec3 p, float cellPx) {
  vec3 q = p;
  float warpAmount = smoothstep(0.8, 2.5, cellPx);
  if (warpAmount > 0.0) {
    float f = 1.0 / (uCellAngle * 1.7);
    vec3 w = noise3(p * f) + 0.5 * noise3(p.zxy * f * 2.03 + 17.0);
    q = normalize(p + w * (uCellAngle * 0.7 * warpAmount));
  }
  vec4 cell = cellAt(q);
  vec3 base = cell.rgb;
  float detailAmount = smoothstep(1.5, 5.0, uCellAngle * 0.4 * uRadius);
  if (detailAmount > 0.0) {
    int biome = clamp(int(cell.a * 255.0 + 0.5), 0, ${BIOME_COUNT - 1});
    float fd = 1.0 / (uCellAngle * 0.4);
    float dn = noise3(p * fd).x + 0.5 * noise3(p.yzx * fd * 2.13 + 31.0).y;
    base *= 1.0 + DETAIL[biome] * dn * detailAmount;
  }
  return base;
}
`;

/** Variante completa: movimento suave das placas (uniforms, rotações e os dois conjuntos de texturas). */
const MOTION_GLSL = `
// Composição anterior: durante a transição suave logo depois de uma recomposição, as duas são
// desenhadas e misturadas.
uniform sampler2DArray uCellsPrev;
uniform float uFade; // 1 = só a atual; de 0 a 1 logo depois de uma recomposição

// ---- Movimento suave das placas entre recomposições (mesma regra de src/render/plate-motion.ts) ----
// A textura mostra o mundo composto com as placas nos ângulos "base"; cada placa é rígida, então o
// conteúdo de p agora é o que estava no ponto desgirado pela rotação que a placa fez desde então.
uniform highp usampler2DArray uPlates; // bits 0–3 = placa; bit 4 = crosta continental
uniform int uMoving;                    // 1 = há placas fora do ângulo base
uniform vec4 uPlateAxis[${MAX_SHADER_PLATES}];   // eixo (xyz) e velocidade relativa (w)
uniform vec3 uPlateCenter[${MAX_SHADER_PLATES}]; // centro atual de cada placa
uniform vec2 uPlateTotal[${MAX_SHADER_PLATES}]; // cos, sen do ângulo total (ruído preso à placa)
uniform vec2 uPlateBase[${MAX_SHADER_PLATES}];  // cos, sen do ângulo da composição da textura
uniform highp usampler2DArray uPlatesPrev;      // placas da composição anterior
uniform vec2 uPlateBasePrev[${MAX_SHADER_PLATES}]; // ângulos da composição anterior
uniform float uMaxDelta;                // maior rotação desde a composição (raio de busca)
uniform float uMaxDeltaPrev;            // idem, desde a composição anterior (transição suave)
uniform vec3 uRidgeColor;               // fundo oceânico novo (fenda ainda sem crosta)

vec3 rotCS(vec3 v, vec3 k, float c, float s) {
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// Do mundo para o referencial da placa (desfaz o ângulo total).
vec3 toPlate(int pl, vec3 v) {
  return rotCS(v, uPlateAxis[pl].xyz, uPlateTotal[pl].x, -uPlateTotal[pl].y);
}

// As placas a e b, em p, estão se aproximando (> 0) ou se afastando (< 0)? Mesma regra da
// recomposição: velocidades na direção que vai do centro de a para o de b.
float closing(int a, int b, vec3 p) {
  vec3 d = uPlateCenter[b] - uPlateCenter[a];
  d -= dot(d, p) * p;
  vec3 va = uPlateAxis[a].w * cross(uPlateAxis[a].xyz, p);
  vec3 vb = uPlateAxis[b].w * cross(uPlateAxis[b].xyz, p);
  return dot(va - vb, d);
}

${setFunctions('', 'uCells', 'uPlates', 'uPlateBase', 'uMaxDelta')}
${setFunctions('Prev', 'uCellsPrev', 'uPlatesPrev', 'uPlateBasePrev', 'uMaxDeltaPrev')}
`;

/**
 * Shader do globo. `motion = true`: completo, com o movimento suave das placas (textura de placas,
 * ângulos e transição entre composições). `motion = false`: simplificado, sem nada disso — é o plano B
 * automático se o driver da GPU não compilar o completo (o jogo funciona, só com os saltos da T4).
 */
export function fragmentShader(motion: boolean): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uCells;
uniform int uN;
uniform vec2 uCenter;   // centro do globo em pixels (origem embaixo, como gl_FragCoord)
uniform float uRadius;  // raio do globo em pixels
uniform mat3 uRot;      // visão -> mundo
uniform vec3 uLight;    // direção da luz, em coordenadas de visão
uniform float uCellAngle; // ângulo entre células vizinhas (radianos)

// Intensidade da textura de detalhe por bioma (de BIOME_INFO).
const float DETAIL[${BIOME_COUNT}] = float[${BIOME_COUNT}](${BIOME_INFO.map((b) => b.detail.toFixed(3)).join(', ')});

out vec4 outColor;

const float QUARTER_PI = 0.78539816339;
${faceSelectGlsl()}

// --- Ruído 3D na esfera (só visual): contínuo através das faces e dos cantos do cubo ---
// Lido de uma textura 3D pré-calculada (filtro linear, repetida), não calculado por pixel.
uniform highp sampler3D uNoise;

vec3 noise3(vec3 p) {
  return texture(uNoise, p * (1.0 / 64.0)).rgb * 2.0 - 1.0;
}

// Texel (x, y, face) da célula que contém o ponto p da esfera.
ivec3 texelOf(vec3 p) {
  int face; vec3 n; vec3 u; vec3 v;
  faceFrame(p, face, n, u, v);
  float dn = dot(p, n);
  vec2 ab = atan(vec2(dot(p, u), dot(p, v)) / dn) / QUARTER_PI;
  ivec2 texel = clamp(ivec2(floor((ab + 1.0) * 0.5 * float(uN))), ivec2(0), ivec2(uN - 1));
  return ivec3(texel, face);
}

${motion ? MOTION_GLSL : SIMPLE_GLSL}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 space(vec2 frag, float r) {
  vec3 col = vec3(0.01, 0.012, 0.03);
  // Estrelas esparsas e fixas.
  vec2 cell = floor(frag / 3.0);
  float h = hash(cell);
  if (h > 0.996) col += vec3(0.5 + 0.5 * hash(cell + 7.0));
  // Brilho da atmosfera logo fora da borda.
  float glowWidth = clamp(uRadius * 0.06, 6.0, 40.0) / uRadius;
  float g = exp(-max(r - 1.0, 0.0) / glowWidth);
  col += vec3(0.25, 0.5, 1.0) * 0.45 * g;
  return col;
}

void main() {
  vec2 d = (gl_FragCoord.xy - uCenter) / uRadius;
  float r2 = dot(d, d);
  if (r2 > 1.0) {
    outColor = vec4(space(gl_FragCoord.xy, sqrt(r2)), 1.0);
    return;
  }
  vec3 nView = vec3(d, sqrt(1.0 - r2));
  vec3 p = uRot * nView;

  // Tamanho de uma célula na tela (px). Os detalhes somem quando ficam pequenos demais
  // para não cintilar ao girar o globo de longe.
  float cellPx = uCellAngle * uRadius;

  vec3 base = surface(p, cellPx);${motion ? `
  // Transição suave depois de uma recomposição: mistura com a composição anterior.
  if (uFade < 1.0) base = mix(surfacePrev(p, cellPx), base, uFade);` : ''}

  // Luz suave: lado iluminado e sombra sem ficar preto; um toque de atmosfera na borda.
  float diffuse = max(dot(nView, uLight), 0.0);
  vec3 col = base * (0.38 + 0.72 * diffuse);
  float rim = pow(1.0 - nView.z, 3.0);
  col = mix(col, vec3(0.35, 0.6, 1.0), rim * 0.35);
  outColor = vec4(col, 1.0);
}`
}

/** Shader completo (com movimento suave das placas). */
export const FRAGMENT_SHADER = fragmentShader(true);
