import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, BIOME_INFO, Biome, classifyCell, classifyClimate } from '../../src/world/biomes';

const climatic = [
  Biome.Tundra, Biome.Taiga, Biome.TemperateForest, Biome.Grassland, Biome.Steppe,
  Biome.HotDesert, Biome.ColdDesert, Biome.Savanna, Biome.TropicalForest, Biome.Swamp,
];

describe('biomas', () => {
  it('toda entrada da paleta tem nome e cor válida', () => {
    expect(BIOME_COUNT).toBe(16);
    for (const info of BIOME_INFO) {
      expect(info.name.length).toBeGreaterThan(0);
      for (const c of info.color) expect(c >= 0 && c <= 255).toBe(true);
    }
  });

  it('cores são todas diferentes', () => {
    expect(new Set(BIOME_INFO.map((b) => b.color.join(','))).size).toBe(BIOME_COUNT);
  });

  it('todos os biomas climáticos são alcançáveis com algum par temperatura × precipitação', () => {
    const seen = new Set<number>();
    for (let t = -40; t <= 40; t += 1) {
      for (let p = 0; p <= 4000; p += 50) seen.add(classifyClimate(t, p));
    }
    for (const b of climatic) expect(seen).toContain(b);
  });

  it('todos os 16 biomas são alcançáveis pela classificação completa', () => {
    const seen = new Set<number>();
    for (const height of [-3000, -50, 10, 200, 2500, 4000]) {
      for (let t = -40; t <= 40; t += 2) {
        for (let p = 0; p <= 4000; p += 100) {
          for (const ice of [false, true]) {
            for (const nearWater of [false, true]) seen.add(classifyCell({ height, temp: t, precip: p, ice, nearWater }));
          }
        }
      }
    }
    expect(seen.size).toBe(BIOME_COUNT);
  });

  it('casos de bom senso', () => {
    expect(classifyClimate(26, 2000)).toBe(Biome.TropicalForest);
    expect(classifyClimate(26, 100)).toBe(Biome.HotDesert);
    expect(classifyClimate(-10, 300)).toBe(Biome.Tundra);
    expect(classifyCell({ height: -1000, temp: 20, precip: 0, ice: false, nearWater: false })).toBe(Biome.DeepOcean);
    expect(classifyCell({ height: 5000, temp: -15, precip: 500, ice: false, nearWater: false })).toBe(Biome.SnowyPeak);
    // Pântano não sobe a serra.
    expect(classifyCell({ height: 800, temp: 25, precip: 3500, ice: false, nearWater: false })).toBe(Biome.TropicalForest);
  });
});

describe('pântano', () => {
  it('baixada quente e úmida vira pântano; a mesma chuva no planalto não', () => {
    expect(classifyCell({ height: 30, temp: 24, precip: 2000, ice: false, nearWater: false })).toBe(Biome.Swamp);
    expect(classifyCell({ height: 600, temp: 24, precip: 2000, ice: false, nearWater: false })).toBe(Biome.TropicalForest);
  });
});
