import { TICKS_PER_YEAR } from '../core/time';
import { classifyCell, MOUNTAIN_HEIGHT, SNOW_MIN_PRECIP, type CellClimate } from './biomes';

export { SNOW_MIN_PRECIP };
import { newArray } from '../core/shared';
import { createRng } from '../core/rng';
import { createNoise3D, fbm } from './noise';
import type { CubeSphere } from './cubesphere';
import { IceMode, type WorldState } from './state';

/** Queda de temperatura com a altitude: 6,5 °C por km. */
export const LAPSE_RATE = 6.5 / 1000;
/**
 * Terra abaixo desta temperatura média vira calota de gelo: no clima normal, terra acima de ~62–65° de
 * latitude (decisão do usuário, 2026-10-17); no máximo glacial, até ~45–50°. Medido em 5 sementes
 * (`docs/decisoes.md`, T7).
 */
export const LAND_ICE_TEMP = -10;
/** Montanha só vira geleira mais fria que isso e com neve caindo (chuva ≥ SNOW_MIN_PRECIP). */
export const MOUNTAIN_ICE_TEMP = -12;
/** Abaixo desta temperatura tudo vira gelo, mesmo seco (deserto polar). */
export const DEEP_FREEZE_TEMP = -18;
/** Mar abaixo desta temperatura média congela. */
export const SEA_ICE_TEMP = -10;
/** Variação (±°C) do limite do gelo marinho por correntes: borda irregular, não um círculo. */
export const SEA_ICE_NOISE = 8;
/** Faixa (°C) da borda do gelo marinho onde ele se parte em placas soltas. */
export const SEA_ICE_FLOES = 3;

/**
 * Ciclo glacial (T7, decisão do usuário: forte). O desvio global esfria devagar até GLACIAL_AMPLITUDE
 * e esquenta rápido (como os ciclos da Terra), em GLACIAL_PERIOD_TICKS passos (10 mil anos de jogo,
 * ~8 min reais a 20×). Começa no clima normal.
 */
export const GLACIAL_AMPLITUDE = 8;
export const GLACIAL_PERIOD_TICKS = 120_000;
const GLACIAL_COOLING = 0.8;
/** Controle de temperatura global do jogador (°C), somado ao ciclo. */
export const CONTROL_MIN = -10;
export const CONTROL_MAX = 10;
/**
 * O controle muda o clima aos poucos (teste da 50f0dca, pedido do usuário: "mudança suave"): a
 * temperatura aplicada anda até a escolhida a CONTROL_GLIDE °C por segundo real (também pausado), e o
 * mundo é refeito a cada CONTROL_APPLY_STEP °C (cada refazer custa ~20–65 ms no ajudante).
 */
export const CONTROL_GLIDE = 1;
export const CONTROL_APPLY_STEP = 0.5;

/** Um passo de `dt` segundos de `current` rumo a `target`, a `rate` °C/s. */
export function glideToward(current: number, target: number, dt: number, rate = CONTROL_GLIDE): number {
  const d = target - current;
  const s = rate * Math.max(0, dt);
  return Math.abs(d) <= s ? target : current + Math.sign(d) * s;
}

/** O mar desce 15 m por grau de esfriamento (−120 m no máximo glacial), em degraus de 10 m. */
export const SEA_DROP_PER_DEGREE = 15;
export const SEA_LEVEL_STEP = 10;

/** Desvio do ciclo glacial no passo `tick` (°C, ≤ 0). Função pura do tempo: determinístico. */
export function glacialOffset(tick: number): number {
  const phase = (((tick / GLACIAL_PERIOD_TICKS) % 1) + 1) % 1;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const cold = phase < GLACIAL_COOLING ? smooth(phase / GLACIAL_COOLING) : 1 - smooth((phase - GLACIAL_COOLING) / (1 - GLACIAL_COOLING));
  return -GLACIAL_AMPLITUDE * cold + 0; // + 0: sem "−0" no começo do ciclo
}

/**
 * Inverno de impacto (meteoro gigante, C12; decisão do usuário: poeira e fuligem no ar esfriam o
 * planeta por um tempo, como no impacto que extinguiu os dinossauros): `amount` °C a menos no passo
 * `tick`, todo o frio nos primeiros IMPACT_FULL_YEARS anos e voltando ao normal até `years`.
 */
export interface ImpactWinter {
  tick: number;
  amount: number;
  years: number;
}
export const IMPACT_FULL_YEARS = 5;

/** Frio (°C, ≥ 0) dos invernos de impacto no passo `tick`. */
export function impactCooling(tick: number, impacts: readonly ImpactWinter[]): number {
  let cold = 0;
  for (const i of impacts) {
    const years = (tick - i.tick) / TICKS_PER_YEAR;
    if (years < 0 || years >= i.years) continue;
    cold += i.amount * (years < IMPACT_FULL_YEARS ? 1 : 1 - (years - IMPACT_FULL_YEARS) / (i.years - IMPACT_FULL_YEARS));
  }
  return cold;
}

/** Desvio total: ciclo + controle do jogador + invernos de impacto. */
export function climateOffsetAt(tick: number, control: number, impacts: readonly ImpactWinter[] = []): number {
  return glacialOffset(tick) + Math.max(CONTROL_MIN, Math.min(CONTROL_MAX, control)) - impactCooling(tick, impacts);
}

/**
 * Quanto o mar sobe por grau de aquecimento acima do normal (as calotas derretem; decisão do usuário,
 * teste da 30e5e93, corrigindo a T7 em que o mar só descia): +60 m em +10 °C, perto dos ~70 m que a
 * Terra subiria sem gelo nenhum.
 */
export const SEA_RISE_PER_DEGREE = 6;

/** Nível do mar para um desvio de temperatura: desce no frio (o gelo em terra guarda a água) e sobe no calor. */
export function seaLevelFor(base: number, offset: number): number {
  const meters = offset < 0 ? offset * SEA_DROP_PER_DEGREE : offset * SEA_RISE_PER_DEGREE;
  return base + Math.round(meters / SEA_LEVEL_STEP) * SEA_LEVEL_STEP;
}

/**
 * Quanto o desvio global pesa em cada latitude: os polos esfriam mais que os trópicos (como na Terra:
 * na última era glacial ~−4 °C nos trópicos e muito mais perto dos polos). 0,5 no equador, 1,8 no polo.
 */
export function polarAmplification(lat: number): number {
  return 0.5 + (1.3 * Math.abs(lat)) / (Math.PI / 2);
}
/**
 * Alcance da umidade do oceano, em radianos de arco (~3.700 km num planeta do tamanho da Terra). Era 0,25:
 * o interior dos continentes secava demais (desertos 27% da terra, chuva mediana 350 mm; T7).
 */
export const MOISTURE_RANGE = 0.8;
/** Distância (radianos) que a sombra de chuva olha contra o vento. */
export const SHADOW_REACH = 0.1;
export const SHADOW_STEPS = 8;
/** Amplitude da variação regional: ±°C e fator exponencial de chuva. */
export const TEMP_VARIATION = 3;
export const RAIN_VARIATION = 0.45;
const UNREACHED = 0xffff;

/** Temperatura média ao nível do mar por latitude (radianos): ~28 °C no equador, ~-24 °C nos polos. */
export function seaLevelTemperature(lat: number): number {
  const t = Math.abs(lat) / (Math.PI / 2);
  return 28 - 52 * Math.pow(t, 1.5);
}

/**
 * Chuva base por latitude (mm/ano): equador muito úmido, faixa seca perto de 25–30°,
 * faixa temperada úmida perto de 50°, polos secos.
 */
export function latitudePrecipitation(lat: number): number {
  const a = (Math.abs(lat) * 180) / Math.PI;
  return 1.35 * (2200 * Math.exp(-((a / 10) ** 2)) + 1300 * Math.exp(-(((a - 50) / 14) ** 2))) + 150;
}

/**
 * Direção de onde vem o vento predominante, como sinal no eixo leste:
 * +1 = vem do leste (alísios e ventos polares), -1 = vem do oeste (ventos de oeste).
 */
export function windFrom(lat: number): 1 | -1 {
  const a = (Math.abs(lat) * 180) / Math.PI;
  return a < 30 || a > 60 ? 1 : -1;
}

/**
 * Fator de umidade pela distância até a água (radianos). Perto do equador a chuva de convecção
 * se recicla sobre a floresta, então o interior seca bem menos (como na Amazônia e no Congo).
 */
export function moistureFactor(distance: number, lat: number): number {
  const a = (Math.abs(lat) * 180) / Math.PI;
  const floor = 0.35 + 0.35 * Math.exp(-((a / 12) ** 2));
  return floor + (1 - floor) * Math.exp(-distance / MOISTURE_RANGE);
}

/** Fator de sombra de chuva (0–1) por quantos metros de montanha o vento precisa cruzar. */
export function shadowFactor(barrier: number): number {
  return 1 / (1 + Math.max(0, barrier) / 1200);
}

/** Distância até a água (em células) no mundo todo: busca em largura a partir da água. */
export function computeWaterDistance(world: WorldState): void {
  const { neighbors } = world.grid;
  const dist = world.waterDistance;
  const queue = new Int32Array(world.cellCount);
  let tail = 0;
  for (let i = 0; i < world.cellCount; i++) {
    if (world.isWater(i)) {
      dist[i] = 0;
      queue[tail++] = i;
    } else {
      dist[i] = UNREACHED;
    }
  }
  for (let head = 0; head < tail; head++) {
    const c = queue[head] as number;
    const next = (dist[c] as number) + 1;
    for (let d = 0; d < 4; d++) {
      const nb = neighbors[c * 4 + d] as number;
      if ((dist[nb] as number) > next) {
        dist[nb] = next;
        queue[tail++] = nb;
      }
    }
  }
}

/** Marcador de "está na região", reaproveitado entre chamadas (um por grade). */
const regionMarks = new WeakMap<CubeSphere, { marks: Uint32Array; stamp: number }>();

/**
 * Atualiza a distância até a água só numa região (depois de uma pincelada).
 * As células fora da região mantêm o valor e servem de ponto de partida.
 * Busca em largura com fila por distância: cada célula é processada uma vez.
 */
export function updateWaterDistance(world: WorldState, region: readonly number[]): void {
  const grid = world.grid;
  const { neighbors } = grid;
  const dist = world.waterDistance;
  let entry = regionMarks.get(grid);
  if (!entry) {
    entry = { marks: new Uint32Array(grid.cellCount), stamp: 0 };
    regionMarks.set(grid, entry);
  }
  const stamp = ++entry.stamp;
  const marks = entry.marks;
  for (const c of region) {
    marks[c] = stamp;
    dist[c] = world.isWater(c) ? 0 : UNREACHED;
  }

  // Ponto de partida: água da região e vizinhos de fora (com a distância que já tinham).
  const buckets: number[][] = [];
  const push = (c: number, d: number): void => {
    (buckets[d] ??= []).push(c);
  };
  for (const c of region) {
    if (dist[c] === 0) {
      push(c, 0);
      continue;
    }
    let best = UNREACHED;
    for (let k = 0; k < 4; k++) {
      const nb = neighbors[c * 4 + k] as number;
      if (marks[nb] !== stamp) best = Math.min(best, (dist[nb] as number) + 1);
    }
    if (best < UNREACHED) {
      dist[c] = best;
      push(c, best);
    }
  }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const c of bucket) {
      if ((dist[c] as number) !== d) continue;
      for (let k = 0; k < 4; k++) {
        const nb = neighbors[c * 4 + k] as number;
        if (marks[nb] === stamp && (dist[nb] as number) > d + 1) {
          dist[nb] = d + 1;
          push(nb, d + 1);
        }
      }
    }
  }
}

/**
 * Recalcula temperatura, chuva, gelo e bioma. Sem `cells`, no mundo todo.
 * A distância até a água precisa estar atualizada antes.
 */
export function updateClimate(world: WorldState, cells?: readonly number[]): void {
  const count = cells ? cells.length : world.cellCount;
  const table = upwindTable(world.grid);
  for (let k = 0; k < count; k++) computeTemperatureAndRain(world, table, cells ? (cells[k] as number) : k);
  for (let k = 0; k < count; k++) computeIceAndBiome(world, cells ? (cells[k] as number) : k);
}

function computeTemperatureAndRain(world: WorldState, table: Int32Array, i: number): void {
  const { positions, cellAngle } = world.grid;
  const y = positions[i * 3 + 1] as number;
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const height = world.heightAboveSea(i);
  const land = height > 0;

  world.temperature[i] = temperatureOf(world, latitudeTables(world.grid), i, height);

  let rain = latitudePrecipitation(lat) * Math.exp(RAIN_VARIATION * (world.rainNoise[i] as number));
  if (land) {
    rain *= moistureFactor((world.waterDistance[i] as number) * cellAngle, lat);
    rain *= shadowFactor(upwindBarrier(world, table, i, height));
  }
  world.precipitation[i] = rain;
}

/** Marca de "linha ainda não calculada" na tabela do vento. */
const NOT_COMPUTED = -2;

/** Tabela fixa (por grade) das células contra o vento: SHADOW_STEPS por célula, -1 = nenhuma. */
const upwindTables = new WeakMap<CubeSphere, Int32Array>();

/**
 * Para cada célula, as células que o vento predominante atravessa antes de chegar nela.
 * Só depende da grade (latitude e direção do vento), então é guardada e reaproveitada em todo
 * mundo novo e em toda pincelada. Cada linha é calculada na primeira vez que alguém precisa dela
 * (só a terra precisa), o que deixa a abertura do jogo bem mais rápida.
 */
export function upwindTable(grid: CubeSphere): Int32Array {
  let table = upwindTables.get(grid);
  if (!table) {
    table = newArray(Int32Array, grid.cellCount * SHADOW_STEPS).fill(NOT_COMPUTED);
    upwindTables.set(grid, table);
  }
  return table;
}

/** Usa a tabela do vento de outro ajudante (memória compartilhada) para esta grade. */
export function adoptUpwindTable(grid: CubeSphere, table: Int32Array): void {
  if (table.length !== grid.cellCount * SHADOW_STEPS) throw new Error('Tabela do vento com tamanho diferente');
  upwindTables.set(grid, table);
}

/** Bytes das tabelas guardadas para esta grade (vento e marcas de região), para o painel Dados. */
export function climateCacheBytes(grid: CubeSphere): number {
  return (upwindTables.get(grid)?.byteLength ?? 0) + (regionMarks.get(grid)?.marks.byteLength ?? 0);
}

function computeUpwindRow(grid: CubeSphere, table: Int32Array, i: number): void {
  const { positions } = grid;
  const x = positions[i * 3] as number;
  const y = positions[i * 3 + 1] as number;
  const z = positions[i * 3 + 2] as number;
  const row = i * SHADOW_STEPS;
  const cells = new Array<number>(SHADOW_STEPS).fill(-1);
  // Vetor leste no ponto (tangente, perpendicular ao eixo norte). Exatamente no polo não há leste.
  const len = Math.hypot(x, z);
  if (len >= 1e-6) {
    const ex = z / len;
    const ez = -x / len;
    const sign = windFrom(Math.asin(Math.max(-1, Math.min(1, y))));
    const step = SHADOW_REACH / SHADOW_STEPS;
    for (let s = 0; s < SHADOW_STEPS; s++) {
      const a = step * (s + 1) * sign;
      const c = grid.pointToCell(x + ex * a, y, z + ez * a);
      if (c !== i) cells[s] = c;
    }
  }
  // A tabela pode ser compartilhada entre os ajudantes: a primeira posição (a marca de "calculada")
  // é escrita por último, de forma atômica, para o outro lado nunca ler uma linha pela metade.
  for (let s = 1; s < SHADOW_STEPS; s++) table[row + s] = cells[s] as number;
  Atomics.store(table, row, cells[0] as number);
}

/** Quantos metros acima desta célula fica a montanha mais alta no caminho do vento. */
function upwindBarrier(world: WorldState, table: Int32Array, i: number, height: number): number {
  if (Atomics.load(table, i * SHADOW_STEPS) === NOT_COMPUTED) computeUpwindRow(world.grid, table, i);
  let highest = -Infinity;
  for (let s = 0; s < SHADOW_STEPS; s++) {
    const c = table[i * SHADOW_STEPS + s] as number;
    if (c < 0) continue;
    const h = world.heightAboveSea(c);
    if (h > highest) highest = h;
  }
  return highest - Math.max(0, height);
}

/**
 * Ruído do gelo marinho, fixo por mundo (calculado uma vez): [2i] lobos grandes da borda (−1 a 1),
 * [2i + 1] placas soltas de poucas células (−1 a 1). Proposta dos polos (teste da 50f0dca).
 */
const iceNoiseCache = new WeakMap<WorldState, Float32Array>();

function seaIceNoise(world: WorldState): Float32Array {
  const cached = iceNoiseCache.get(world);
  if (cached) return cached;
  const n = world.cellCount;
  const out = new Float32Array(n * 2);
  const big = createNoise3D(createRng((world.params.seed ^ 0x1ce5eed) >>> 0));
  const small = createNoise3D(createRng((world.params.seed ^ 0x0f10e5) >>> 0));
  const fine = world.grid.n / 5;
  const { positions } = world.grid;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    // Só perto dos polos importa (o resto nunca congela no mar).
    if (Math.abs(y) < 0.5) continue;
    out[i * 2] = Math.max(-1, Math.min(1, 1.6 * fbm(big, x * 3, y * 3, z * 3, 3)));
    out[i * 2 + 1] = Math.max(-1, Math.min(1, 2 * fbm(small, x * fine, y * fine, z * fine, 2)));
  }
  iceNoiseCache.set(world, out);
  return out;
}

const cellScratch: CellClimate = { height: 0, temp: 0, precip: 0, ice: false, nearWater: false };

/**
 * Gelo pela temperatura (e pela neve, na montanha): calota em terra fria; geleira na montanha só com
 * neve caindo (montanha alta e seca fica rocha); mar congelado com a borda irregular (correntes).
 */
export function naturalIce(world: WorldState, i: number, height: number, temp: number): boolean {
  if (height <= 0) {
    const noise = seaIceNoise(world);
    const t = temp + SEA_ICE_NOISE * (noise[i * 2] as number);
    if (t < SEA_ICE_TEMP - SEA_ICE_FLOES) return true;
    if (t >= SEA_ICE_TEMP + SEA_ICE_FLOES) return false;
    // Borda partida em placas soltas de algumas células (ruído médio), mais raras quanto mais quente.
    return (noise[i * 2 + 1] as number) > (t - SEA_ICE_TEMP) / SEA_ICE_FLOES;
  }
  if (temp < DEEP_FREEZE_TEMP) return true;
  if (height >= MOUNTAIN_HEIGHT) return temp < MOUNTAIN_ICE_TEMP && (world.precipitation[i] as number) >= SNOW_MIN_PRECIP;
  return temp < LAND_ICE_TEMP;
}

function computeIceAndBiome(world: WorldState, i: number): void {
  const height = world.heightAboveSea(i);
  const temp = world.temperature[i] as number;
  const mode = world.iceMode[i];
  const ice = mode === IceMode.Painted || (mode === IceMode.Auto && naturalIce(world, i, height, temp));
  world.ice[i] = ice ? 1 : 0;

  let nearWater = false;
  if (height > 0) {
    const { neighbors } = world.grid;
    for (let d = 0; d < 4 && !nearWater; d++) nearWater = world.isWater(neighbors[i * 4 + d] as number);
  }
  // Um objeto só, reaproveitado: um objeto novo por célula virava lixo para a limpeza de memória
  // (o navegador nem sempre consegue evitar a criação).
  const cell = cellScratch;
  cell.height = height;
  cell.temp = temp;
  cell.precip = world.precipitation[i] as number;
  cell.ice = ice;
  cell.nearWater = nearWater;
  world.biome[i] = classifyCell(cell);
}

/** Por célula e fixo por grade: temperatura ao nível do mar pela latitude e amplificação polar. */
interface LatitudeTables {
  base: Float32Array;
  amp: Float32Array;
}
const latitudeTableCache = new WeakMap<CubeSphere, LatitudeTables>();

function latitudeTables(grid: CubeSphere): LatitudeTables {
  let t = latitudeTableCache.get(grid);
  if (!t) {
    t = { base: newArray(Float32Array, grid.cellCount), amp: newArray(Float32Array, grid.cellCount) };
    for (let i = 0; i < grid.cellCount; i++) {
      const lat = Math.asin(Math.max(-1, Math.min(1, grid.positions[i * 3 + 1] as number)));
      t.base[i] = seaLevelTemperature(lat);
      t.amp[i] = polarAmplification(lat);
    }
    latitudeTableCache.set(grid, t);
  }
  return t;
}

/** Temperatura média da célula: latitude, variação regional, altitude e desvio global. */
function temperatureOf(world: WorldState, t: LatitudeTables, i: number, height: number): number {
  return (
    (t.base[i] as number) +
    TEMP_VARIATION * (world.tempNoise[i] as number) -
    (height > 0 ? height * LAPSE_RATE : 0) +
    world.climateOffset * (t.amp[i] as number)
  );
}

/**
 * Recálculo parcial (T7): só o desvio global mudou (mesmo nível do mar). Temperatura, gelo e bioma são
 * refeitos; chuva, vento e distância até a água não mudam (bem mais barato que `updateClimate`). Dá
 * exatamente o mesmo resultado que o recálculo total (mesma conta).
 */
export function shiftClimate(world: WorldState, offset: number): void {
  world.climateOffset = offset;
  const tables = latitudeTables(world.grid);
  for (let i = 0; i < world.cellCount; i++) world.temperature[i] = temperatureOf(world, tables, i, world.heightAboveSea(i));
  for (let i = 0; i < world.cellCount; i++) computeIceAndBiome(world, i);
}

/**
 * Leva o clima do mundo para o desvio `offset`: com o mesmo nível do mar, o recálculo parcial; se o
 * mar mudou de degrau, a costa anda e tudo é refeito (distância até a água, chuva). Retorna true se
 * o nível do mar mudou.
 */
export function applyClimateOffset(world: WorldState, offset: number): boolean {
  const sea = seaLevelFor(world.params.seaLevel, offset);
  if (sea === world.seaLevel) {
    shiftClimate(world, offset);
    return false;
  }
  world.seaLevel = sea;
  world.climateOffset = offset;
  computeWaterDistance(world);
  updateClimate(world);
  return true;
}
