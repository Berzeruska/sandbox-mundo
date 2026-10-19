import { newArray } from '../core/shared';
import { Biome, BIOME_INFO } from '../world/biomes';
import { CellState, cellHash, hasVegetation } from '../world/disasters/ground';
import { patchNoise } from '../world/disasters/drought';
import { SEA_ICE_TEMP } from '../world/climate';
import { ALL_RESOURCES, depositType, isHiddenOil, isRevealed, Resource, RESOURCE_INFO } from '../world/resources';
import type { CubeSphere } from '../world/cubesphere';
import type { WorldState } from '../world/state';

/**
 * Cor de cada célula: a cor do bioma, um pouco mais clara nas terras altas e mais escura no oceano
 * profundo. O canal alfa leva o código do bioma (bits 0–3), que o shader usa para a textura de detalhe
 * e para as divisas de perto, e os bits dos cantos (`BIOME_BITS`).
 * (Não há mais variação de brilho por célula: ela desenhava a grade na tela — ver T13.)
 */
/** Camadas opcionais desenhadas por cima dos biomas (escolhidas no menu). */
export interface Layers {
  plates: boolean;
  /** Camada "Ver biomas" (T7): cada bioma numa cor forte e lisa, para ler de longe. */
  biomes: boolean;
  /** Camada "Ver recursos" (T6) e os tipos mostrados nela (bit = código do tipo). */
  resources: boolean;
  resourceMask: number;
  /** Camada "Ver tensão" (T11): o mundo acinzentado; quem pinta as fronteiras é o relógio (`tintStress`). */
  stress: boolean;
}

export const NO_LAYERS: Layers = { plates: false, biomes: false, resources: false, resourceMask: ALL_RESOURCES, stress: false };

/**
 * Bit mais baixo do azul na textura de cores: a célula tem algo a desenhar de perto (pedrinhas,
 * petróleo revelado ou, com a camada ligada, petróleo escondido). Assim o shader só lê a textura das
 * jazidas nessas células (~1% da terra). Mudar o azul em 1/255 não aparece.
 */
export const DECOR_BIT = 1;
/** Quanto a cor do minério puxa o solo, de longe (visão normal). */
const SOIL_TINT = 0.22;
/** Petróleo revelado: mancha escura (em terra e no mar). */
const OIL_STAIN: readonly [number, number, number] = [22, 20, 26];

/**
 * Cores da camada "Ver biomas" (T7, pedido do usuário: floresta, deserto e campo legíveis de longe):
 * uma cor forte e bem diferente por bioma. Índice = código do bioma.
 */
export const BIOME_LAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [18, 36, 86], // oceano profundo
  [40, 92, 160], // oceano raso
  [250, 234, 168], // praia
  [255, 255, 255], // gelo
  [150, 196, 206], // tundra
  [26, 92, 84], // taiga
  [38, 150, 58], // floresta temperada
  [158, 214, 76], // campo
  [214, 204, 120], // estepe
  [250, 196, 76], // deserto quente
  [196, 160, 126], // deserto frio
  [228, 150, 52], // savana
  [8, 96, 28], // floresta tropical
  [120, 92, 160], // pântano
  [126, 106, 96], // montanha
  [232, 232, 246], // pico nevado
];

/**
 * Gelo (T7, "não parecia gelo"): calota em terra branca com a borda azulada e um pouco de variação;
 * gelo marinho mais fino, deixando ver um pouco do mar, e mais azul na borda (onde ele quebra).
 */
const iceOut = new Float64Array(3);
const SEA_COLOR = BIOME_INFO[1]?.color ?? [44, 98, 160];

/** Escreve em `iceOut` (sem criar array por célula: roda no mundo todo a cada recálculo de clima). */
function iceColor(world: WorldState, i: number, h: number, r: number, g: number, b: number): void {
  const { neighbors } = world.grid;
  let edge = false;
  for (let d = 0; d < 4 && !edge; d++) edge = !world.ice[neighbors[i * 4 + d] as number];
  const v = ((Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d) >>> 0) / 4294967296 - 0.5) * (h > 0 ? 10 : 18);
  if (h > 0) {
    const kr = edge ? 0.82 : 1;
    const kg = edge ? 0.9 : 1;
    const kb = edge ? 0.98 : 1;
    iceOut[0] = r * kr + v;
    iceOut[1] = g * kg + v;
    iceOut[2] = b * kb + v;
    return;
  }
  // Mar congelado: espessura pela temperatura (fino perto da borda, deixa ver o mar; grosso e branco
  // no miolo), tons por placa de gelo e a borda partida mais azul.
  const thick = Math.min(1, Math.max(0, (SEA_ICE_TEMP - (world.temperature[i] as number)) / 12));
  const t = (edge ? 0.5 : 0.42) - 0.36 * thick;
  iceOut[0] = r + ((SEA_COLOR[0] as number) - r) * t + v;
  iceOut[1] = g + ((SEA_COLOR[1] as number) - g) * t + v;
  iceOut[2] = b + ((SEA_COLOR[2] as number) - b) * t + v;
}

/** Cores das fronteiras de placa na camada "Ver placas", por tipo (`Boundary`). */
export const BOUNDARY_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // sem fronteira (não usado)
  [235, 64, 52], // convergente
  [64, 150, 255], // divergente
  [250, 205, 60], // transformante
];
/** Quanto a cor da placa tinge o bioma na camada "Ver placas". */
const PLATE_TINT = 0.38;

/**
 * Halo das jazidas na camada "Ver recursos": cada jazida do filtro tinge até HALO_CELLS células em volta
 * (mais fraco com a distância), para aparecer de longe, onde uma célula tem 1–2 pixels. Valor: tipo nos
 * bits 0–4 e distância (1–HALO_CELLS) nos bits 5–7; 0 = longe. Guardado por mundo e filtro: as jazidas
 * só mudam numa recomposição, que repinta tudo.
 */
const HALO_CELLS = 5;
const halos = new WeakMap<WorldState, { mask: number; halo: Uint8Array }>();

function resourceHalo(world: WorldState, mask: number, rebuild: boolean): Uint8Array {
  const cached = halos.get(world);
  if (cached && !rebuild && cached.mask === mask) return cached.halo;
  const n = world.cellCount;
  const halo = cached && cached.halo.length === n ? cached.halo : new Uint8Array(n);
  halo.fill(0);
  const { neighbors } = world.grid;
  let frontier: number[] = [];
  for (let c = 0; c < n; c++) {
    const type = depositType(world.deposit[c] as number);
    if (type && (mask >>> type) & 1) frontier.push(c);
  }
  const seen = new Uint8Array(n);
  for (const c of frontier) seen[c] = 1;
  for (let d = 1; d <= HALO_CELLS && frontier.length; d++) {
    const next: number[] = [];
    for (const c of frontier) {
      const type = d === 1 ? depositType(world.deposit[c] as number) : (halo[c] as number) & 31;
      for (let k = 0; k < 4; k++) {
        const j = neighbors[c * 4 + k] as number;
        if (seen[j]) continue;
        seen[j] = 1;
        halo[j] = type | (d << 5);
        next.push(j);
      }
    }
    frontier = next;
  }
  halos.set(world, { mask, halo });
  return halo;
}

/**
 * O chão depois dos desastres (`src/world/disasters/ground.ts`): vegetação (0–1) e estado de cada
 * célula. Só o relógio tem; as cores do ajudante saem sem ele e o relógio repinta por cima as células
 * com algo.
 */
export interface GroundView {
  readonly cover: Float32Array;
  readonly state: Uint8Array;
  strength(c: number): number;
  /** Intensidade do estado (0–1): calor da seca, profundidade da enchente. */
  levelOf(c: number): number;
  /** Rocha de vulcão (0 nenhuma; 1–254 cone, do pé à borda; 255 cratera). */
  readonly rock: Uint8Array;
}

/**
 * A cor usa a vegetação e a força do estado nos mesmos degraus que decidem quando repintar (`Ground`:
 * 4% e 8 níveis): assim a cor não depende de quando exatamente a célula foi repintada (o relógio junta
 * as repinturas de vários passos), e o mundo sai igual em qualquer velocidade.
 */
const stepCover = (v: number): number => Math.round(v * 25) / 25;
const stepStrength = (v: number): number => Math.ceil(v * 7) / 7;

class SteppedGround implements GroundView {
  g: GroundView | undefined = undefined;
  get cover(): Float32Array {
    return (this.g as GroundView).cover;
  }
  get state(): Uint8Array {
    return (this.g as GroundView).state;
  }
  strength(c: number): number {
    return stepStrength((this.g as GroundView).strength(c));
  }
  levelOf(c: number): number {
    return (this.g as GroundView).levelOf(c);
  }
  get rock(): Uint8Array {
    return (this.g as GroundView).rock;
  }
}
const stepped = new SteppedGround();

export function writeCellColor(world: WorldState, i: number, out: Uint8Array, layers: Layers = NO_LAYERS, halo?: Uint8Array, rawGround?: GroundView): void {
  stepped.g = rawGround;
  const ground = rawGround ? stepped : undefined;
  const biome = world.biome[i] as number;
  const info = BIOME_INFO[biome];
  if (!info) throw new Error(`Bioma inválido na célula ${i}`);
  const h = world.heightAboveSea(i);
  // Camadas de leitura (biomas, recursos, tensão) mostram o mundo sem os desastres.
  const showGround = ground !== undefined && h > 0 && !world.ice[i] && !layers.biomes && !layers.resources && !layers.stress;
  let base: readonly number[] = info.color;
  if (showGround && (ground.cover[i] as number) < 1) base = vegetationColor(biome, stepCover(ground.cover[i] as number)) ?? base;
  if (showGround && ground.rock[i]) base = rockColor(ground.rock[i] as number, base);
  let k: number;
  if (h <= 0 && !world.ice[i]) k = 1.12 - 0.42 * Math.min(1, -h / 5000);
  else k = (world.ice[i] ? 0.94 : 0.88) + 0.2 * Math.min(1, Math.max(0, h) / 6000);
  if (h > 0) k *= hillshade(world, i);
  let r = Math.min(255, (base[0] as number) * k);
  let g = Math.min(255, (base[1] as number) * k);
  let b = Math.min(255, (base[2] as number) * k);
  if (h > 0 && !world.ice[i]) {
    // Relevo em degraus (RL): sombra ao pé do degrau de cima, borda clara no de baixo.
    const t = terraceShade(world, i);
    const f = t >= 0 ? TERRACE_LIGHT : TERRACE_SHADOW;
    const a = Math.abs(t);
    r += (f[0] - r) * a;
    g += (f[1] - g) * a;
    b += (f[2] - b) * a;
  }
  if (world.ice[i]) {
    iceColor(world, i, h, r, g, b);
    r = iceOut[0] as number;
    g = iceOut[1] as number;
    b = iceOut[2] as number;
  }
  const seaState = ground !== undefined && h <= 0 && !world.ice[i] && !layers.biomes && !layers.resources && !layers.stress ? (ground.state[i] as number) : 0;
  if (seaState === CellState.Seabed || seaState === CellState.Wave) {
    tsunamiSeaColor(ground as GroundView, i, seaState, h, r, g, b);
    r = stateOut[0] as number;
    g = stateOut[1] as number;
    b = stateOut[2] as number;
  } else if (showGround && ground.state[i] === CellState.Surge) {
    const front = ground.strength(i) > 0.85;
    const c = front ? SURGE_FRONT : SURGE_WATER;
    const t = front ? 1 : 0.9;
    r += (c[0] - r) * t;
    g += (c[1] - g) * t;
    b += (c[2] - b) * t;
  } else if (showGround && ground.state[i] === CellState.Heat) {
    droughtColor(world, ground, biome, i, r, g, b);
    r = stateOut[0] as number;
    g = stateOut[1] as number;
    b = stateOut[2] as number;
  } else if (showGround && (ground.state[i] === CellState.Slide || ground.state[i] === CellState.Crack)) {
    quakeColor(ground, i, r, g, b);
    r = stateOut[0] as number;
    g = stateOut[1] as number;
    b = stateOut[2] as number;
  } else if (showGround && ground.state[i]) {
    stateColor(biome, i, ground.state[i] as number, ground.strength(i), r, g, b);
    r = stateOut[0] as number;
    g = stateOut[1] as number;
    b = stateOut[2] as number;
  }
  if (layers.biomes && !layers.resources) {
    // Cor forte e lisa por bioma (sem sombreado nem gelo marinho misturado): para ler de longe.
    const c = BIOME_LAYER_COLORS[world.biome[i] as number] ?? [255, 0, 255];
    r = c[0];
    g = c[1];
    b = c[2];
  }
  if (layers.stress && !layers.resources) {
    // Terreno acinzentado e claro: as fronteiras pintadas pela tensão saltam aos olhos.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum * 0.45 + 70;
    g = lum * 0.45 + 72;
    b = lum * 0.45 + 78;
  }
  // Jazida coberta de gelo não aparece (nem pedrinhas): só na camada "Ver recursos". Na camada "Ver
  // tensão" também não (só as fronteiras têm cor).
  const code = (world.ice[i] || layers.stress) && !layers.resources ? 0 : (world.deposit[i] as number);
  let decor = false;
  if (layers.resources) {
    // Terreno acinzentado e escurecido; jazidas do filtro fortes na cor do tipo.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum * 0.5 + 18;
    g = lum * 0.5 + 20;
    b = lum * 0.5 + 26;
    const type = depositType(code);
    if (type && (layers.resourceMask >>> type) & 1) {
      const c = RESOURCE_INFO[type]?.color ?? [255, 255, 255];
      // Petróleo escondido: listrado (células alternadas), o jogador sabe e os humanos não.
      const n = world.grid.n;
      const stripe = isHiddenOil(code) && ((i % n) + Math.floor(i / n)) % 2 === 0;
      const t = stripe ? 0.35 : 0.9;
      const target = type === Resource.Oil ? (isRevealed(code) ? OIL_STAIN : [12, 10, 14]) : c;
      r += (target[0] - r) * t;
      g += (target[1] - g) * t;
      b += (target[2] - b) * t;
    } else if (halo && halo[i]) {
      const hv = halo[i] as number;
      const c = RESOURCE_INFO[hv & 31]?.color ?? [255, 255, 255];
      const t = 0.62 - 0.1 * (hv >> 5);
      r += (c[0] - r) * t;
      g += (c[1] - g) * t;
      b += (c[2] - b) * t;
    }
    decor = code !== 0;
  } else if (code) {
    const type = depositType(code);
    if (type === Resource.Oil) {
      if (isRevealed(code)) {
        const t = h > 0 ? 0.55 : 0.45;
        r += (OIL_STAIN[0] - r) * t;
        g += (OIL_STAIN[1] - g) * t;
        b += (OIL_STAIN[2] - b) * t;
        decor = true;
      }
    } else if (h > 0) {
      const c = RESOURCE_INFO[type]?.color;
      if (c) {
        r += (c[0] - r) * SOIL_TINT;
        g += (c[1] - g) * SOIL_TINT;
        b += (c[2] - b) * SOIL_TINT;
        decor = true;
      }
    }
  }
  if (layers.plates) {
    const kind = world.boundary[i] as number;
    const tint = kind ? BOUNDARY_COLORS[kind] : world.plates[world.plate[i] as number]?.color;
    const t = kind ? 1 : PLATE_TINT;
    if (tint) {
      r += (tint[0] - r) * t;
      g += (tint[1] - g) * t;
      b += (tint[2] - b) * t;
    }
  }
  // Prende em 0–255: a textura é Uint8Array, que dá a volta (260 vira 4) em vez de prender. Era isso
  // que pintava pontos rosa e azul-forte no gelo claro (teste da 50f0dca).
  const o = i * 4;
  out[o] = clampByte(r);
  out[o + 1] = clampByte(g);
  out[o + 2] = (clampByte(b) & ~DECOR_BIT) | (decor ? DECOR_BIT : 0);
  out[o + 3] = (world.biome[i] as number) | (sameCorners(world, i) << BIOME_BITS);
}

const clampByte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/**
 * Canal alfa da textura de cores: bioma nos 4 bits de baixo e, nos 4 de cima, um bit por canto da
 * célula (bit 4 + cx + 2·cy, com cx = 1 para o lado +x da grade e cy = 1 para o lado +y): as 3 células
 * na direção daquele canto estão na mesma face e têm o mesmo bioma. De perto, o pixel perto desse canto
 * lê 1 ou 2 células em vez de 4 (vista de perto alisada no celular, 2026-10-17). Muda quando o bioma
 * de uma vizinha muda: quem repinta só uma região repinta também o anel em volta (`withRing`).
 * Limite: 16 biomas (teste em tests/render/colors.test.ts).
 */
export const BIOME_BITS = 4;

function sameCorners(world: WorldState, i: number): number {
  const n = world.grid.n;
  const x = i % n;
  const y = ((i - x) / n) % n;
  const biome = world.biome;
  const b = biome[i];
  // Vizinhas iguais: oeste/leste e sul/norte (fora da face = diferente), depois as diagonais.
  const w = x > 0 && biome[i - 1] === b;
  const e = x < n - 1 && biome[i + 1] === b;
  const s = y > 0 && biome[i - n] === b;
  const nn = y < n - 1 && biome[i + n] === b;
  let bits = 0;
  if (w && s && biome[i - n - 1] === b) bits |= 1;
  if (e && s && biome[i - n + 1] === b) bits |= 2;
  if (w && nn && biome[i + n - 1] === b) bits |= 4;
  if (e && nn && biome[i + n + 1] === b) bits |= 8;
  return bits;
}

/**
 * As células e o anel de 1 célula em volta (na mesma face, com as diagonais): os bits dos cantos das
 * vizinhas dependem do bioma da célula.
 */
export function withRing(grid: CubeSphere, cells: readonly number[]): number[] {
  const n = grid.n;
  const out = new Set<number>(cells);
  for (const c of cells) {
    const x = c % n;
    const y = Math.floor(c / n) % n;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) out.add(c + dy * n + dx);
      }
    }
  }
  return [...out];
}

/** Força máxima do sombreado de relevo (±35% de brilho). */
const SHADE_STRENGTH = 0.35;
/** Inclinação (metros de subida por célula) que dá ~76% da força máxima do sombreado. */
const SHADE_SLOPE = 400;

/** Pesos fixos do sombreado por grade: 4 por célula (um por vizinho). */
const shadeWeights = new WeakMap<CubeSphere, Float32Array>();

/** Bytes da tabela de sombreado guardada para esta grade, para o painel Dados. */
export function colorCacheBytes(grid: CubeSphere): number {
  return shadeWeights.get(grid)?.byteLength ?? 0;
}

/**
 * Para cada célula e vizinho: quanto 1 metro de subida rumo àquele vizinho conta como "subir em
 * direção à luz" (noroeste), em metros por célula. Só depende da geometria da grade, então é
 * calculado uma vez e o sombreado vira 4 multiplicações por célula.
 */
export function shadeWeightsFor(grid: CubeSphere): Float32Array {
  const cached = shadeWeights.get(grid);
  if (cached) return cached;
  const { positions, neighbors, cellAngle } = grid;
  const w = newArray(Float32Array, grid.cellCount * 4);
  for (let i = 0; i < grid.cellCount; i++) {
    const px = positions[i * 3] as number;
    const py = positions[i * 3 + 1] as number;
    const pz = positions[i * 3 + 2] as number;
    // Direção noroeste no plano tangente.
    let ex = pz;
    let ez = -px;
    const elen = Math.hypot(ex, ez) || 1;
    ex /= elen;
    ez /= elen;
    const lx = (py * ez - ex) * Math.SQRT1_2;
    const ly = (pz * ex - px * ez) * Math.SQRT1_2;
    const lz = (-py * ex - ez) * Math.SQRT1_2;
    for (let d = 0; d < 4; d++) {
      const j = neighbors[i * 4 + d] as number;
      const dx = (positions[j * 3] as number) - px;
      const dy = (positions[j * 3 + 1] as number) - py;
      const dz = (positions[j * 3 + 2] as number) - pz;
      const len2 = dx * dx + dy * dy + dz * dz;
      // Gradiente por diferenças: cada eixo entra duas vezes (4 vizinhos), daí o 0,5.
      w[i * 4 + d] = (0.5 * cellAngle * (dx * lx + dy * ly + dz * lz)) / len2;
    }
  }
  shadeWeights.set(grid, w);
  return w;
}

/** Usa a tabela de sombreado de outro ajudante (memória compartilhada) para esta grade. */
export function adoptShadeWeights(grid: CubeSphere, weights: Float32Array): void {
  if (weights.length !== grid.cellCount * 4) throw new Error('Tabela de sombreado com tamanho diferente');
  shadeWeights.set(grid, weights);
}

/**
 * Sombreado de relevo (só visual): encostas viradas para o noroeste (de onde vem a luz) ficam mais
 * claras, as viradas para o sudeste mais escuras. A inclinação é medida em metros por célula, com
 * os 4 vizinhos em 3D, então não tem emenda entre as faces do cubo. Terra plana = 1.
 */
export function hillshade(world: WorldState, i: number): number {
  const weights = shadeWeightsFor(world.grid);
  const { neighbors } = world.grid;
  const hi = Math.max(0, world.heightAboveSea(i));
  let upTowardLight = 0;
  for (let d = 0; d < 4; d++) {
    const j = neighbors[i * 4 + d] as number;
    upTowardLight += (Math.max(0, world.heightAboveSea(j)) - hi) * (weights[i * 4 + d] as number);
  }
  // Terreno que sobe rumo à luz tem a encosta virada para longe dela: mais escuro.
  return 1 - SHADE_STRENGTH * Math.tanh(upTowardLight / SHADE_SLOPE);
}

/**
 * Relevo em degraus (RL, opção b aprovada pelo usuário em 2026-10-18): a altura em terra é dividida em
 * níveis de TERRACE_METERS. Para cada vizinha do lado da luz (noroeste): se ela está num nível acima, a
 * célula fica na sombra do degrau; se está abaixo, a célula é a borda iluminada. Parece um mapa em
 * terraços. Soma-se ao sombreado suave de encosta (`hillshade`).
 */
export const TERRACE_METERS = 150;
const TERRACE_UP = -0.22;
const TERRACE_DOWN = 0.16;
const TERRACE_MIN = -0.35;
const TERRACE_MAX = 0.3;
const TERRACE_LIGHT: readonly [number, number, number] = [255, 250, 230];
const TERRACE_SHADOW: readonly [number, number, number] = [20, 24, 40];

/** Quanto a célula de terra `i` clareia (+) ou escurece (−) pelos degraus, de −0,35 a +0,3. */
export function terraceShade(world: WorldState, i: number): number {
  const weights = shadeWeightsFor(world.grid);
  const { neighbors } = world.grid;
  const level = Math.floor(Math.max(0, world.heightAboveSea(i)) / TERRACE_METERS);
  let t = 0;
  for (let d = 0; d < 4; d++) {
    // Peso positivo: a vizinha fica do lado de onde vem a luz.
    if ((weights[i * 4 + d] as number) <= 0) continue;
    const j = neighbors[i * 4 + d] as number;
    const lj = Math.floor(Math.max(0, world.heightAboveSea(j)) / TERRACE_METERS);
    if (lj > level) t += TERRACE_UP;
    else if (lj < level) t += TERRACE_DOWN;
  }
  return Math.max(TERRACE_MIN, Math.min(TERRACE_MAX, t));
}

/** Preenche as cores do mundo todo (ou só das células listadas). */
export function buildColors(world: WorldState, out: Uint8Array, cells?: Iterable<number>, layers: Layers = NO_LAYERS, ground?: GroundView): void {
  // Repintura completa refaz o halo (as jazidas podem ter andado); a parcial (pincel) reaproveita.
  const halo = layers.resources ? resourceHalo(world, layers.resourceMask, !cells) : undefined;
  if (cells) for (const c of cells) writeCellColor(world, c, out, layers, halo, ground);
  else for (let i = 0; i < world.cellCount; i++) writeCellColor(world, i, out, layers, halo, ground);
}

/**
 * Solo nu de cada bioma com vegetação (R2): a cor da célula vai da cor do bioma até esta conforme a
 * vegetação cai. Floresta a 30% fica marrom com manchas verdes.
 */
export const SOIL_COLORS: Readonly<Partial<Record<number, readonly [number, number, number]>>> = {
  [Biome.Tundra]: [140, 128, 108],
  [Biome.Taiga]: [100, 86, 66],
  [Biome.TemperateForest]: [116, 90, 60],
  [Biome.Grassland]: [168, 144, 102],
  [Biome.Steppe]: [166, 146, 110],
  [Biome.Savanna]: [160, 132, 96],
  [Biome.TropicalForest]: [120, 86, 54],
  [Biome.Swamp]: [98, 90, 66],
};
/** Floresta que volta passa por campo: abaixo desta cobertura ela tem cara de campo. */
const FOREST_AS_GRASS = 0.5;
const FORESTS: ReadonlySet<number> = new Set([Biome.Taiga, Biome.TemperateForest, Biome.TropicalForest]);
const GRASS_COLOR = BIOME_INFO[Biome.Grassland]?.color ?? [138, 186, 80];
const vegOut: [number, number, number] = [0, 0, 0];

/** Cor do bioma com a vegetação em `cover` (0–1), ou null se o bioma não tem vegetação. */
export function vegetationColor(biome: number, cover: number): readonly [number, number, number] | null {
  const soil = SOIL_COLORS[biome];
  const full = BIOME_INFO[biome]?.color;
  if (!soil || !full) return null;
  let from: readonly number[] = soil;
  let to: readonly number[] = full;
  let t = Math.max(0, Math.min(1, cover));
  if (FORESTS.has(biome)) {
    if (t < FOREST_AS_GRASS) {
      to = GRASS_COLOR;
      t /= FOREST_AS_GRASS;
    } else {
      from = GRASS_COLOR;
      t = (t - FOREST_AS_GRASS) / (1 - FOREST_AS_GRASS);
    }
  }
  for (let k = 0; k < 3; k++) vegOut[k] = (from[k] as number) + ((to[k] as number) - (from[k] as number)) * t;
  return vegOut;
}

/**
 * Cor de cada estado de célula (R2): [r, g, b, mistura] e, para alguns, um segundo tom sorteado por
 * célula (o desenho célula a célula, sem mancha lisa). A força do estado (1 → 0) vai apagando a cor.
 */
const STATE_COLORS: Readonly<Record<number, { a: readonly [number, number, number]; b?: readonly [number, number, number]; mix: number; hold?: number }>> = {
  [CellState.Burning]: { a: [255, 100, 18], b: [244, 150, 34], mix: 1, hold: 99 },
  [CellState.Burned]: { a: [36, 30, 28], b: [48, 40, 34], mix: 0.85, hold: 2 },
  [CellState.Lava]: { a: [255, 120, 26], b: [232, 70, 20], mix: 1, hold: 99 },
  [CellState.Basalt]: { a: [40, 38, 42], b: [50, 46, 48], mix: 0.95, hold: 4 },
  [CellState.Flooded]: { a: [104, 118, 116], b: [92, 110, 114], mix: 0.85, hold: 3 },
  [CellState.Mud]: { a: [124, 110, 92], b: [112, 100, 86], mix: 0.85, hold: 3 },
  [CellState.Fertile]: { a: [52, 150, 52], mix: 0.3, hold: 2 },
  [CellState.Ash]: { a: [118, 112, 108], b: [132, 126, 120], mix: 0.7, hold: 1.5 },
  [CellState.Lake]: { a: [52, 108, 160], b: [48, 102, 152], mix: 1, hold: 20 },
  [CellState.Meltwater]: { a: [112, 118, 112], b: [96, 108, 108], mix: 0.95, hold: 99 },
  [CellState.Outwash]: { a: [170, 162, 146], b: [156, 150, 138], mix: 0.9, hold: 3 },
  [CellState.Impact]: { a: [58, 52, 50], b: [82, 74, 70], mix: 0.95, hold: 4 },
  [CellState.Ejecta]: { a: [176, 160, 140], b: [160, 146, 128], mix: 0.9, hold: 3 },
  [CellState.Sand]: { a: [232, 204, 140], b: [220, 190, 128], mix: 0.7, hold: 2 },
};
const stateOut = new Float64Array(3);
/** Queimado em campo, estepe ou savana: mais claro que floresta queimada (cinza de capim). */
const GRASS_BURNED: readonly [number, number, number] = [62, 54, 46];
const GRASSY: ReadonlySet<number> = new Set([Biome.Grassland, Biome.Steppe, Biome.Savanna]);
const FIRE_FRONT: readonly [number, number, number] = [255, 214, 90];

/** Escreve em `stateOut` a cor (r, g, b) com o estado `state` de força `strength` por cima. */
function stateColor(biome: number, i: number, state: number, strength: number, r: number, g: number, b: number): void {
  const sc = STATE_COLORS[state];
  if (!sc || strength <= 0) {
    stateOut[0] = r;
    stateOut[1] = g;
    stateOut[2] = b;
    return;
  }
  let c = sc.b && cellHash(i, state) < 0.5 ? sc.b : sc.a;
  if (state === CellState.Burned && GRASSY.has(biome)) c = GRASS_BURNED;
  // A frente do fogo (recém-acesa) é amarela; o que queima há mais tempo fica laranja.
  if (state === CellState.Burning && strength > 0.6) c = FIRE_FRONT;
  // Fica forte quase até o fim e some no último pedaço (`hold`: quanto maior, mais tarde começa a sumir).
  const t = sc.mix * Math.min(1, strength * (sc.hold ?? 1.5));
  stateOut[0] = r + (c[0] - r) * t;
  stateOut[1] = g + (c[1] - g) * t;
  stateOut[2] = b + (c[2] - b) * t;
}

/**
 * Semiárido da seca (R4, imagem `docs/img/m2-dv-seca-v2.png`): cada célula vira chão claro, moita
 * cinza-esverdeada, árvore seca ou, no miolo mais quente, chão avermelhado, sorteados por manchas fixas
 * (sem mancha borrada por cima). Aparece conforme a vegetação morre; no deserto, só o chão avermelhado
 * do calor.
 */
const DRY_GROUND: readonly (readonly [number, number, number])[] = [[192, 168, 126], [182, 158, 118]];
const DRY_SHRUB: readonly (readonly [number, number, number])[] = [[116, 122, 90], [130, 132, 98]];
const DRY_TREE: readonly [number, number, number] = [148, 140, 128];
const HOT_GROUND: readonly [number, number, number] = [178, 124, 90];

function droughtColor(world: WorldState, ground: GroundView, biome: number, i: number, r: number, g: number, b: number): void {
  const k = ground.levelOf(i);
  const fine = cellHash(i, 0x51);
  const hot = patchNoise(world, i, 4);
  let c: readonly number[];
  if (hot < 0.3 * k * k && fine < 0.8) c = HOT_GROUND;
  else if (patchNoise(world, i, 3) < 0.45 - 0.15 * k) c = DRY_SHRUB[fine < 0.5 ? 0 : 1] as readonly number[];
  else if (fine > 0.93) c = DRY_TREE;
  else c = DRY_GROUND[fine < 0.5 ? 0 : 1] as readonly number[];
  // Onde não há vegetação (deserto), só o calor avermelha um pouco; onde há, o semiárido aparece
  // conforme ela morre (perdeu metade = semiárido completo).
  const t = hasVegetation(biome) ? Math.min(1, (1 - stepCover(ground.cover[i] as number)) * 2) : 0.25 * k;
  const target = hasVegetation(biome) ? c : HOT_GROUND;
  stateOut[0] = r + ((target[0] as number) - r) * t;
  stateOut[1] = g + ((target[1] as number) - g) * t;
  stateOut[2] = b + ((target[2] as number) - b) * t;
}

/**
 * Terremoto (R5, imagem `docs/img/m2-dv-terremoto-v2.png`): fenda quase preta no meio (larga) e marrom
 * escura nas pontas; deslizamento com cicatriz clara no topo, terra no meio e entulho escuro no pé. A
 * cor fica forte por muitos anos e some no fim, enquanto a vegetação cobre.
 */
const CRACK_DEEP: readonly [number, number, number] = [26, 20, 20];
const CRACK_EDGE: readonly [number, number, number] = [58, 46, 42];
const SLIDE_SCAR: readonly [number, number, number] = [204, 180, 148];
const SLIDE_MID: readonly [number, number, number] = [170, 138, 106];
const SLIDE_DEBRIS: readonly [number, number, number] = [116, 96, 80];

function quakeColor(ground: GroundView, i: number, r: number, g: number, b: number): void {
  const level = ground.levelOf(i);
  const crack = ground.state[i] === CellState.Crack;
  const c = crack ? (level > 0.5 ? CRACK_DEEP : CRACK_EDGE) : level < 0.3 ? SLIDE_SCAR : level < 0.75 ? SLIDE_MID : SLIDE_DEBRIS;
  const t = Math.min(1, ground.strength(i) * 3) * (crack ? 0.95 : 0.9);
  stateOut[0] = r + (c[0] - r) * t;
  stateOut[1] = g + (c[1] - g) * t;
  stateOut[2] = b + (c[2] - b) * t;
}

/**
 * Tsunami (R6, imagem `docs/img/m2-dv-tsunami.png`): o mar raso que recua mostra o fundo (areia
 * molhada, mais escura no mais fundo); a faixa de espuma é branca-azulada na frente e azul atrás; a
 * água do mar sobre a terra é azul, com a frente branca.
 */
const SEABED: readonly (readonly [number, number, number])[] = [[182, 164, 120], [160, 144, 108], [120, 128, 116]];
const FOAM: readonly [number, number, number] = [214, 232, 246];
const FOAM_TAIL: readonly [number, number, number] = [120, 170, 214];
const SURGE_WATER: readonly [number, number, number] = [88, 140, 176];
const SURGE_FRONT: readonly [number, number, number] = [236, 244, 252];

function tsunamiSeaColor(ground: GroundView, i: number, state: number, h: number, r: number, g: number, b: number): void {
  let c: readonly number[];
  let t: number;
  if (state === CellState.Seabed) {
    c = SEABED[-h < 60 ? 0 : -h < 120 ? 1 : 2] as readonly number[];
    t = 0.9;
  } else {
    const fresh = ground.strength(i) > 0.6;
    c = fresh ? FOAM : FOAM_TAIL;
    t = fresh ? 0.95 : 0.6;
  }
  stateOut[0] = r + ((c[0] as number) - r) * t;
  stateOut[1] = g + ((c[1] as number) - g) * t;
  stateOut[2] = b + ((c[2] as number) - b) * t;
}

/**
 * Vulcão (R7, imagem `docs/img/m2-dv-vulcao-v2.png`): o cone em tons de rocha marrom-acinzentada (mais
 * escuro no alto), o pé dele misturado com o chão em volta e a cratera escura. O relevo (sombra e
 * degraus) é desenhado por cima, como em qualquer terreno.
 */
const CRATER: readonly [number, number, number] = [40, 36, 36];
const CONE_HIGH: readonly [number, number, number] = [104, 92, 86];
const CONE_LOW: readonly [number, number, number] = [136, 122, 108];
const rockOut: [number, number, number] = [0, 0, 0];

function rockColor(rock: number, base: readonly number[]): readonly number[] {
  if (rock === 255) return CRATER;
  // Posição no cone: 0 na borda da cratera, 1 no pé.
  const t = 1 - rock / 254;
  const c = t < 0.45 ? CONE_HIGH : CONE_LOW;
  const mix = t > 0.8 ? 0.5 : 1;
  for (let k = 0; k < 3; k++) rockOut[k] = (base[k] as number) + ((c[k] as number) - (base[k] as number)) * mix;
  return rockOut;
}

/** Cores da camada "Ver tensão": tensão baixa (verde-amarelo), média (laranja), alta (vermelho). */
export const STRESS_COLORS: readonly (readonly [number, number, number])[] = [
  [190, 220, 60],
  [250, 150, 40],
  [235, 30, 30],
];

/** Pinta a célula de fronteira `i` pela tensão `v` (0–1, relativa ao limite do próximo terremoto). */
export function tintStress(out: Uint8Array, i: number, v: number): void {
  const t = Math.max(0, Math.min(1, v)) * 2;
  const a = STRESS_COLORS[Math.min(1, Math.floor(t))] as readonly [number, number, number];
  const b = STRESS_COLORS[Math.min(2, Math.floor(t) + 1)] as readonly [number, number, number];
  const f = t - Math.floor(t);
  const o = i * 4;
  const decor = (out[o + 2] as number) & DECOR_BIT;
  out[o] = clampByte(a[0] + (b[0] - a[0]) * f);
  out[o + 1] = clampByte(a[1] + (b[1] - a[1]) * f);
  out[o + 2] = (clampByte(a[2] + (b[2] - a[2]) * f) & ~DECOR_BIT) | decor;
}
