import type { Vec3 } from './cubesphere';
import { CONTINENTAL_DEPTH, Crust, updateBoundaries } from './plates';
import type { WorldState } from './state';

/**
 * Movimento das placas (Marco 2, T4).
 *
 * Cada placa guarda a sua crosta no PRÓPRIO referencial (as "amostras" abaixo) e só acumula um
 * ângulo de rotação em torno do seu eixo fixo. O mapa do mundo é recomposto de tempos em tempos:
 * para cada célula, desfaz-se a rotação de cada placa candidata e consulta-se a amostra daquela
 * placa naquele ponto do referencial. Como as amostras nunca são recopiadas de célula em célula,
 * os continentes não se deformam com o tempo.
 *
 * - Buraco entre placas que se afastam → crosta oceânica nova (dorsal).
 * - Duas placas no mesmo lugar, se aproximando → a continental vence; a oceânica é consumida.
 * - Buracos e sobreposições de 1 célula só por arredondamento (sem movimento relativo real) são
 *   "cicatrizados" copiando a vizinha, sem criar oceano nem destruir crosta.
 * - A recomposição é disparada por ângulo percorrido (contado em passos), nunca por tempo real:
 *   mesma semente + mesmos comandos = mesmo resultado.
 */

/** Ângulo (rad) por passo, com o controle "Placas" em 100% e velocidade relativa 1 da placa. */
export const MAX_PLATE_RATE = 6e-6;
/** Valor inicial do controle "Placas" (0 a 1): deriva lenta, que o jogador acelera ou congela. */
export const DEFAULT_PLATE_RATE = 0.25;
/** Recompor quando alguma placa andou esta fração do tamanho de uma célula. */
export const RECOMPOSE_CELLS = 1;
/** Profundidade da crosta oceânica recém-nascida na dorsal (m, relativa ao nível do mar). */
export const RIDGE_DEPTH = -2500;
/** Nascimento atribuído à crosta inicial (bem antiga). */
const ANCIENT = -1_000_000;

export class Tectonics {
  readonly world: WorldState;
  /** Ângulo acumulado de cada placa (rad) e o ângulo na última recomposição. */
  readonly angle: Float64Array;
  private lastAngle: Float64Array;
  private axis: Float64Array;
  private speed: Float64Array;
  private center0: Float64Array;
  /** Passo atual (para a idade da crosta). */
  tick = 0;
  /** Quantas recomposições já houve (para medir e testar). */
  recompositions = 0;

  // Amostras de crosta, cada uma presa a uma placa e a uma célula do referencial dela.
  private sPlate: Uint8Array;
  private sRef: Int32Array;
  private sElev: Float32Array;
  private sCrust: Uint8Array;
  private sBirth: Int32Array;
  private sAlive: Uint8Array;
  private count = 0;
  private dead = 0;
  /** lookup[placa * células + célula do referencial] → amostra (ou -1). */
  private lookup: Int32Array;
  /** Amostra que compôs cada célula do mundo na última recomposição (ou -1). */
  readonly cellSample: Int32Array;

  constructor(world: WorldState) {
    this.world = world;
    const n = world.cellCount;
    const plates = world.plates.length;
    this.angle = new Float64Array(plates);
    this.lastAngle = new Float64Array(plates);
    this.axis = new Float64Array(plates * 3);
    this.speed = new Float64Array(plates);
    this.center0 = new Float64Array(plates * 3);
    world.plates.forEach((p, k) => {
      const s = Math.hypot(p.omega[0], p.omega[1], p.omega[2]);
      this.speed[k] = s;
      this.axis[k * 3] = s > 0 ? p.omega[0] / s : 0;
      this.axis[k * 3 + 1] = s > 0 ? p.omega[1] / s : 1;
      this.axis[k * 3 + 2] = s > 0 ? p.omega[2] / s : 0;
      this.center0[k * 3] = p.center[0];
      this.center0[k * 3 + 1] = p.center[1];
      this.center0[k * 3 + 2] = p.center[2];
    });
    const cap = Math.ceil(n * 1.5);
    this.sPlate = new Uint8Array(cap);
    this.sRef = new Int32Array(cap);
    this.sElev = new Float32Array(cap);
    this.sCrust = new Uint8Array(cap);
    this.sBirth = new Int32Array(cap);
    this.sAlive = new Uint8Array(cap);
    this.lookup = new Int32Array(plates * n).fill(-1);
    this.cellSample = new Int32Array(n);
    // No início, o referencial de cada placa coincide com o mundo.
    for (let c = 0; c < n; c++) {
      const i = this.addSample(world.plate[c] as number, c, world.elevation[c] as number, world.crust[c] as number, ANCIENT);
      this.cellSample[c] = i;
    }
  }

  get sampleCount(): number {
    return this.count - this.dead;
  }

  private addSample(plate: number, ref: number, elev: number, crust: number, birth: number): number {
    if (this.count === this.sPlate.length) this.grow();
    const i = this.count++;
    this.sPlate[i] = plate;
    this.sRef[i] = ref;
    this.sElev[i] = elev;
    this.sCrust[i] = crust;
    this.sBirth[i] = birth;
    this.sAlive[i] = 1;
    this.lookup[plate * this.world.cellCount + ref] = i;
    return i;
  }

  private kill(i: number): void {
    if (!this.sAlive[i]) return;
    this.sAlive[i] = 0;
    this.dead++;
    const key = (this.sPlate[i] as number) * this.world.cellCount + (this.sRef[i] as number);
    if (this.lookup[key] === i) this.lookup[key] = -1;
  }

  private grow(): void {
    const cap = Math.ceil(this.sPlate.length * 1.5);
    const g = <T extends Uint8Array | Int32Array | Float32Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.sPlate = g(this.sPlate, (k) => new Uint8Array(k));
    this.sRef = g(this.sRef, (k) => new Int32Array(k));
    this.sElev = g(this.sElev, (k) => new Float32Array(k));
    this.sCrust = g(this.sCrust, (k) => new Uint8Array(k));
    this.sBirth = g(this.sBirth, (k) => new Int32Array(k));
    this.sAlive = g(this.sAlive, (k) => new Uint8Array(k));
  }

  /** Remove amostras mortas quando passam de 30% (refaz o índice). */
  private compact(): void {
    if (this.dead < this.count * 0.3) return;
    const n = this.world.cellCount;
    let w = 0;
    const remap = new Int32Array(this.count).fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (!this.sAlive[i]) continue;
      remap[i] = w;
      this.sPlate[w] = this.sPlate[i] as number;
      this.sRef[w] = this.sRef[i] as number;
      this.sElev[w] = this.sElev[i] as number;
      this.sCrust[w] = this.sCrust[i] as number;
      this.sBirth[w] = this.sBirth[i] as number;
      this.sAlive[w] = 1;
      w++;
    }
    this.count = w;
    this.dead = 0;
    this.lookup.fill(-1);
    for (let i = 0; i < w; i++) this.lookup[(this.sPlate[i] as number) * n + (this.sRef[i] as number)] = i;
    for (let c = 0; c < n; c++) {
      const s = this.cellSample[c] as number;
      this.cellSample[c] = s >= 0 ? (remap[s] as number) : -1;
    }
  }

  /**
   * Um passo do relógio. `rate` é o controle "Placas" (0 a 1). Retorna true se o mapa foi recomposto.
   */
  step(rate: number): boolean {
    this.tick++;
    if (rate <= 0) return false;
    const plates = this.angle.length;
    let maxMove = 0;
    for (let p = 0; p < plates; p++) {
      this.angle[p] = (this.angle[p] as number) + MAX_PLATE_RATE * rate * (this.speed[p] as number);
      maxMove = Math.max(maxMove, Math.abs((this.angle[p] as number) - (this.lastAngle[p] as number)));
    }
    if (maxMove < RECOMPOSE_CELLS * this.world.grid.cellAngle) return false;
    this.recompose();
    return true;
  }

  /** Gira um ponto pela rotação inversa da placa (do mundo para o referencial dela). */
  private toPlate(p: number, x: number, y: number, z: number, cos: Float64Array, sin: Float64Array, out: Vec3): void {
    const kx = this.axis[p * 3] as number;
    const ky = this.axis[p * 3 + 1] as number;
    const kz = this.axis[p * 3 + 2] as number;
    const c = cos[p] as number;
    const s = -(sin[p] as number); // rotação inversa
    const d = kx * x + ky * y + kz * z;
    out[0] = x * c + (ky * z - kz * y) * s + kx * d * (1 - c);
    out[1] = y * c + (kz * x - kx * z) * s + ky * d * (1 - c);
    out[2] = z * c + (kx * y - ky * x) * s + kz * d * (1 - c);
  }

  /** Centro atual da placa (o centro original girado). */
  private centerNow(p: number, out: Vec3): void {
    const kx = this.axis[p * 3] as number;
    const ky = this.axis[p * 3 + 1] as number;
    const kz = this.axis[p * 3 + 2] as number;
    const a = this.angle[p] as number;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = this.center0[p * 3] as number;
    const y = this.center0[p * 3 + 1] as number;
    const z = this.center0[p * 3 + 2] as number;
    const d = kx * x + ky * y + kz * z;
    out[0] = x * c + (ky * z - kz * y) * s + kx * d * (1 - c);
    out[1] = y * c + (kz * x - kx * z) * s + ky * d * (1 - c);
    out[2] = z * c + (kx * y - ky * x) * s + kz * d * (1 - c);
  }

  /**
   * As placas a e b, neste ponto, estão se aproximando (> 0) ou se afastando (< 0)?
   * Compara as velocidades na direção que vai do centro de a para o de b.
   */
  private closing(a: number, b: number, x: number, y: number, z: number): number {
    const ca: Vec3 = [0, 0, 0];
    const cb: Vec3 = [0, 0, 0];
    this.centerNow(a, ca);
    this.centerNow(b, cb);
    let dx = cb[0] - ca[0];
    let dy = cb[1] - ca[1];
    let dz = cb[2] - ca[2];
    const along = dx * x + dy * y + dz * z;
    dx -= along * x;
    dy -= along * y;
    dz -= along * z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const vel = (p: number): Vec3 => {
      const s = this.speed[p] as number;
      const kx = (this.axis[p * 3] as number) * s;
      const ky = (this.axis[p * 3 + 1] as number) * s;
      const kz = (this.axis[p * 3 + 2] as number) * s;
      return [ky * z - kz * y, kz * x - kx * z, kx * y - ky * x];
    };
    const va = vel(a);
    const vb = vel(b);
    return ((va[0] - vb[0]) * dx + (va[1] - vb[1]) * dy + (va[2] - vb[2]) * dz) / len;
  }

  /** Recompõe o mapa do mundo a partir das amostras das placas. */
  recompose(): void {
    const world = this.world;
    const { positions, neighbors, cellAngle } = world.grid;
    const n = world.cellCount;
    const plates = this.angle.length;
    const cos = new Float64Array(plates);
    const sin = new Float64Array(plates);
    let maxMove = 0;
    for (let p = 0; p < plates; p++) {
      cos[p] = Math.cos(this.angle[p] as number);
      sin[p] = Math.sin(this.angle[p] as number);
      maxMove = Math.max(maxMove, Math.abs((this.angle[p] as number) - (this.lastAngle[p] as number)));
    }

    // Faixa perto das fronteiras antigas, onde pode haver sobreposição ou buraco.
    const reach = Math.ceil(maxMove / cellAngle) + 2;
    const band = new Uint8Array(n);
    let frontier: number[] = [];
    for (let c = 0; c < n; c++) {
      const pc = world.plate[c];
      for (let d = 0; d < 4; d++) {
        if (world.plate[neighbors[c * 4 + d] as number] !== pc) {
          band[c] = 1;
          frontier.push(c);
          break;
        }
      }
    }
    for (let step = 0; step < reach && frontier.length; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          if (!band[nb]) {
            band[nb] = 1;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }

    const prevPlate = Uint8Array.from(world.plate);
    const newSample = new Int32Array(n).fill(-1);
    const q: Vec3 = [0, 0, 0];
    const pull = (p: number, c: number): number => {
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, cos, sin, q);
      const ref = world.grid.pointToCell(q[0], q[1], q[2]);
      const i = this.lookup[p * n + ref] as number;
      return i >= 0 && this.sAlive[i] ? i : -1;
    };
    const refOf = (p: number, c: number): number => {
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, cos, sin, q);
      return world.grid.pointToCell(q[0], q[1], q[2]);
    };

    const gaps: number[] = [];
    const covering: number[] = [];
    for (let c = 0; c < n; c++) {
      if (!band[c]) {
        const i = pull(prevPlate[c] as number, c);
        if (i >= 0) {
          newSample[c] = i;
          continue;
        }
      }
      covering.length = 0;
      for (let p = 0; p < plates; p++) {
        const i = pull(p, c);
        if (i >= 0) covering.push(i);
      }
      if (covering.length === 0) {
        gaps.push(c);
        continue;
      }
      if (covering.length === 1) {
        newSample[c] = covering[0] as number;
        continue;
      }
      // Sobreposição: escolhe a vencedora; a perdedora só é consumida se for aproximação de verdade.
      const x = positions[c * 3] as number;
      const y = positions[c * 3 + 1] as number;
      const z = positions[c * 3 + 2] as number;
      let win = covering[0] as number;
      for (let k = 1; k < covering.length; k++) {
        const other = covering[k] as number;
        if (this.beats(other, win, prevPlate[c] as number)) win = other;
      }
      newSample[c] = win;
      for (const i of covering) {
        if (i === win) continue;
        const loser = this.sPlate[i] as number;
        const winner = this.sPlate[win] as number;
        if (loser !== winner && this.closing(loser, winner, x, y, z) > 0) this.kill(i);
      }
    }

    // Buracos: dorsal (crosta oceânica nova) onde as placas se afastam; senão, cicatriza copiando.
    // Processa de fora para dentro, para cada buraco ter um vizinho já resolvido.
    let pending = gaps;
    for (let guard = 0; pending.length && guard < 1000; guard++) {
      const still: number[] = [];
      for (const c of pending) {
        let fromSample = -1;
        let ownerVotes: number[] | null = null;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          const s = newSample[nb] as number;
          if (s < 0) continue;
          ownerVotes ??= new Array<number>(plates).fill(0);
          ownerVotes[this.sPlate[s] as number] = (ownerVotes[this.sPlate[s] as number] as number) + 1;
          if (this.sPlate[s] === prevPlate[c] || fromSample < 0) fromSample = s;
        }
        if (!ownerVotes || fromSample < 0) {
          still.push(c);
          continue;
        }
        const owner = prevPlate[c] as number;
        // Outra placa encostada neste buraco (a mais frequente entre os vizinhos).
        let other = -1;
        let best = 0;
        for (let p = 0; p < plates; p++) {
          if (p !== owner && (ownerVotes[p] as number) > best) {
            best = ownerVotes[p] as number;
            other = p;
          }
        }
        const x = positions[c * 3] as number;
        const y = positions[c * 3 + 1] as number;
        const z = positions[c * 3 + 2] as number;
        const opening = other >= 0 && this.closing(owner, other, x, y, z) < 0;
        const ref = refOf(owner, c);
        const existing = this.lookup[owner * n + ref] as number;
        if (existing >= 0 && this.sAlive[existing]) {
          newSample[c] = existing;
          continue;
        }
        const i = opening
          ? this.addSample(owner, ref, RIDGE_DEPTH, Crust.Oceanic, this.tick)
          : this.addSample(owner, ref, this.sElev[fromSample] as number, this.sCrust[fromSample] as number, this.sBirth[fromSample] as number);
        newSample[c] = i;
      }
      if (still.length === pending.length) break;
      pending = still;
    }

    // Escreve o mapa do mundo.
    for (let c = 0; c < n; c++) {
      const i = newSample[c] as number;
      this.cellSample[c] = i;
      if (i < 0) continue;
      world.plate[c] = this.sPlate[i] as number;
      world.elevation[c] = this.sElev[i] as number;
      world.crust[c] = this.sCrust[i] as number;
    }
    for (let p = 0; p < plates; p++) {
      this.lastAngle[p] = this.angle[p] as number;
      const plate = world.plates[p];
      if (plate) this.centerNow(p, plate.center as Vec3);
    }
    updateBoundaries(world);
    this.recompositions++;
    this.compact();
  }

  /** Regra de quem fica por cima numa sobreposição: continental > oceânica > mais jovem. */
  private beats(a: number, b: number, prevOwner: number): boolean {
    const ca = this.sCrust[a] as number;
    const cb = this.sCrust[b] as number;
    if (ca !== cb) return ca === Crust.Continental;
    if (ca === Crust.Oceanic) {
      const ba = this.sBirth[a] as number;
      const bb = this.sBirth[b] as number;
      if (ba !== bb) return ba > bb; // a oceânica mais velha afunda
    }
    return (this.sPlate[a] as number) === prevOwner && (this.sPlate[b] as number) !== prevOwner;
  }

  /** Depois de uma pincelada: grava nas amostras o que foi pintado nas células (anda com a placa). */
  syncCells(cells: readonly number[]): void {
    const world = this.world;
    for (const c of cells) {
      const i = this.cellSample[c] as number;
      if (i < 0 || !this.sAlive[i]) continue;
      this.sElev[i] = world.elevation[c] as number;
      this.sCrust[i] = world.heightAboveSea(c) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic;
      world.crust[c] = this.sCrust[i] as number;
    }
  }
}
