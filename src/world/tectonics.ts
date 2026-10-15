import type { Vec3 } from './cubesphere';
import { createRng } from '../core/rng';
import { Noise3D } from './noise';
import { Boundary, CONTINENTAL_DEPTH, Crust, updateBoundaries } from './plates';
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
 * - Buracos isolados de 1 célula só por arredondamento (sem afastamento real, cercados de crosta)
 *   são "cicatrizados" copiando a vizinha; qualquer outra fenda vira fundo oceânico novo.
 *   Sobreposição sem aproximação real não destrói crosta.
 * - A recomposição é disparada por ângulo percorrido (contado em passos), nunca por tempo real:
 *   mesma semente + mesmos comandos = mesmo resultado.
 */

/** Ângulo (rad) por passo, com o controle "Placas" em 100% e velocidade relativa 1 da placa. */
export const MAX_PLATE_RATE = 1.4e-5;
/** Valor inicial do controle "Placas" (0 a 1): deriva lenta, que o jogador acelera ou congela. */
export const DEFAULT_PLATE_RATE = 0.25;
/** Recompor quando alguma placa andou esta fração do tamanho de uma célula. */
export const RECOMPOSE_CELLS = 2;
/** Profundidade da crosta oceânica recém-nascida na dorsal (m, relativa ao nível do mar). */
export const RIDGE_DEPTH = -2500;
/** Nascimento atribuído à crosta inicial (bem antiga). */
const ANCIENT = -1_000_000;

// --- Relevo nas fronteiras (T5). Valores por recomposição (cada uma = RECOMPOSE_CELLS de deriva). ---
/** Idade (passos) em que o fundo oceânico chega à planície abissal. */
export const AGE_FULL_TICKS = 40_000;
/** Profundidade extra da planície abissal em relação à dorsal (m). */
export const ABYSSAL_EXTRA = 2500;
/** Fossa de subducção: profundidade alvo e quanto afunda por recomposição (m). */
export const TRENCH_DEPTH = -6500;
const TRENCH_RATE = 900;
/** Quantas células de oceano antes da fossa já vão afundando (a crosta é consumida na fronteira). */
const TRENCH_REACH = 3;
/** Colisão continental: elevação perto da fronteira por recomposição (m) e teto. */
const COLLISION_UPLIFT = 480;
const COLLISION_MAX = 7000;
/** Cordilheira vulcânica (oceano sob continente) e arco de ilhas (oceano sob oceano). */
const ARC_UPLIFT = 300;
const ARC_MAX = 4800;
const ISLAND_ARC_UPLIFT = 550;
const ISLAND_ARC_MAX = 900;
/** Alcance (células) das montanhas para dentro da placa que fica por cima. */
const OROGEN_REACH = 8;
/** Margem passiva: a borda do continente que se rasga afunda até virar plataforma (m). */
const MARGIN_RATE = 260;
const MARGIN_REACH = 3;
/** Enquanto o oceano novo encostado tem menos que esta idade (passos), a margem segue afundando. */
const MARGIN_AGE = 30_000;
/** Erosão: acima desta altura (m) o relevo cede um pouco a cada recomposição. */
const EROSION_START = 2500;
const EROSION_RATE = 0.035;
/** Acima desta altura (m) o relevo suaviza com as vizinhas (cordilheiras viram faixas, não riscos). */
const SMOOTH_START = 1200;
const SMOOTH_RATE = 0.25;

/** Profundidade do fundo oceânico pela idade: dorsal rasa, afunda com a raiz da idade. */
export function oceanDepthAt(age: number): number {
  return RIDGE_DEPTH - ABYSSAL_EXTRA * Math.sqrt(Math.min(1, Math.max(0, age) / AGE_FULL_TICKS));
}

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
  /** Passo da última recomposição (subsidência do fundo oceânico é incremental). */
  private lastReliefTick = 0;
  /** Ruído fixo no referencial das placas (recorte das margens passivas). */
  private marginNoise: Noise3D;
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
  /**
   * Índice placa+célula do referencial → amostra. As primeiras `células` amostras são a crosta
   * inicial e valem por identidade (amostra i = célula i, na placa inicial dela), então só as
   * amostras criadas depois (dorsais, cicatrizes) entram neste mapa. Antes era um índice denso de
   * placas × células (~22 MB), que pesava demais na memória do celular.
   */
  private extra = new Map<number, number>();
  private initialPlate: Uint8Array;
  /** Amostra que compôs cada célula do mundo na última recomposição (ou -1). */
  readonly cellSample: Int32Array;

  /** Relevo nas fronteiras (T5). Os testes de movimento puro desligam para comparar alturas exatas. */
  readonly reliefEnabled: boolean;

  constructor(world: WorldState, options: { relief?: boolean } = {}) {
    this.world = world;
    this.reliefEnabled = options.relief ?? true;
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
    const cap = Math.ceil(n * 1.25);
    this.sPlate = new Uint8Array(cap);
    this.sRef = new Int32Array(cap);
    this.sElev = new Float32Array(cap);
    this.sCrust = new Uint8Array(cap);
    this.sBirth = new Int32Array(cap);
    this.sAlive = new Uint8Array(cap);
    this.initialPlate = Uint8Array.from(world.plate);
    this.marginNoise = new Noise3D(createRng((world.params.seed ^ 0x2545f491) >>> 0));
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
    if (i >= this.world.cellCount) this.extra.set(plate * this.world.cellCount + ref, i);
    return i;
  }

  /** Amostra viva da placa naquela célula do referencial dela, ou -1. */
  private find(plate: number, ref: number): number {
    if (this.initialPlate[ref] === plate && this.sAlive[ref]) return ref;
    const i = this.extra.get(plate * this.world.cellCount + ref);
    return i !== undefined && this.sAlive[i] ? i : -1;
  }

  /** Memória aproximada usada pela tectônica (bytes), para o painel Dados. */
  get bytes(): number {
    const perSample = 1 + 4 + 4 + 1 + 4 + 1;
    return this.sPlate.length * perSample + this.cellSample.byteLength + this.initialPlate.byteLength + this.extra.size * 40;
  }

  private kill(i: number): void {
    if (!this.sAlive[i]) return;
    this.sAlive[i] = 0;
    this.dead++;
    if (i >= this.world.cellCount) {
      const key = (this.sPlate[i] as number) * this.world.cellCount + (this.sRef[i] as number);
      if (this.extra.get(key) === i) this.extra.delete(key);
    }
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

  /**
   * Remove amostras mortas criadas depois do início quando passam de 30% delas (refaz o mapa).
   * As amostras iniciais ficam onde estão: valem por identidade.
   */
  private compact(): void {
    const n = this.world.cellCount;
    const appended = this.count - n;
    let deadAppended = 0;
    for (let i = n; i < this.count; i++) if (!this.sAlive[i]) deadAppended++;
    if (appended <= 0 || deadAppended < appended * 0.3) return;
    let w = n;
    const remap = new Int32Array(this.count - n).fill(-1);
    for (let i = n; i < this.count; i++) {
      if (!this.sAlive[i]) continue;
      remap[i - n] = w;
      this.sPlate[w] = this.sPlate[i] as number;
      this.sRef[w] = this.sRef[i] as number;
      this.sElev[w] = this.sElev[i] as number;
      this.sCrust[w] = this.sCrust[i] as number;
      this.sBirth[w] = this.sBirth[i] as number;
      this.sAlive[w] = 1;
      w++;
    }
    this.dead -= deadAppended;
    this.count = w;
    this.extra.clear();
    for (let i = n; i < w; i++) this.extra.set((this.sPlate[i] as number) * n + (this.sRef[i] as number), i);
    for (let c = 0; c < n; c++) {
      const s0 = this.cellSample[c] as number;
      if (s0 >= n) this.cellSample[c] = remap[s0 - n] as number;
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
      return this.find(p, world.grid.pointToCell(q[0], q[1], q[2]));
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
        let covered = 0;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          const s = newSample[nb] as number;
          if (s < 0) continue;
          covered++;
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
        // Cicatriza (copia a vizinha) só buraco isolado de arredondamento, cercado de crosta.
        // Fenda de verdade vira fundo oceânico novo, mesmo sem afastamento claro: copiar
        // continente ali arrastava tiras de terra atrás das placas que deslizam de lado.
        const isolatedHole = covered >= 3;
        const ref = refOf(owner, c);
        const existing = this.find(owner, ref);
        if (existing >= 0) {
          newSample[c] = existing;
          continue;
        }
        const i = opening || !isolatedHole
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
    if (this.reliefEnabled) this.relief();
    this.recompositions++;
    this.compact();
  }

  /**
   * Relevo nas fronteiras (T5), aplicado nas amostras (anda com as placas):
   * - fundo oceânico jovem afunda com a idade (dorsais rasas, planícies abissais);
   * - convergência: a crosta oceânica (a mais velha, entre duas oceânicas) afunda numa fossa; a placa
   *   que fica por cima ergue cordilheira (colisão continental), cordilheira vulcânica (oceano sob
   *   continente) ou arco de ilhas (oceano sob oceano);
   * - divergência que rasga continente: a borda afunda até virar plataforma, com intensidade que
   *   varia ao longo da costa (baías e penínsulas em vez de corte reto);
   * - erosão leve dos picos.
   */
  private relief(): void {
    const world = this.world;
    const { neighbors, positions } = world.grid;
    const n = world.cellCount;
    const elev = world.elevation;

    // 1) Fundo oceânico jovem afunda (incremental desde a última recomposição).
    for (let c = 0; c < n; c++) {
      const i = this.cellSample[c] as number;
      if (i < 0 || this.sCrust[i] !== Crust.Oceanic || (this.sBirth[i] as number) <= ANCIENT) continue;
      const birth = this.sBirth[i] as number;
      elev[c] = (elev[c] as number) + oceanDepthAt(this.tick - birth) - oceanDepthAt(this.lastReliefTick - birth);
    }
    this.lastReliefTick = this.tick;

    // 2) Papéis nas fronteiras.
    const KIND_COLLISION = 1;
    const KIND_ARC = 2;
    const KIND_ISLAND_ARC = 3;
    const orogenKind = new Uint8Array(n);
    const orogenDist = new Uint8Array(n).fill(255);
    const marginDist = new Uint8Array(n).fill(255);
    const trenchDist = new Uint8Array(n).fill(255);
    let orogenFrontier: number[] = [];
    let marginFrontier: number[] = [];
    let trenchFrontier: number[] = [];
    // Margem passiva: continente encostado em fundo oceânico jovem (aberto por um rifte). A fenda
    // nova fica com crosta da própria placa, então essa costa nem é fronteira de placa.
    for (let c = 0; c < n; c++) {
      if (world.crust[c] !== Crust.Continental) continue;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        const s = this.cellSample[k] as number;
        if (s < 0 || this.sCrust[s] !== Crust.Oceanic) continue;
        const birth = this.sBirth[s] as number;
        if (birth > ANCIENT && this.tick - birth < MARGIN_AGE) {
          marginDist[c] = 0;
          marginFrontier.push(c);
          break;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      const kind = world.boundary[c];
      if (kind !== Boundary.Convergent && kind !== Boundary.Divergent) continue;
      let nb = -1;
      for (let d = 0; d < 4 && nb < 0; d++) {
        const k = neighbors[c * 4 + d] as number;
        if (world.plate[k] !== world.plate[c]) nb = k;
      }
      if (nb < 0) continue;
      const cOcean = world.crust[c] === Crust.Oceanic;
      const nOcean = world.crust[nb] === Crust.Oceanic;
      if (kind === Boundary.Convergent) {
        const ci = this.cellSample[c] as number;
        const ni = this.cellSample[nb] as number;
        // Mesmo desempate da sobreposição: a mais velha afunda; mesma idade, a mais funda.
        let older = false;
        if (ci >= 0 && ni >= 0) {
          const bc = this.sBirth[ci] as number;
          const bn = this.sBirth[ni] as number;
          older = bc !== bn ? bc < bn : (this.sElev[ci] as number) < (this.sElev[ni] as number);
        }
        const subducts = cOcean && (!nOcean || older);
        if (subducts) {
          trenchDist[c] = 0;
          trenchFrontier.push(c);
        } else {
          orogenKind[c] = !cOcean && !nOcean ? KIND_COLLISION : !cOcean ? KIND_ARC : KIND_ISLAND_ARC;
          orogenDist[c] = 0;
          orogenFrontier.push(c);
        }
      }
    }
    // Fossa: o oceano que vem chegando já afunda antes de ser consumido.
    for (let step = 1; step <= TRENCH_REACH && trenchFrontier.length; step++) {
      const next: number[] = [];
      for (const c of trenchFrontier) {
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (world.plate[k] !== world.plate[c] || world.crust[k] !== Crust.Oceanic || (trenchDist[k] as number) <= step) continue;
          trenchDist[k] = step;
          next.push(k);
        }
      }
      trenchFrontier = next;
    }
    // Espalha para dentro da mesma placa.
    for (let step = 1; step <= OROGEN_REACH && orogenFrontier.length; step++) {
      const next: number[] = [];
      for (const c of orogenFrontier) {
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (world.plate[k] !== world.plate[c] || (orogenDist[k] as number) <= step) continue;
          orogenDist[k] = step;
          orogenKind[k] = orogenKind[c] as number;
          next.push(k);
        }
      }
      orogenFrontier = next;
    }
    for (let step = 1; step <= MARGIN_REACH && marginFrontier.length; step++) {
      const next: number[] = [];
      for (const c of marginFrontier) {
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (world.plate[k] !== world.plate[c] || world.crust[k] === Crust.Oceanic || (marginDist[k] as number) <= step) continue;
          marginDist[k] = step;
          next.push(k);
        }
      }
      marginFrontier = next;
    }

    // 3) Aplica fossas, montanhas, arcos e margens.
    for (let c = 0; c < n; c++) {
      const td = trenchDist[c] as number;
      if (td !== 255) {
        const target = TRENCH_DEPTH + td * 700;
        const e = elev[c] as number;
        if (e > target) elev[c] = Math.max(target, e - TRENCH_RATE);
      }
      const od = orogenDist[c] as number;
      if (od !== 255) {
        const kind = orogenKind[c];
        const e = elev[c] as number;
        if (kind === KIND_COLLISION) {
          // Faixa larga em sino a partir da frente de colisão.
          const f = Math.exp(-((od / 4) ** 2));
          elev[c] = Math.min(COLLISION_MAX, e + COLLISION_UPLIFT * f);
        } else if (kind === KIND_ARC) {
          // Cordilheira vulcânica com o pico a 3–4 células da costa (como os Andes).
          const f = Math.exp(-(((od - 3.5) / 2.2) ** 2));
          if (e < ARC_MAX) elev[c] = Math.min(ARC_MAX, e + ARC_UPLIFT * f);
        } else if (od >= 2 && od <= 3 && e < ISLAND_ARC_MAX) {
          // Arco de ilhas: só trechos do arco emergem (ruído fixo na placa): ilhas soltas, não um risco.
          const i = this.cellSample[c] as number;
          const ref = i >= 0 ? (this.sRef[i] as number) : c;
          const v = 0.5 + 0.5 * this.marginNoise.sample(
            (positions[ref * 3] as number) * 9 + 31,
            (positions[ref * 3 + 1] as number) * 9,
            (positions[ref * 3 + 2] as number) * 9,
          );
          const f = Math.min(1, Math.max(0, (v - 0.55) / 0.2));
          if (f > 0) elev[c] = Math.min(ISLAND_ARC_MAX, e + ISLAND_ARC_UPLIFT * f);
        }
      }
      const md = marginDist[c] as number;
      if (md !== 255) {
        // Ruído fixo no referencial da placa: a borda afunda mais em uns trechos que em outros.
        const i = this.cellSample[c] as number;
        const ref = i >= 0 ? (this.sRef[i] as number) : c;
        const x = positions[ref * 3] as number;
        const y = positions[ref * 3 + 1] as number;
        const z = positions[ref * 3 + 2] as number;
        const v = 0.5 + 0.5 * this.marginNoise.sample(x * 14, y * 14, z * 14);
        const target = md === 0 ? -160 : md === 1 ? -60 : 40;
        const e = elev[c] as number;
        if (e > target) elev[c] = Math.max(target, e - MARGIN_RATE * (0.2 + 1.6 * v * v) * (1 - md / (MARGIN_REACH + 1)));
      }
    }

    // 4) Erosão leve: picos cedem e o relevo alto suaviza com as vizinhas.
    for (let c = 0; c < n; c++) {
      const e = elev[c] as number;
      if (e <= SMOOTH_START) continue;
      let mean = 0;
      for (let d = 0; d < 4; d++) mean += elev[neighbors[c * 4 + d] as number] as number;
      mean /= 4;
      const eroded = e > EROSION_START ? e - EROSION_RATE * (e - EROSION_START) : e;
      // Só puxa para a média quando a vizinhança também é terra alta (não "derrete" a costa).
      elev[c] = mean > 0 ? eroded + SMOOTH_RATE * (mean - eroded) : eroded;
    }

    // 5) Grava nas amostras (anda com a placa); a crosta segue a altura.
    for (let c = 0; c < n; c++) {
      const i = this.cellSample[c] as number;
      if (i < 0) continue;
      this.sElev[i] = elev[c] as number;
      const crust = world.heightAboveSea(c) > CONTINENTAL_DEPTH ? Crust.Continental : Crust.Oceanic;
      // Crosta continental não vira oceânica só por afundar na margem; arco que emerge vira continental.
      if (crust === Crust.Continental) this.sCrust[i] = crust;
      world.crust[c] = this.sCrust[i] as number;
    }
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
      const ea = this.sElev[a] as number;
      const eb = this.sElev[b] as number;
      if (ea !== eb) return ea > eb; // mesma idade: a mais funda afunda
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
