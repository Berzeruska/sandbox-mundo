import { CHUNK_COARSE, chunkKey } from './chart';
import { computeHydro, neighborTable, type Hydro } from './rivers';
import { buildWorldChunk, setDepositLook, setRelief, type CoarseWorld, type ReliefMode } from './world-fields';

/** Ajudante da maquete: monta os pedaços fora da tela. */
export type ToMaqueteWorker =
  | { type: 'world'; world: CoarseWorld; id: number; relief: ReliefMode; stones: string; oil: string }
  | { type: 'build'; key: number; face: number; cx: number; cz: number; gen: number; near?: boolean };

export type FromMaqueteWorker =
  /** Só as plantas de perto de um pedaço já na tela. */
  | { type: 'near'; key: number; gen: number; props: ArrayBuffer }
  | { type: 'chunk'; key: number; gen: number; ms: number; terrain: ArrayBuffer; water: ArrayBuffer; props: ArrayBuffer; propsFar: ArrayBuffer; skirts: ArrayBuffer; skirtRanges: [number, number][]; animals: Float32Array; flames: Float32Array; vents: Float32Array; walkY: Float32Array; walkMask: Uint8Array }
  /** Células mudaram desde a última cópia: estes pedaços precisam ser refeitos. */
  | { type: 'changed'; keys: number[]; id: number };

let world: CoarseWorld | null = null;
let hydro: Hydro | null = null;
let neighbors: Int32Array | null = null;
let hydroAt = -Infinity;
const scope = self as unknown as { postMessage(m: FromMaqueteWorker, t?: Transferable[]): void; onmessage: (e: MessageEvent<ToMaqueteWorker>) => void };

/** Compara duas cópias e devolve os pedaços afetados (a borda de um pedaço enxerga 3 células de fora). */
function diff(a: CoarseWorld, b: CoarseWorld): number[] {
  const n = a.n, keys = new Set<number>();
  const count = 6 * n * n;
  for (let c = 0; c < count; c++) {
    const o = c * 4;
    if (a.height[c] === b.height[c] && a.state[c] === b.state[c] && a.volcano[c] === b.volcano[c] && a.ice[c] === b.ice[c] && a.deposit[c] === b.deposit[c] && a.rgba[o] === b.rgba[o] && a.rgba[o + 1] === b.rgba[o + 1] && a.rgba[o + 2] === b.rgba[o + 2] && Math.abs((a.cover[c] as number) - (b.cover[c] as number)) < 8) continue;
    const face = Math.floor(c / (n * n)), rest = c - face * n * n, x = rest % n, zc = n - 1 - Math.floor(rest / n);
    for (const dz of [-3, 3]) for (const dx of [-3, 3]) {
      const px = x + dx, pz = zc + dz;
      if (px < 0 || pz < 0 || px >= n || pz >= n) continue;
      keys.add(chunkKey(face, Math.floor(px / CHUNK_COARSE), Math.floor(pz / CHUNK_COARSE)));
    }
  }
  return [...keys];
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'world') {
    setRelief(m.relief);
    setDepositLook(m.stones, m.oil);
    // Os rios só mudam quando o relevo muda.
    const sameHeight = world && world.n === m.world.n && world.height.every((h, i) => h === m.world.height[i]);
    // Os rios são caros (cerca de 200 ms): no máximo um recálculo a cada 3 s, para não atrasar os pedaços.
    const nowMs = performance.now();
    if (!hydro || (!sameHeight && nowMs - hydroAt > 3000)) {
      hydroAt = nowMs;
      neighbors ??= neighborTable(m.world.n);
      hydro = computeHydro(m.world.n, m.world.height, m.world.rgba, m.world.ice, neighbors);
    }
    if (world && world.n === m.world.n) {
      const keys = diff(world, m.world);
      if (keys.length) scope.postMessage({ type: 'changed', keys, id: m.id });
    }
    world = m.world;
    return;
  }
  if (!world) return;
  const t0 = performance.now();
  const c = buildWorldChunk(world, hydro, m.face, m.cx, m.cz, m.near === true);
  if (m.near) { scope.postMessage({ type: 'near', key: m.key, gen: m.gen, props: c.props }, [c.props]); return; }
  scope.postMessage({ type: 'chunk', key: m.key, gen: m.gen, ms: performance.now() - t0, terrain: c.terrain, water: c.water, props: c.props, propsFar: c.propsFar, skirts: c.skirts, skirtRanges: c.skirtRanges, animals: c.animals, flames: c.flames, vents: c.vents, walkY: c.walkY, walkMask: c.walkMask }, [c.terrain, c.water, c.props, c.propsFar, c.skirts, c.animals.buffer as ArrayBuffer, c.flames.buffer as ArrayBuffer, c.vents.buffer as ArrayBuffer, c.walkY.buffer as ArrayBuffer, c.walkMask.buffer as ArrayBuffer]);
};
