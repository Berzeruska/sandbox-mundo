import { classifyCell } from './biomes';
import type { CubeSphere } from './cubesphere';
import { IceMode, type WorldState } from './state';

/** Queda de temperatura com a altitude: 6,5 °C por km. */
export const LAPSE_RATE = 6.5 / 1000;
/** Terra abaixo desta temperatura média vira calota de gelo. */
export const LAND_ICE_TEMP = -12;
/** Mar abaixo desta temperatura média congela. */
export const SEA_ICE_TEMP = -10;
/** Alcance da umidade do oceano, em radianos de arco (~1.150 km num planeta do tamanho da Terra). */
export const MOISTURE_RANGE = 0.25;
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
  return 2200 * Math.exp(-((a / 10) ** 2)) + 1300 * Math.exp(-(((a - 50) / 14) ** 2)) + 150;
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

  world.temperature[i] =
    seaLevelTemperature(lat) + TEMP_VARIATION * (world.tempNoise[i] as number) - (land ? height * LAPSE_RATE : 0);

  let rain = latitudePrecipitation(lat) * Math.exp(RAIN_VARIATION * (world.rainNoise[i] as number));
  if (land) {
    rain *= moistureFactor((world.waterDistance[i] as number) * cellAngle, lat);
    rain *= shadowFactor(upwindBarrier(world, table, i, height));
  }
  world.precipitation[i] = rain;
}

/** Tabela fixa (por grade) das células contra o vento: SHADOW_STEPS por célula, -1 = nenhuma. */
const upwindTables = new WeakMap<CubeSphere, Int32Array>();

/**
 * Para cada célula, as células que o vento predominante atravessa antes de chegar nela.
 * Só depende da grade (latitude e direção do vento), então é calculada uma vez e reaproveitada
 * em todo mundo novo e em toda pincelada.
 */
export function upwindTable(grid: CubeSphere): Int32Array {
  const cached = upwindTables.get(grid);
  if (cached) return cached;
  const table = new Int32Array(grid.cellCount * SHADOW_STEPS).fill(-1);
  const { positions } = grid;
  const step = SHADOW_REACH / SHADOW_STEPS;
  for (let i = 0; i < grid.cellCount; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    // Vetor leste no ponto (tangente, perpendicular ao eixo norte).
    const len = Math.hypot(x, z);
    if (len < 1e-6) continue; // exatamente no polo não há leste
    const ex = z / len;
    const ez = -x / len;
    const sign = windFrom(Math.asin(Math.max(-1, Math.min(1, y))));
    for (let s = 0; s < SHADOW_STEPS; s++) {
      const a = step * (s + 1) * sign;
      const c = grid.pointToCell(x + ex * a, y, z + ez * a);
      if (c !== i) table[i * SHADOW_STEPS + s] = c;
    }
  }
  upwindTables.set(grid, table);
  return table;
}

/** Quantos metros acima desta célula fica a montanha mais alta no caminho do vento. */
function upwindBarrier(world: WorldState, table: Int32Array, i: number, height: number): number {
  let highest = -Infinity;
  for (let s = 0; s < SHADOW_STEPS; s++) {
    const c = table[i * SHADOW_STEPS + s] as number;
    if (c < 0) continue;
    const h = world.heightAboveSea(c);
    if (h > highest) highest = h;
  }
  return highest - Math.max(0, height);
}

function computeIceAndBiome(world: WorldState, i: number): void {
  const height = world.heightAboveSea(i);
  const temp = world.temperature[i] as number;
  const mode = world.iceMode[i];
  const naturalIce = temp < (height > 0 ? LAND_ICE_TEMP : SEA_ICE_TEMP);
  const ice = mode === IceMode.Painted || (mode === IceMode.Auto && naturalIce);
  world.ice[i] = ice ? 1 : 0;

  let nearWater = false;
  if (height > 0) {
    const { neighbors } = world.grid;
    for (let d = 0; d < 4 && !nearWater; d++) nearWater = world.isWater(neighbors[i * 4 + d] as number);
  }
  world.biome[i] = classifyCell({ height, temp, precip: world.precipitation[i] as number, ice, nearWater });
}
