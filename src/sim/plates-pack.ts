import { NEAR_CELLS, packPlateCellOf } from '../render/plate-motion';
import type { CubeSphere } from '../world/cubesphere';
import { Crust } from '../world/plates';
import type { WorldState } from '../world/state';

/**
 * Arrays de trabalho do `packPlates`, um conjunto por grade. Ele roda a cada recomposição no ajudante;
 * criar tudo de novo a cada vez virava lixo e chamava a limpeza de memória (travadas no celular).
 */
interface PackScratch {
  o1: Uint8Array;
  o2: Uint8Array;
  s1: Uint8Array;
  s2: Uint8Array;
  touches: Uint8Array;
  queued: Uint8Array;
  frontier: Int32Array;
  next: Int32Array;
}
const scratches = new WeakMap<CubeSphere, PackScratch>();

function scratchFor(grid: CubeSphere, n: number): PackScratch {
  let s = scratches.get(grid);
  if (!s) {
    s = {
      o1: new Uint8Array(n),
      o2: new Uint8Array(n),
      s1: new Uint8Array(n),
      s2: new Uint8Array(n),
      touches: new Uint8Array(n),
      queued: new Uint8Array(n),
      frontier: new Int32Array(n),
      next: new Int32Array(n),
    };
    scratches.set(grid, s);
  }
  return s;
}

/**
 * Textura de placas do shader (2 bytes por célula, R e G; ver plate-motion.ts): placa, crosta
 * continental, se encosta em outra placa, e até duas outras placas a até NEAR_CELLS passos.
 */
export function packPlates(world: WorldState): Uint8Array {
  const n = world.cellCount;
  const { neighbors } = world.grid;
  const plate = world.plate;
  const NONE = 255;
  const sc = scratchFor(world.grid, n);
  const { o1, o2, s1, s2, touches, queued } = sc;
  let frontier = sc.frontier;
  let next = sc.next;
  o1.fill(NONE);
  o2.fill(NONE);
  touches.fill(0);
  const add = (i: number, q: number): boolean => {
    if (q === plate[i] || o1[i] === q || o2[i] === q) return false;
    if (o1[i] === NONE) o1[i] = q;
    else if (o2[i] === NONE) o2[i] = q;
    else return false;
    return true;
  };
  // Passo 1: células com vizinha de outra placa.
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 4; d++) {
      const q = plate[neighbors[i * 4 + d] as number] as number;
      if (q !== plate[i]) {
        touches[i] = 1;
        add(i, q);
      }
    }
    if (touches[i]) frontier[count++] = i;
  }
  // Passos seguintes: as placas conhecidas (a da célula e as outras dela) se espalham.
  for (let step = 1; step < NEAR_CELLS && count; step++) {
    let nextCount = 0;
    queued.fill(0);
    // Lê as placas como estavam no começo do passo: senão uma placa recém-chegada andaria várias
    // células num passo só, correndo ao longo da linha de fronteira.
    s1.set(o1);
    s2.set(o2);
    for (let k = 0; k < count; k++) {
      const c = frontier[k] as number;
      const l0 = plate[c] as number;
      const l1 = s1[c] as number;
      const l2 = s2[c] as number;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        let changed = false;
        if (l0 !== NONE && add(nb, l0)) changed = true;
        if (l1 !== NONE && add(nb, l1)) changed = true;
        if (l2 !== NONE && add(nb, l2)) changed = true;
        if (changed && !queued[nb]) {
          queued[nb] = 1;
          next[nextCount++] = nb;
        }
      }
    }
    [frontier, next] = [next, frontier];
    count = nextCount;
  }
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    // "Encosta em outra placa" (vizinhança 3×3, com folga): ela ou uma vizinha tem vizinha de outra placa.
    let line = touches[i] === 1;
    for (let d = 0; d < 4 && !line; d++) line = touches[neighbors[i * 4 + d] as number] === 1;
    // As outras placas na ordem em que chegaram (a própria quando não há outra).
    const p = plate[i] as number;
    const a = o1[i] as number;
    const b = o2[i] as number;
    const first = a !== NONE ? a : b !== NONE ? b : p;
    const second = a !== NONE && b !== NONE ? b : p;
    const v = packPlateCellOf(p, world.crust[i] === Crust.Continental, line, first, second);
    out[i * 2] = v & 255;
    out[i * 2 + 1] = v >> 8;
  }
  return out;
}
