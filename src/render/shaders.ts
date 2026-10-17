import { Biome, BIOME_COUNT, BIOME_INFO } from '../world/biomes';
import { FACES, type Vec3 } from '../world/cubesphere';
import { BIOME_BITS, DECOR_BIT } from './colors';
import { Resource, RESOURCE_INFO } from '../world/resources';
import { CONTINENTAL_BIT, LINE_BIT, MAX_SHADER_PLATES, NEAR_REACH_CELLS, PLATE_MASK } from './plate-motion';

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
 * Vista de perto (pedido do usuário, 2026-10-16): entre estes tamanhos de célula na tela (px), as
 * bordas orgânicas e a textura manchada somem aos poucos e as células viram quadrados nítidos, com
 * cor mais viva, variação leve por célula, contorno fino entre biomas e sombra na água junto da terra.
 * De longe nada muda.
 */
export const SQUARE_FROM_PX = 6;
export const SQUARE_TO_PX = 14;

/**
 * Acabamento das células de perto para um conjunto de texturas (`cells`).
 *
 * Cada ponto mostra a célula de **centro mais perto** (entre a célula da grade e as 8 em volta, também
 * do outro lado de uma emenda do cubo), em vez do quadrado da grade em que ele cai. No meio das faces
 * é o mesmo quadrado; perto das emendas e dos 8 cantos do cubo, onde os quadrados viravam losangos e a
 * costa dobrava como a quina de uma caixa, as formas ficam arredondadas e passam de uma face para a
 * outra sem dobra (pedido do usuário, 2026-10-17: "o planeta não pode ficar cubado"). O contorno entre
 * biomas e a sombra na água saem da distância até a divisa com a vizinha, então valem também nas
 * emendas. A distância até os centros usa a métrica local da grade (ver `tileGlsl`).
 */
function tileGlsl(sfx: string, cells: string, deposits: string, plates = ''): string {
  // As 4 células em volta são escritas por extenso (k = 0…3), sem arrays nem laços, e cada uma guarda só
  // o bioma, a distância e o endereço; a cor é lida uma vez, no fim, só da escolhida (array lido com
  // índice variável vai para a memória lenta da GPU). Medidas em `docs/decisoes.md`, "Vista de perto
  // mais leve".
  const ks = [0, 1, 2, 3];
  const mask = (1 << BIOME_BITS) - 1;
  const ax = (k: number): string => ((k & 1) ? 'y' : 'x');
  const ay = (k: number): string => ((k >> 1) ? 'y' : 'x');
  // Distância² (rad²) de q ao centro da célula k da mesma face, pela métrica local da grade.
  const dist = (k: number): string =>
    `  float d${k} = metric.z * (metric.x * du.${ax(k)} * du.${ax(k)} - xy2 * du.${ax(k)} * dv.${ay(k)} + metric.y * dv.${ay(k)} * dv.${ay(k)});`;
  // Célula k > 0 no caminho das divisas: endereço e bioma. Do outro lado da emenda do cubo (raro): a
  // célula vizinha de verdade e a distância até o centro dela por vetores (|q − c|² na esfera).
  const neighbor = (k: number): string => `
    ivec3 t${k}c = ivec3(t0 + ivec2(${k & 1}, ${k >> 1}) * s, face);
    if (any(lessThan(t${k}c.xy, ivec2(0))) || any(greaterThanEqual(t${k}c.xy, ivec2(uN)))) {
      vec3 qu = normalize(q);
      vec2 tk = tan((vec2(t0) + vec2(${k & 1}, ${k >> 1}) * vec2(s) + 0.5) * cellRad - QUARTER_PI);
      vec3 c = normalize(n + tk.x * u + tk.y * v);
      t${k}c = texelOf(c);
      int f2; vec3 n2; vec3 u2; vec3 v2;
      faceFrame(c, f2, n2, u2, v2);
      vec2 a2 = tan((vec2(t${k}c.xy) + 0.5) * cellRad - QUARTER_PI);
      vec3 e = qu - normalize(n2 + a2.x * u2 + a2.y * v2);
      d${k} = dot(e, e);
    }
    int b${k} = int(texelFetch(${cells}, t${k}c, 0).a * 255.0 + 0.5) & ${mask};`;
  // Peso pela distância: 1 no centro, 0 a 1 célula.
  // Na fronteira com placas andando, só valem células da própria placa (sem misturar com a outra placa
  // onde ela estava na última recomposição). Célula de outra placa: peso 0 e nunca escolhida.
  const owner = (k: number): string =>
    plates
      ? `    bool ok${k} = !line || int(texelFetch(${plates}, ${k === 0 ? 't0c' : `t${k}c`}, 0).r & ${PLATE_MASK}u) == ownPlate;`
      : `    bool ok${k} = true;`;
  const weight = (k: number): string =>
    `    float w${k} = ok${k} ? max(0.0, 1.0 - d${k} * inv2) : 0.0; w${k} *= w${k};`;
  return `
// Célula de perto no ponto q. Devolve a cor (antes da luz) e a célula escolhida em "cell".
vec3 tile${sfx}(vec3 q, float cellPx, float sq, int ownPlate, out vec4 cell) {
  int face; vec3 n; vec3 u; vec3 v;
  faceFrame(q, face, n, u, v);
  vec2 xy = vec2(dot(q, u), dot(q, v)) / dot(q, n); // tangentes do ponto na face
  vec2 g = (atanQuarter(xy) + 1.0) * 0.5 * float(uN);
  ivec2 t0 = clamp(ivec2(floor(g)), ivec2(0), ivec2(uN - 1));
  // As 4 células em volta do canto de célula mais perto de q: só elas ficam a menos de 1 célula.
  ivec2 s = ivec2(lessThan(g - vec2(t0), vec2(0.5))) * -2 + 1; // -1 ou +1: lado do canto
  float cellRad = 2.0 / float(uN) * QUARTER_PI;
  // Métrica da grade em volta de q (a menos de 1–2 células ela não muda): com X = 1 + x², Y = 1 + y²,
  // R = 1 + x² + y², a distância² na esfera para um passo (du, dv) em células é
  // cellRad² · X·Y/R² · (X·du² − 2xy·du·dv + Y·dv²). Perto dos cantos do cubo o termo cruzado inclina a
  // grade (losangos de ~120°), e a célula mais perto vira hexágono, como pedido pelo usuário. Troca
  // 4 divisões e 4 raízes por pixel por multiplicações (Mali-G52).
  vec2 one = 1.0 + xy * xy;
  float r = one.x + one.y - 1.0;
  vec3 metric = vec3(one, cellRad * cellRad * one.x * one.y / (r * r));
  float xy2 = 2.0 * xy.x * xy.y;
  // Passos (em células) de q até os centros: colunas t0.x e t0.x + s.x, linhas t0.y e t0.y + s.y.
  vec2 du = vec2(float(t0.x), float(t0.x + s.x)) + 0.5 - g.x;
  vec2 dv = vec2(float(t0.y), float(t0.y + s.y)) + 0.5 - g.y;
${ks.map(dist).join('\n')}
  ivec3 t0c = ivec3(t0, face);
  vec4 col0 = texelFetch(${cells}, t0c, 0);
  int v0 = int(col0.a * 255.0 + 0.5);
  int b = v0 & ${mask};
  int other = b;
  ivec3 pickT = t0c;
  float m = 1.0; // folga do bioma vencedor sobre o segundo (0 na divisa; 1 = sem divisa)
  // Canto da célula do lado de q (bits em src/render/colors.ts).
  int corner = (s.x > 0 ? 1 : 0) + (s.y > 0 ? 2 : 0);
  // Célula encostada em outra placa, com placas andando: vai para o caminho que separa as placas.
  bool line = ${plates ? `ownPlate >= 0 && (texelFetch(${plates}, t0c, 0).r & ${LINE_BIT}u) != 0u` : 'false'};
  if (!line && ((v0 >> (${BIOME_BITS} + corner)) & 1) != 0) {
    // Caso comum (miolo de um bioma, longe da emenda; bit do canto marcado nas cores): as 4 células
    // têm o mesmo bioma, então fica a de centro mais perto, sem divisa.
    float best = d0;
${[1, 2, 3].map((k) => `    if (d${k} < best) { best = d${k}; pickT = ivec3(t0 + ivec2(${k & 1}, ${k >> 1}) * s, face); }`).join('\n')}
  } else {
    int b0 = b;
${[1, 2, 3].map(neighbor).join('\n')}
    float inv2 = 1.0 / (uCellAngle * uCellAngle);
${ks.map(owner).join('\n')}
    if (!(ok0 || ok1 || ok2 || ok3)) { ok0 = true; ok1 = true; ok2 = true; ok3 = true; }
${ks.map(weight).join('\n')}
    // Alisamento: ganha o bioma com mais peso somado (empate: o da célula mais perto). As divisas viram
    // curvas, sem escadinha nem quina na emenda; a cor vem da célula mais perto com o bioma vencedor.
${ks.map((k) => `    float sc${k} = ${ks.map((j) => (j === k ? `w${j}` : `(b${j} == b${k} ? w${j} : 0.0)`)).join(' + ')};`).join('\n')}
    float top = -1.0;
    float near = 1e9;
${ks.map((k) => `    if (ok${k} && (sc${k} > top || (sc${k} == top && d${k} < near))) { top = sc${k}; b = b${k}; near = d${k}; }`).join('\n')}
    near = 1e9;
${ks.map((k) => `    if (ok${k} && b${k} == b && d${k} < near) { near = d${k}; pickT = ${k === 0 ? 't0c' : `t${k}c`}; }`).join('\n')}
    float second = 0.0;
${ks.map((k) => `    if (ok${k} && b${k} != b && sc${k} > second) { second = sc${k}; other = b${k}; }`).join('\n')}
    m = second > 0.0 ? (top - second) / (top + second) : 1.0;
  }
  cell = pickT == t0c ? col0 : texelFetch(${cells}, pickT, 0);
  bool water = b <= 1;
  // Cor mais viva e uma variação leve por célula (cada célula se distingue, sem borrão).
  vec3 col = cell.rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.0 + 0.25 * sq);
  col *= 1.0 + (water ? 0.03 : 0.08) * (cellHash(pickT) - 0.5) * sq;
  // Calota de perto (T7): uma fenda fina e azulada em ~1 de cada 5 células, em direção sorteada. O
  // gelo marinho fica só com o mosaico de tons (placas de gelo). Mar congelado: cor marcada nas cores
  // com o azul do mar misturado (canal azul acima do vermelho).
  if (b == ${Biome.Ice} && pickT.z == face && cell.b - cell.r < 0.06 && hashK(pickT, 39) < 0.2) {
    vec2 f = g - vec2(pickT.xy) - 0.5;
    float a = hashK(pickT, 40) * 3.1416;
    float off = (hashK(pickT, 50) - 0.5) * 0.5;
    float d = abs(dot(f, vec2(cos(a), sin(a))) - off);
    float len = abs(dot(f, vec2(-sin(a), cos(a))));
    float crack = (1.0 - smoothstep(0.01, 0.025, d)) * (1.0 - smoothstep(0.3, 0.48, len));
    col = mix(col, col * vec3(0.66, 0.78, 0.9), crack * sq);
  }
  // Jazida (T6): só nas células marcadas nas cores (bit baixo do azul) lê a textura das jazidas.
  if ((int(cell.b * 255.0 + 0.5) & ${DECOR_BIT}) != 0 && pickT.z == face) {
    col = decorate(col, texelFetch(${deposits}, pickT, 0).r, g - vec2(pickT.xy), pickT, sq);
  }
  // Contorno fino (largura fixa na tela) onde o bioma muda, não entre os dois tons de oceano; sombra
  // na água junto da terra. fwidth fora de qualquer "if": a derivada precisa dos pixels vizinhos.
  float px = max(fwidth(m), 1e-4);
  float dark = 0.0;
  bool otherWater = other <= 1;
  if (other != b && !(water && otherWater)) dark = 0.22 * (1.0 - smoothstep(0.0, 1.5 * px, m));
  if (water && other != b && !otherWater) dark = max(dark, 0.3 * (1.0 - smoothstep(0.0, ${SHADOW_WIDTH.toFixed(2)} * 2.0, m)));
  return clamp(col, 0.0, 1.0) * (1.0 - dark * sq);
}`;
}

const glslColor = (c: readonly number[]): string => `vec3(${c.map((v) => ((v as number) / 255).toFixed(3)).join(', ')})`;

/**
 * Jazida vista de perto (T6, visual aprovado pelo usuário): minério sólido vira 3 a 6 pedrinhas na cor
 * do tipo; petróleo revelado vira uma mancha preta brilhante; petróleo escondido só aparece (listrado)
 * com a camada "Ver recursos". `f`: posição dentro da célula (0–1). Tudo some de longe junto com `sq`.
 */
const DECORATE_GLSL = `
const vec3 RES_COLOR[${RESOURCE_INFO.length}] = vec3[${RESOURCE_INFO.length}](${RESOURCE_INFO.map((r) => glslColor(r.color)).join(', ')});

float hashK(ivec3 t, int k) {
  uint h = uint(t.x) * 73856093u ^ uint(t.y) * 19349663u ^ uint(t.z) * 83492791u ^ uint(k) * 2654435761u;
  h ^= h >> 13u;
  h *= 1540483477u;
  h ^= h >> 15u;
  return float(h & 1023u) / 1023.0;
}

vec3 decorate(vec3 col, uint code, vec2 f, ivec3 t, float sq) {
  int type = int(code & 31u);
  bool revealed = (code & 128u) != 0u;
  int size = int((code >> 5u) & 3u);
  vec3 rc = RES_COLOR[clamp(type, 0, ${RESOURCE_INFO.length - 1})];
  if (type == ${Resource.Oil}) {
    vec2 d = f - 0.5;
    if (!revealed) {
      // Escondido: listras na diagonal, só com a camada ligada.
      if (uResLayer == 1) col = mix(col, rc, 0.6 * step(0.5, fract((f.x + f.y) * 3.0)) * sq);
      return col;
    }
    // Revelado: mancha preta de borda irregular, com um brilho.
    float a = atan(d.y, d.x);
    float h = hashK(t, 7) * 6.2832;
    float r = 0.34 + 0.07 * sin(a * 3.0 + h) + 0.04 * sin(a * 5.0 + 2.0 * h);
    float m = 1.0 - smoothstep(r - 0.04, r + 0.02, length(d));
    vec3 stain = vec3(0.05, 0.045, 0.06) + vec3(0.32) * (1.0 - smoothstep(0.0, 0.08, length(d - vec2(-0.09, 0.1))));
    return mix(col, stain, m * sq);
  }
  // Pedrinhas: 3 (pequena), 5 (média) ou 6 (grande), em lugares fixos por célula.
  int count = size >= 3 ? 6 : size == 2 ? 5 : 3;
  for (int k = 0; k < 6; k++) {
    if (k >= count) break;
    vec2 c = 0.2 + 0.6 * vec2(hashK(t, 2 * k), hashK(t, 2 * k + 1));
    float rad = 0.09 + 0.05 * hashK(t, k + 20);
    vec2 d = (f - c) / rad;
    float l2 = dot(d, d);
    if (l2 < 1.0) {
      // Luz de cima à esquerda, borda escura e contorno suave.
      vec3 p = rc * (0.8 + 0.3 * clamp(0.6 * d.y - 0.5 * d.x, -1.0, 1.0));
      p = mix(p, p * 0.45, smoothstep(0.55, 1.0, l2));
      col = mix(col, p, (1.0 - smoothstep(0.85, 1.0, l2)) * sq);
      break;
    }
  }
  return col;
}`;

/** Largura da sombra na água junto da terra, em fração da célula. */
const SHADOW_WIDTH = 0.3;

/**
 * Funções que leem um conjunto de texturas (cores, placas, ângulos da composição), geradas duas
 * vezes: para a composição atual e para a anterior (transição suave). Gerar o código duas vezes
 * evita escolher a textura em tempo de execução: num ternário, muitas GPUs fazem as duas leituras.
 */
function setFunctions(sfx: string, cells: string, plates: string, base: string, maxDelta: string, deposits: string): string {
  return `
// Célula que contém o ponto p da esfera: cor (rgb) e código do bioma (a).
vec4 cellAt${sfx}(vec3 p) {
  ivec3 t = texelOf(p);
  return texelFetch(${cells}, t, 0);
}

// Canal R: placa, crosta continental, encosta em outra placa. Canal G: outras placas por perto.
uvec2 plateAt${sfx}(vec3 p) {
  ivec3 t = texelOf(p);
  return texelFetch(${plates}, t, 0).rg;
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
  uint v = plateAt${sfx}(s).x;
  vec3 thisFix = vec3(0.0);
  bool mine = int(v & ${PLATE_MASK}u) == pl;
  // Tolerância só onde ela pode achar outra dona: célula que encosta em outra placa.
  if (!mine && (v & ${LINE_BIT}u) != 0u) {
    float tol = uCellAngle * 0.7;
    vec3 es = normalize(vec3(s.z, 0.0, -s.x) + vec3(1e-6, 0.0, 0.0)) * tol;
    vec3 ns = cross(s, es);
    uint w = plateAt${sfx}(s + es).x;
    if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = es; }
    if (!mine) { w = plateAt${sfx}(s - es).x; if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = -es; } }
    if (!mine) { w = plateAt${sfx}(s + ns).x; if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = ns; } }
    if (!mine) { w = plateAt${sfx}(s - ns).x; if (int(w & ${PLATE_MASK}u) == pl) { mine = true; v = w; thisFix = -ns; } }
  }
  if (!mine) return;
  bool cont = (v & ${CONTINENTAL_BIT}u) != 0u;
  if (best < 0 || (cont && !bestCont)) { best = pl; bestCont = cont; bestFix = thisFix; }
}

// Qual placa está em p agora (-1 = fenda nova onde as placas se afastam). Candidatas: a placa que
// estava em p e as que estavam em volta, até a distância que as placas andaram. Fenda sem
// afastamento (só arredondamento) fica com a placa que estava em p, como a recomposição faz.
int plateNow${sfx}(vec3 p, out vec3 fix, out bool contGap) {
  fix = vec3(0.0);
  uvec2 v0 = plateAt${sfx}(p);
  // Fenda (sem dona): a célula da composição ali era continental? Então é continente se abrindo (vale).
  contGap = (v0.x & ${CONTINENTAL_BIT}u) != 0u;
  int pl0 = int(v0.x & ${PLATE_MASK}u);
  float dist = ${maxDelta} * 1.5;
  int c1; int c2; int c3; int c4;
  if (dist <= ${NEAR_REACH_CELLS.toFixed(1)} * uCellAngle) {
    // Candidatas guardadas na própria célula (placas a até alguns passos). Sem nenhuma (o miolo das
    // placas, a maior parte do planeta), só pode ser a própria placa: nem testa.
    c1 = int(v0.y & 15u);
    c2 = int(v0.y >> 4u);
    if (c1 == pl0 && c2 == pl0) return pl0;
    c3 = pl0;
    c4 = pl0;
  } else {
    // As placas andaram mais que o alcance guardado (raro): sonda 4 pontos em volta.
    vec3 e = vec3(p.z, 0.0, -p.x);
    e = dot(e, e) < 1e-12 ? vec3(1.0, 0.0, 0.0) : normalize(e);
    vec3 de = e * dist;
    vec3 dn = cross(p, e) * dist;
    c1 = int(plateAt${sfx}(p + de).x & ${PLATE_MASK}u);
    c2 = int(plateAt${sfx}(p - de).x & ${PLATE_MASK}u);
    c3 = int(plateAt${sfx}(p + dn).x & ${PLATE_MASK}u);
    c4 = int(plateAt${sfx}(p - dn).x & ${PLATE_MASK}u);
  }
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

${tileGlsl(sfx, cells, deposits, plates)}

// Cor da superfície no ponto p (antes da luz), com o conjunto de texturas ${sfx || "atual"}.
vec3 surface${sfx}(vec3 p, float cellPx) {
  // Com placas em movimento, o ruído (bordas e textura) fica preso à placa e a busca na textura
  // desfaz a rotação dela desde a composição. Parado, tudo acontece direto no ponto p.
  int pl = -1;
  bool gap = false;
  vec3 anchor = p;
  vec3 fix = vec3(0.0);
  bool contGap = false;
  if (uMoving == 1) {
    pl = plateNow${sfx}(p, fix, contGap);
    if (pl < 0) gap = true;
    else anchor = toPlate(pl, p);
  }

  // Bordas orgânicas: desloca o ponto com ruído (até ~1 célula) antes de escolher a célula.
  // A simulação continua na grade; só o desenho das fronteiras vira curva.
  vec3 q = anchor;
  float sq = smoothstep(${SQUARE_FROM_PX.toFixed(1)}, ${SQUARE_TO_PX.toFixed(1)}, cellPx);
  float warpAmount = smoothstep(0.8, 2.5, cellPx) * (1.0 - sq);
  if (warpAmount > 0.0) {
    float f = 1.0 / (uCellAngle * 1.7);
    vec3 w = noise3(anchor * f) + 0.5 * noise3(anchor.zxy * f * 2.03 + 17.0);
    q = normalize(anchor + w * (uCellAngle * 0.7 * warpAmount));
  }
  // De longe, a tolerância de arredondamento lê o ponto vizinho que é da placa ("fix", menos de 1 pixel).
  // De perto isso virava faixas de células esticadas na fronteira: lá a escolha entre as células da
  // própria placa é feita na vista de perto (remendo nas fronteiras, 2026-10-17).
  if (pl >= 0) q = toTexture${sfx}(pl, q) + (sq > 0.0 ? vec3(0.0) : fix);
  vec4 cell;
  vec3 base;
  if (gap) {
    // Fenda nova: entre dois continentes é vale de rifte (como a simulação faz), no oceano é dorsal.
    cell = vec4(contGap ? uRiftColor : uRidgeColor, 0.0);
    base = cell.rgb;
  } else if (sq > 0.0) {
    base = tile${sfx}(q, cellPx, sq, pl, cell);
  } else {
    cell = cellAt${sfx}(q);
    base = cell.rgb;
  }

  // Textura sutil por bioma (floresta e montanha mais rugosas, água e gelo quase lisos); some de perto.
  float detailAmount = smoothstep(1.5, 5.0, uCellAngle * 0.4 * uRadius) * (1.0 - sq);
  if (detailAmount > 0.0) {
    int biome = clamp(int(cell.a * 255.0 + 0.5) & ${(1 << BIOME_BITS) - 1}, 0, ${BIOME_COUNT - 1});
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
${tileGlsl('', 'uCells', 'uDeposits')}

vec3 surface(vec3 p, float cellPx) {
  vec3 q = p;
  float sq = smoothstep(${SQUARE_FROM_PX.toFixed(1)}, ${SQUARE_TO_PX.toFixed(1)}, cellPx);
  float warpAmount = smoothstep(0.8, 2.5, cellPx) * (1.0 - sq);
  if (warpAmount > 0.0) {
    float f = 1.0 / (uCellAngle * 1.7);
    vec3 w = noise3(p * f) + 0.5 * noise3(p.zxy * f * 2.03 + 17.0);
    q = normalize(p + w * (uCellAngle * 0.7 * warpAmount));
  }
  vec4 cell;
  vec3 base;
  if (sq > 0.0) {
    base = tile(q, cellPx, sq, -1, cell);
  } else {
    cell = cellAt(q);
    base = cell.rgb;
  }
  float detailAmount = smoothstep(1.5, 5.0, uCellAngle * 0.4 * uRadius) * (1.0 - sq);
  if (detailAmount > 0.0) {
    int biome = clamp(int(cell.a * 255.0 + 0.5) & ${(1 << BIOME_BITS) - 1}, 0, ${BIOME_COUNT - 1});
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
uniform highp usampler2DArray uDepositsPrev; // jazidas da composição anterior
uniform float uFade; // 1 = só a atual; de 0 a 1 logo depois de uma recomposição

// ---- Movimento suave das placas entre recomposições (mesma regra de src/render/plate-motion.ts) ----
// A textura mostra o mundo composto com as placas nos ângulos "base"; cada placa é rígida, então o
// conteúdo de p agora é o que estava no ponto desgirado pela rotação que a placa fez desde então.
uniform highp usampler2DArray uPlates; // R: placa e marcas; G: outras placas por perto (plate-motion.ts)
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
uniform vec3 uRiftColor;                // fenda nova entre dois continentes (vale de rifte)

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

${setFunctions('', 'uCells', 'uPlates', 'uPlateBase', 'uMaxDelta', 'uDeposits')}
${setFunctions('Prev', 'uCellsPrev', 'uPlatesPrev', 'uPlateBasePrev', 'uMaxDeltaPrev', 'uDepositsPrev')}
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
uniform highp usampler2DArray uDeposits; // jazidas (T6): código de 1 byte por célula
uniform int uResLayer;    // 1 = camada "Ver recursos" ligada

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

// atan(x)/(π/4) para |x| ≤ 1 (dentro de uma face sempre é): polinômio ímpar de grau 11 (Abramowitz
// & Stegun 4.4.49, erro ≤ 1e-5 rad ≈ 0,2% de uma célula). Na Mali-G52 o atan nativo é bem mais caro, e
// cada consulta de textura faz dois.
vec2 atanQuarter(vec2 x) {
  vec2 x2 = x * x;
  vec2 r = x * (0.99997726 + x2 * (-0.33262347 + x2 * (0.19354346 + x2 * (-0.11643287 + x2 * (0.05265332 + x2 * -0.01172120)))));
  return r * (1.0 / QUARTER_PI);
}

// Texel (x, y, face) da célula que contém o ponto p da esfera.
ivec3 texelOf(vec3 p) {
  int face; vec3 n; vec3 u; vec3 v;
  faceFrame(p, face, n, u, v);
  float dn = dot(p, n);
  vec2 ab = atanQuarter(vec2(dot(p, u), dot(p, v)) / dn);
  ivec2 texel = clamp(ivec2(floor((ab + 1.0) * 0.5 * float(uN))), ivec2(0), ivec2(uN - 1));
  return ivec3(texel, face);
}

${DECORATE_GLSL}

// Número fixo de 0 a 1 para cada célula (variação de cor por célula, sem textura).
float cellHash(ivec3 t) {
  uint h = uint(t.x) * 73856093u ^ uint(t.y) * 19349663u ^ uint(t.z) * 83492791u;
  h ^= h >> 13u;
  h *= 1540483477u;
  h ^= h >> 15u;
  return float(h & 1023u) / 1023.0;
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
