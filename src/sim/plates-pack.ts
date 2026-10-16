import { NEAR_CELLS, packPlateCell } from '../render/plate-motion';
import { Crust } from '../world/plates';
import type { WorldState } from '../world/state';

/**
 * Textura de placas do shader (2 bytes por célula, R e G; ver plate-motion.ts): placa, crosta
 * continental, se encosta em outra placa, e até duas outras placas a até NEAR_CELLS passos.
 */
export function packPlates(world: WorldState): Uint8Array {
  const n = world.cellCount;
  const { neighbors } = world.grid;
  const plate = world.plate;
  const NONE = 255;
  const o1 = new Uint8Array(n).fill(NONE);
  const o2 = new Uint8Array(n).fill(NONE);
  const add = (i: number, q: number): boolean => {
    if (q === plate[i] || o1[i] === q || o2[i] === q) return false;
    if (o1[i] === NONE) o1[i] = q;
    else if (o2[i] === NONE) o2[i] = q;
    else return false;
    return true;
  };
  // Passo 1: células com vizinha de outra placa.
  const touches = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 4; d++) {
      const q = plate[neighbors[i * 4 + d] as number] as number;
      if (q !== plate[i]) {
        touches[i] = 1;
        add(i, q);
      }
    }
    if (touches[i]) frontier.push(i);
  }
  // Passos seguintes: as placas conhecidas (a da célula e as outras dela) se espalham.
  const queued = new Uint8Array(n);
  for (let step = 1; step < NEAR_CELLS && frontier.length; step++) {
    const next: number[] = [];
    queued.fill(0);
    // Lê as placas como estavam no começo do passo: senão uma placa recém-chegada andaria várias
    // células num passo só, correndo ao longo da linha de fronteira.
    const s1 = o1.slice();
    const s2 = o2.slice();
    for (const c of frontier) {
      const labels = [plate[c] as number, s1[c] as number, s2[c] as number];
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        let changed = false;
        for (const q of labels) if (q !== NONE && add(nb, q)) changed = true;
        if (changed && !queued[nb]) {
          queued[nb] = 1;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    // "Encosta em outra placa" (vizinhança 3×3, com folga): ela ou uma vizinha tem vizinha de outra placa.
    let line = touches[i] === 1;
    for (let d = 0; d < 4 && !line; d++) line = touches[neighbors[i * 4 + d] as number] === 1;
    const others: number[] = [];
    if (o1[i] !== NONE) others.push(o1[i] as number);
    if (o2[i] !== NONE) others.push(o2[i] as number);
    const v = packPlateCell(plate[i] as number, world.crust[i] === Crust.Continental, line, others);
    out[i * 2] = v & 255;
    out[i * 2 + 1] = v >> 8;
  }
  return out;
}
