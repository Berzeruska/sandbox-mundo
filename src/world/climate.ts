import { classifyCell } from './biomes';
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
const SHADOW_STEPS = 10;
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

/**
 * Atualiza a distância até a água só numa região (depois de uma pincelada).
 * As células fora da região mantêm o valor e servem de ponto de partida.
 */
export function updateWaterDistance(world: WorldState, region: readonly number[]): void {
  const { neighbors } = world.grid;
  const dist = world.waterDistance;
  for (const c of region) dist[c] = world.isWater(c) ? 0 : UNREACHED;
  // Relaxação repetida: barata porque a região é pequena.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of region) {
      if (dist[c] === 0) continue;
      let best = dist[c] as number;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        const v = (dist[nb] as number) + 1;
        if (v < best) best = v;
      }
      if (best < (dist[c] as number)) {
        dist[c] = Math.min(best, UNREACHED);
        changed = true;
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
  for (let k = 0; k < count; k++) computeTemperatureAndRain(world, cells ? (cells[k] as number) : k);
  for (let k = 0; k < count; k++) computeIceAndBiome(world, cells ? (cells[k] as number) : k);
}

function computeTemperatureAndRain(world: WorldState, i: number): void {
  const { positions, cellAngle } = world.grid;
  const x = positions[i * 3] as number;
  const y = positions[i * 3 + 1] as number;
  const z = positions[i * 3 + 2] as number;
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const height = world.heightAboveSea(i);
  const land = height > 0;

  world.temperature[i] =
    seaLevelTemperature(lat) + TEMP_VARIATION * (world.tempNoise[i] as number) - (land ? height * LAPSE_RATE : 0);

  let rain = latitudePrecipitation(lat) * Math.exp(RAIN_VARIATION * (world.rainNoise[i] as number));
  if (land) {
    rain *= moistureFactor((world.waterDistance[i] as number) * cellAngle, lat);
    rain *= shadowFactor(upwindBarrier(world, i, x, y, z, lat, height));
  }
  world.precipitation[i] = rain;
}

/** Quantos metros acima desta célula fica a montanha mais alta no caminho do vento. */
function upwindBarrier(world: WorldState, i: number, x: number, y: number, z: number, lat: number, height: number): number {
  // Vetor leste no ponto (tangente, perpendicular ao eixo norte).
  let ex = z;
  let ez = -x;
  const len = Math.hypot(ex, ez);
  if (len < 1e-6) return 0; // exatamente no polo não há leste
  ex /= len;
  ez /= len;
  const sign = windFrom(lat);
  const step = SHADOW_REACH / SHADOW_STEPS;
  let highest = -Infinity;
  for (let s = 1; s <= SHADOW_STEPS; s++) {
    const a = step * s * sign;
    const c = world.grid.pointToCell(x + ex * a, y, z + ez * a);
    if (c === i) continue;
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
