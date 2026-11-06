import { Biome, BIOME_INFO } from '../world/biomes';
import { broadTree, bushClump, floe, setFarModels, smokeCube, cactus, flatTree, grassTuft, mixRgb, pine, reed, rgb, rock, roundTree, type Rgb } from './models';

/** Os modelos em uso, com a cor vinda do globo do M2 (decisão 2 de 2026-11-06): o verde do bioma fica nas copas. */
export const biomeRgb = (b: number): Rgb => { const c = BIOME_INFO[b]?.color ?? [255, 0, 255]; return rgb(c[0], c[1], c[2]); };
const GRASS = biomeRgb(Biome.Grassland), TAIGA_C = biomeRgb(Biome.Taiga), FOREST_C = biomeRgb(Biome.TemperateForest), SWAMP_C = biomeRgb(Biome.Swamp), SAVANNA_C = biomeRgb(Biome.Savanna);
const variants = (n: number, make: (k: number) => Float32Array): Float32Array[] => Array.from({ length: n }, (_, k) => make(k));
const G_TAIGA = mixRgb(TAIGA_C, FOREST_C, 0.55), G_FOREST = mixRgb(FOREST_C, GRASS, 0.26);
export const MODELS = {
  pine: variants(4, (k) => pine(k + 1, G_TAIGA, 4 + (k % 2))),
  broad: variants(3, (k) => broadTree(k + 1, G_FOREST)),
  round: variants(3, (k) => roundTree(k + 1, mixRgb(FOREST_C, GRASS, 0.3))),
  swamp: variants(3, (k) => flatTree(k + 21, mixRgb(FOREST_C, SWAMP_C, 0.35), rgb(108, 72, 50), 1.1)),
  savanna: variants(3, (k) => flatTree(k + 11, mixRgb(FOREST_C, GRASS, 0.3), rgb(112, 76, 52), 1.45)),
  bush: variants(5, (k) => bushClump(k + 1, mixRgb(FOREST_C, GRASS, 0.32), 3 + k % 3)),
  dryBush: variants(3, (k) => bushClump(k + 7, mixRgb(FOREST_C, SAVANNA_C, 0.42), 3 + k % 2)),
  tuft: variants(3, (k) => grassTuft(k + 1, mixRgb(GRASS, FOREST_C, 0.22))),
  rock: variants(4, (k) => rock(k + 1, rgb(150, 148, 146))),
  sandRock: variants(2, (k) => rock(k + 11, rgb(140, 126, 110))),
  cactus: variants(3, (k) => cactus(k + 1, rgb(84, 142, 72), 2.1 + k * 0.25)),
  reed: variants(2, (k) => reed(k + 1, mixRgb(FOREST_C, GRASS, 0.2))),
  foam: variants(2, (k) => bushClump(k + 31, rgb(236, 244, 250), 3)),
  floe: variants(4, (k) => floe(k + 1)),
  smoke: variants(3, (k) => smokeCube(k + 1)),
};
export type ModelName = keyof typeof MODELS;

const FAR_ROCK = new Map<string, Float32Array>();
/** Pedra simples de longe. */
export function pickModelFar(name: ModelName, h: number): Float32Array {
  const list = MODELS[name], i = Math.floor(h * list.length) % list.length, key = `${name}:${i}`;
  let out = FAR_ROCK.get(key);
  if (!out) {
    setFarModels(true);
    out = name === 'rock' ? rock(i + 1, rgb(150, 148, 146)) : name === 'sandRock' ? rock(i + 11, rgb(140, 126, 110)) : (list[i] as Float32Array);
    setFarModels(false);
    FAR_ROCK.set(key, out);
  }
  return out;
}

export function pickModel(name: ModelName, h: number): Float32Array {
  const list = MODELS[name];
  return list[Math.floor(h * list.length) % list.length] as Float32Array;
}
