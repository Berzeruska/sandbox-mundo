import { describe, expect, it } from 'vitest';
import { Biome } from '../../src/world/biomes';
import {
  computeWaterDistance,
  latitudePrecipitation,
  seaLevelTemperature,
  updateClimate,
  updateWaterDistance,
} from '../../src/world/climate';
import { createWorld } from '../../src/world/create';
import { CubeSphere, latLonToPoint, pointToLatLon } from '../../src/world/cubesphere';
import { IceMode, WorldState } from '../../src/world/state';

const grid = new CubeSphere(64);
const params = { seedText: '1', seed: 1, n: 64, seaLevel: 0, landFraction: 0.3 };
const deg = (d: number) => (d * Math.PI) / 180;
const cellAt = (latDeg: number, lonDeg: number) => {
  const p = latLonToPoint(deg(latDeg), deg(lonDeg));
  return grid.pointToCell(p[0], p[1], p[2]);
};

/** Mundo todo de terra plana na altura dada, com uma faixa de oceano no equador para ter umidade. */
const flatWorld = (height: number) => {
  const w = new WorldState(params, grid);
  w.elevation.fill(height);
  computeWaterDistance(w);
  return w;
};

describe('clima', () => {
  it('polo é mais frio que o equador', () => {
    const w = flatWorld(100);
    updateClimate(w);
    expect(w.temperature[cellAt(89, 0)]).toBeLessThan((w.temperature[cellAt(0, 0)] as number) - 30);
    expect(seaLevelTemperature(Math.PI / 2)).toBeLessThan(seaLevelTemperature(0));
  });

  it('montanha alta é mais fria que a base', () => {
    const w = flatWorld(100);
    const peak = cellAt(10, 10);
    w.elevation[peak] = 4000;
    updateClimate(w);
    expect(w.temperature[peak]).toBeLessThan((w.temperature[cellAt(10, 13)] as number) - 20);
  });

  it('faixas de chuva: equador úmido, ~28° seco, ~50° úmido', () => {
    expect(latitudePrecipitation(0)).toBeGreaterThan(2000);
    expect(latitudePrecipitation(deg(28))).toBeLessThan(400);
    expect(latitudePrecipitation(deg(50))).toBeGreaterThan(1000);
  });

  it('longe do mar chove menos', () => {
    const w = new WorldState(params, grid);
    // Oceano a oeste da longitude 0, terra a leste, na latitude 45 (ventos de oeste: úmido na costa).
    for (let i = 0; i < w.cellCount; i++) {
      const { lon } = pointToLatLon(grid.positions[i * 3] as number, grid.positions[i * 3 + 1] as number, grid.positions[i * 3 + 2] as number);
      w.elevation[i] = lon < 0 ? -1000 : 100;
    }
    computeWaterDistance(w);
    updateClimate(w);
    expect(w.precipitation[cellAt(45, 3)]).toBeGreaterThan((w.precipitation[cellAt(45, 60)] as number) * 1.5);
  });

  it('sombra de chuva: atrás da montanha (a favor do vento) é mais seco', () => {
    const w = flatWorld(100);
    // Paredão de 4 km na longitude ~0, latitude 45 (vento vem do oeste).
    for (let i = 0; i < w.cellCount; i++) {
      const { lon } = pointToLatLon(grid.positions[i * 3] as number, grid.positions[i * 3 + 1] as number, grid.positions[i * 3 + 2] as number);
      if (Math.abs(lon) < deg(1.5)) w.elevation[i] = 4000;
    }
    computeWaterDistance(w);
    updateClimate(w);
    const westOfWall = w.precipitation[cellAt(45, -3)] as number;
    const eastOfWall = w.precipitation[cellAt(45, 3)] as number;
    expect(eastOfWall).toBeLessThan(westOfWall * 0.5);
  });

  it('gelo pintado e apagado vencem o clima', () => {
    const w = flatWorld(100);
    const hot = cellAt(0, 0);
    const pole = cellAt(89, 0);
    w.iceMode[hot] = IceMode.Painted;
    w.iceMode[pole] = IceMode.Erased;
    updateClimate(w);
    expect(w.ice[hot]).toBe(1);
    expect(w.biome[hot]).toBe(Biome.Ice);
    expect(w.ice[pole]).toBe(0);
    expect(w.ice[cellAt(89, 90)]).toBe(1);
  });

  it('atualização local da distância até a água bate com a global', () => {
    const w = createWorld(params, grid);
    const center = cellAt(10, 10);
    const p = latLonToPoint(deg(10), deg(10));
    const region = grid.cellsInCap(p[0], p[1], p[2], grid.cellAngle * 12);
    // Abre um lago no meio da região.
    for (const c of grid.cellsInCap(p[0], p[1], p[2], grid.cellAngle * 2)) w.elevation[c] = -50;
    updateWaterDistance(w, region);
    const local = Uint16Array.from(w.waterDistance);
    computeWaterDistance(w);
    // Dentro da região, longe da borda, os valores coincidem.
    for (const c of grid.cellsInCap(p[0], p[1], p[2], grid.cellAngle * 4)) expect(local[c]).toBe(w.waterDistance[c]);
    expect(w.waterDistance[center]).toBe(0);
  });
});

describe('mundo gerado', () => {
  const w = createWorld({ ...params, seed: 3 }, grid);

  it('tem calotas de gelo nos dois polos', () => {
    expect(w.ice[cellAt(89, 0)]).toBe(1);
    expect(w.ice[cellAt(-89, 0)]).toBe(1);
  });

  it('tem variedade de biomas', () => {
    expect(new Set(w.biome).size).toBeGreaterThanOrEqual(10);
  });

  it('é determinístico', () => {
    expect(createWorld({ ...params, seed: 3 }, grid).biome).toEqual(w.biome);
  });
});
