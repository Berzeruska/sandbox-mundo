import type { Vec3 } from './cubesphere';
import { createRng, type Rng } from '../core/rng';
import { Noise3D } from './noise';
import { Boundary, CONTINENTAL_DEPTH, Crust, DISPERSAL_STAGE, DISPERSAL_STAGE_MIN, POLAR_GUARD, rotateAbout, updateBoundaries } from './plates';
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

// --- Identidade das placas (D3). ---
/**
 * Solda continental: dois continentes que colidem (crosta continental consumida na frente) em
 * WELD_AFTER recomposições passam a andar juntos. A cordilheira cresce durante essas recomposições e
 * a colisão para (antes, empurravam um contra o outro para sempre). Qualquer frente conta: um pedaço
 * pequeno que só raspava (frente de 1–2 células) ficava abaixo do mínimo antigo e nunca soldava.
 */
export const WELD_AFTER = 8;
/** Pedaço solto de placa menor que esta fração do planeta gruda na placa vizinha (~0,4%). */
export const FRAGMENT_SHARE = 0.004;
/**
 * Só placas com pelo menos esta fração do planeta em crosta continental contam como "continente" na
 * solda. Numa colisão em que um dos lados tem menos (uma lasca de continente numa placa quase toda
 * oceânica), a lasca que está colidindo passa para a outra placa (acreção) em vez de soldar as duas.
 */
export const CONTINENT_SHARE = 0.015;
/**
 * Frente de colisão só conta onde as placas se aproximam de verdade (velocidade relativa na direção
 * entre os centros, na escala da velocidade relativa 1). Antes, crosta consumida só por
 * arredondamento contava como colisão e soldava placas sem movimento relativo nenhum (G1).
 */
export const COLLISION_CLOSING_MIN = 0.05;
/**
 * Sutura (G1): duas placas soldadas continuam soldadas enquanto houver crosta continental de uma a
 * até SUTURE_REACH células de crosta continental da outra. Sem contato por SUTURE_GRACE recomposições
 * seguidas, a sutura some (acaba a "solda à distância").
 */
export const SUTURE_REACH = 2;
export const SUTURE_GRACE = 3;

// --- Reorganização das placas (G1). Ângulos em rad de giro a velocidade relativa 1 (o "relógio da
// deriva": anda com o controle Placas, para em 0). 1 min de jogo a 20× com Placas 100% ≈ 11,6°. ---
const DEG = Math.PI / 180;
/** Duração de um estágio: ao fim dele, o grupo de placas ganha polo de Euler novo. */
export const STAGE_MIN = 30 * DEG;
export const STAGE_MAX = 45 * DEG;
/** O rumo novo fica a até este ângulo do rumo atual (sem zigue-zague). */
export const STAGE_TURN_MAX = 60 * DEG;
/** Velocidade relativa sorteada para o estágio novo. */
export const STAGE_SPEED_MIN = 0.4;
export const STAGE_SPEED_MAX = 1;
/** Grupo com muito continente anda mais devagar: até −40% com metade ou mais da crosta continental. */
export const STAGE_CONTINENT_SLOWDOWN = 0.4;
/**
 * Guarda polar (POLAR_GUARD, em plates.ts): um rumo que levaria o centro do grupo, ao longo do
 * estágio, além dela (e mais perto do polo do que está) é sorteado de novo, até STAGE_DRAWS vezes.
 */
const STAGE_DRAWS = 8;

// --- Ciclo de Wilson (G2). Tempos no relógio da deriva (rad a velocidade 1; ≈ 11,6° por minuto de
// jogo a 20× com Placas 100%). Ajustáveis aqui. ---
/** Supercontinente: um grupo soldado com pelo menos esta fração de toda a crosta continental. */
export const SUPERCONTINENT_SHARE = 0.7;
/** Mandato do supercontinente antes de rachar (~2 min), vezes um sorteio entre os dois fatores. */
export const TENURE = 23 * DEG;
export const TENURE_JITTER_MIN = 0.8;
export const TENURE_JITTER_MAX = 1.25;
/** Dispersão: depois de uma ruptura (e no começo), quanto tempo os continentes só se afastam (~4,3 min). */
export const DISPERSAL_TIME = 50 * DEG;
/** Reunião: tempo máximo para formar o supercontinente (~5,6 min); depois disso vale a regra secundária. */
export const ASSEMBLY_MAX = 65 * DEG;
/** Regra secundária: grupo com ≥ 2 placas continentais e esta fração do continente racha mesmo assim. */
export const BIG_BLOCK_SHARE = 0.35;
/** Ponto de reunião: a esta distância do centro do supercontinente anterior, sem passar desta latitude. */
export const ASSEMBLY_DISTANCE_MIN = 20 * DEG;
export const ASSEMBLY_DISTANCE_MAX = 40 * DEG;
export const ASSEMBLY_LAT_MAX = 35 * DEG;
/** Na reunião, o rumo de cada continente aponta para o ponto de reunião com até este desvio. */
export const ASSEMBLY_TURN_MAX = 30 * DEG;
export const ASSEMBLY_SPEED_MIN = 0.6;
/** O supercontinente quase para enquanto dura. */
export const SUPERCONTINENT_SPEED_MIN = 0.15;
export const SUPERCONTINENT_SPEED_MAX = 0.35;
/** Ruptura: cada pedaço fica com pelo menos esta fração do continente do grupo. */
export const RUPTURE_MIN_PIECE = 0.2;
/** Numa junção tríplice, chance de um dos braços falhar (fica soldado; vira vale no G3). */
export const FAILED_ARM_CHANCE = 1 / 3;
/**
 * Pedaços novos giram em torno do polo que abre a fenda inteira (oposto da média de p × n na
 * divisa); os sorteios inclinam esse polo até ~RIFT_TURN_MAX, sem deixar a fenda fechar.
 */
export const RIFT_TURN_MAX = 25 * DEG;
export const RIFT_SPEED_MIN = 0.5;
export const RIFT_SPEED_MAX = 1;

/** Fase do ciclo de Wilson. */
export type CyclePhase = 'dispersal' | 'assembly' | 'supercontinent';

/** Como sortear o polo novo de um grupo: rumo de base (atual, para um ponto ou para longe de um ponto). */
interface MotionPlan {
  toward?: Vec3;
  /** Polo de Euler já calculado (ruptura: o que abre a fenda); os sorteios só o inclinam um pouco. */
  pole?: Vec3;
  /**
   * Divisas continentais com placas de fora (ponto p, normal n para fora, placa vizinha): entre os
   * sorteios, fica o que menos empurra o pedaço contra outros continentes.
   */
  avoid?: { p: Vec3; n: Vec3; plate: number }[];
  /** Dispersão depois de uma ruptura: rumos que aproximam o grupo deste ponto (o supercontinente antigo) são penalizados. */
  awayFrom?: Vec3;
  turnMax: number;
  speedMin: number;
  speedMax: number;
}

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
/** Chave de um par de placas (sem ordem). */
function pairKey(a: number, b: number): number {
  return a < b ? a * 256 + b : b * 256 + a;
}

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
  /**
   * A posição de cada placa é a rotação acumulada até a última troca de eixo (`rot0`, matriz 3×3) e
   * depois o giro em torno do eixo atual pelo ângulo andado desde então (angle − angle0). O eixo só
   * muda numa solda; entre recomposições é sempre um giro em torno de um eixo fixo (o desenho conta com isso).
   */
  private rot0: Float64Array;
  private angle0: Float64Array;
  /**
   * Solda: grupo de cada placa (a menor placa do grupo), refeito a partir das suturas; e o contador de
   * colisão de cada par (sobe a cada recomposição com frente, desce sem frente).
   */
  private group: Int32Array;
  private collisions = new Map<number, number>();
  /** Suturas (par de placas → passo e relógio da deriva em que nasceu, recomposições sem contato). */
  private sutures = new Map<number, { born: number; bornDrift: number; miss: number }>();
  /** Ciclo de Wilson (G2): fase, quando ela acaba, centro do último supercontinente e ponto de reunião. */
  private phase: CyclePhase = 'dispersal';
  private phaseEnd = DISPERSAL_TIME;
  private cycleCenter: Vec3 = [0, 0, 1];
  private assemblyPoint: Vec3 | null = null;
  private superRoot = -1;
  /** Quantos supercontinentes se formaram, quantas rupturas e braços que falharam (medir e testar). */
  supercontinents = 0;
  ruptures = 0;
  failedArms: { a: number; b: number; drift: number }[] = [];
  /** Relógio da deriva (rad de giro a velocidade 1) e onde termina o estágio de cada placa. */
  private drift = 0;
  private stageEnd: Float64Array;
  /** Sorteios dos eventos da tectônica (estágios), separados dos da geração. */
  private rng: Rng;
  /** Liga a reorganização por estágios (os testes de movimento puro desligam). */
  readonly stagesEnabled: boolean;
  /** Quantas soldas e pedaços absorvidos já houve (para medir e testar). */
  welds = 0;
  /** Quantas suturas sumiram por falta de contato e quantas reorganizações de polo houve. */
  suturesDissolved = 0;
  reorganizations = 0;
  /** Quantas vezes algum grupo trocou de movimento (solda, polo novo, ruptura), para os testes. */
  motionChanges = 0;
  /** Maior sequência de recomposições seguidas em que um par colidiu sem soldar (para testar). */
  longestCollision = 0;
  private collisionRuns = new Map<number, number>();
  fragmentsAbsorbed = 0;
  /**
   * Polaridade da subducção entre duas placas oceânicas, decidida uma vez por par: qual das duas
   * mergulha. Antes era decidido célula a célula (mais velha; empate, mais funda), e como a crosta
   * inicial tem toda a mesma idade, cada célula da fronteira escolhia diferente e as placas se
   * "comiam" alternadamente, trocando de dono a cada recomposição (a oscilação).
   */
  private polarity = new Map<number, number>();
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

  constructor(world: WorldState, options: { relief?: boolean; stages?: boolean } = {}) {
    this.world = world;
    this.reliefEnabled = options.relief ?? true;
    this.stagesEnabled = options.stages ?? true;
    this.rng = createRng((world.params.seed ^ 0x6c8e9cf5) >>> 0);
    const n = world.cellCount;
    const plates = world.plates.length;
    this.angle = new Float64Array(plates);
    this.lastAngle = new Float64Array(plates);
    this.axis = new Float64Array(plates * 3);
    this.speed = new Float64Array(plates);
    this.center0 = new Float64Array(plates * 3);
    this.rot0 = new Float64Array(plates * 9);
    this.angle0 = new Float64Array(plates);
    this.group = new Int32Array(plates);
    this.stageEnd = new Float64Array(plates);
    for (let k = 0; k < plates; k++) {
      this.rot0[k * 9] = this.rot0[k * 9 + 4] = this.rot0[k * 9 + 8] = 1;
      this.group[k] = k;
      // O primeiro estágio é o da dispersão da Pangeia (eixos da geração), mais curto.
      this.stageEnd[k] = this.rng.range(DISPERSAL_STAGE_MIN, DISPERSAL_STAGE);
    }
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
    // O ciclo começa na dispersão da Pangeia, a partir do centro da crosta continental.
    {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let c = 0; c < n; c++) {
        if (world.crust[c] !== Crust.Continental) continue;
        x += world.grid.positions[c * 3] as number;
        y += world.grid.positions[c * 3 + 1] as number;
        z += world.grid.positions[c * 3 + 2] as number;
      }
      const l = Math.hypot(x, y, z);
      if (l > 1e-9) this.cycleCenter = [x / l, y / l, z / l];
    }
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
    this.drift += MAX_PLATE_RATE * rate;
    let maxMove = 0;
    for (let p = 0; p < plates; p++) {
      this.angle[p] = (this.angle[p] as number) + MAX_PLATE_RATE * rate * (this.speed[p] as number);
      maxMove = Math.max(maxMove, Math.abs((this.angle[p] as number) - (this.lastAngle[p] as number)));
    }
    if (maxMove < RECOMPOSE_CELLS * this.world.grid.cellAngle) return false;
    this.recompose();
    return true;
  }

  /** Matriz da posição atual da placa (referencial → mundo): giro desde a última troca de eixo × rot0. */
  private rotation(p: number, out: Float64Array, o = 0): void {
    const kx = this.axis[p * 3] as number;
    const ky = this.axis[p * 3 + 1] as number;
    const kz = this.axis[p * 3 + 2] as number;
    const a = (this.angle[p] as number) - (this.angle0[p] as number);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const t = 1 - c;
    // Rodrigues em forma de matriz.
    const r = [
      c + kx * kx * t, kx * ky * t - kz * s, kx * kz * t + ky * s,
      ky * kx * t + kz * s, c + ky * ky * t, ky * kz * t - kx * s,
      kz * kx * t - ky * s, kz * ky * t + kx * s, c + kz * kz * t,
    ];
    const m = this.rot0;
    const b = p * 9;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[o + i * 3 + j] =
          (r[i * 3] as number) * (m[b + j] as number) +
          (r[i * 3 + 1] as number) * (m[b + 3 + j] as number) +
          (r[i * 3 + 2] as number) * (m[b + 6 + j] as number);
      }
    }
  }

  /** Gira um ponto pela rotação inversa da placa (do mundo para o referencial dela). `inv`: matrizes já transpostas. */
  private toPlate(p: number, x: number, y: number, z: number, inv: Float64Array, out: Vec3): void {
    const b = p * 9;
    out[0] = (inv[b] as number) * x + (inv[b + 1] as number) * y + (inv[b + 2] as number) * z;
    out[1] = (inv[b + 3] as number) * x + (inv[b + 4] as number) * y + (inv[b + 5] as number) * z;
    out[2] = (inv[b + 6] as number) * x + (inv[b + 7] as number) * y + (inv[b + 8] as number) * z;
  }

  /** Centro atual da placa (o centro original girado). */
  private centerNow(p: number, out: Vec3): void {
    const m = new Float64Array(9);
    this.rotation(p, m);
    const x = this.center0[p * 3] as number;
    const y = this.center0[p * 3 + 1] as number;
    const z = this.center0[p * 3 + 2] as number;
    out[0] = (m[0] as number) * x + (m[1] as number) * y + (m[2] as number) * z;
    out[1] = (m[3] as number) * x + (m[4] as number) * y + (m[5] as number) * z;
    out[2] = (m[6] as number) * x + (m[7] as number) * y + (m[8] as number) * z;
  }

  /** Eixo (unitário) e velocidade relativa atuais de uma placa (mudam numa solda). */
  plateMotion(p: number): { axis: Vec3; speed: number } {
    return {
      axis: [this.axis[p * 3] as number, this.axis[p * 3 + 1] as number, this.axis[p * 3 + 2] as number],
      speed: this.speed[p] as number,
    };
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
    // Matriz inversa (transposta) da posição de cada placa: mundo → referencial dela.
    const inv = new Float64Array(plates * 9);
    const m = new Float64Array(9);
    let maxMove = 0;
    for (let p = 0; p < plates; p++) {
      this.rotation(p, m);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) inv[p * 9 + i * 3 + j] = m[j * 3 + i] as number;
      maxMove = Math.max(maxMove, Math.abs((this.angle[p] as number) - (this.lastAngle[p] as number)));
    }
    this.preparePolarity();

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
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, inv, q);
      return this.find(p, world.grid.pointToCell(q[0], q[1], q[2]));
    };
    const refOf = (p: number, c: number): number => {
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, inv, q);
      return world.grid.pointToCell(q[0], q[1], q[2]);
    };
    // Frente de colisão continental de cada par nesta recomposição: células onde houve consumo.
    const front = new Map<number, number[]>();
    const deepInside = (c: number, owner: number): boolean => {
      if (prevPlate[c] !== owner) return false;
      for (let d = 0; d < 4; d++) if (prevPlate[neighbors[c * 4 + d] as number] !== owner) return false;
      return true;
    };

    const gaps: number[] = [];
    const covering: number[] = [];
    // Crosta consumida nesta recomposição. Só morre no fim da composição e se não estiver aparecendo
    // em outra célula: duas células do mundo podem cair na mesma célula do referencial da placa, e
    // matar a amostra deixava a vizinha apontando para crosta morta (virava buraco na recomposição
    // seguinte, preenchido com a crosta da outra placa: continente "vazando" pela divisa).
    const doomed: number[] = [];
    // Células que mudaram de dona porque a dona de antes não tinha amostra ali (ver "dentes" abaixo).
    const switched: number[] = [];
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
        if ((this.sPlate[covering[0] as number] as number) !== prevPlate[c]) switched.push(c);
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
      // Histerese: se a vencedora está entrando numa célula de outra placa sem aproximação de
      // verdade (só arredondamento, ex.: falha transformante), a célula fica com a dona de antes.
      // Sem isso, a dona trocava toda vez que o arredondamento trocava (oscilação de 1 célula).
      const prevOwner = prevPlate[c] as number;
      if ((this.sPlate[win] as number) !== prevOwner && this.closing(prevOwner, this.sPlate[win] as number, x, y, z) <= 0) {
        for (const i of covering) if ((this.sPlate[i] as number) === prevOwner) win = i;
      }
      newSample[c] = win;
      for (const i of covering) {
        if (i === win) continue;
        const loser = this.sPlate[i] as number;
        const winner = this.sPlate[win] as number;
        if (loser === winner) continue;
        // Consumida se as placas se aproximam ali, ou se a crosta perdedora entrou fundo no território
        // que a vencedora já tinha (a célula e as 4 vizinhas eram dela): isso não é arredondamento.
        // Antes só valia o primeiro teste (direção entre os centros, grosseira na borda), e crosta
        // ficava escondida sob a outra placa, acumulando e reaparecendo depois como pedaços soltos.
        const closing = this.closing(loser, winner, x, y, z);
        if (closing <= 0 && !deepInside(c, winner)) continue;
        doomed.push(i);
        // Só aproximação de verdade é frente de colisão: o consumo por arredondamento (deepInside sem
        // aproximação) limpa a crosta escondida, mas não conta para a solda.
        if (
          closing > COLLISION_CLOSING_MIN &&
          this.sCrust[i] === Crust.Continental &&
          this.sCrust[win] === Crust.Continental &&
          this.find_(loser) !== this.find_(winner)
        ) {
          const key = pairKey(loser, winner);
          const cells = front.get(key);
          if (cells) cells.push(c);
          else front.set(key, [c]);
        }
      }
    }

    // "Dentes" de arredondamento: a célula foi para outra placa só porque, girando a grade, a busca da
    // dona de antes caiu numa célula do referencial fora da borda dela; na recomposição seguinte ela
    // voltava (oscilação de 1 célula na frente das placas). Se 3 das 4 vizinhas continuam da dona de
    // antes, é um dente: fica com ela, copiando a crosta da vizinha (e, se as placas se aproximam, a
    // crosta da outra ali é consumida). Com menos vizinhas (placa recuando) não: isso arrastaria tiras.
    for (const c of switched) {
      const owner = prevPlate[c] as number;
      let same = 0;
      let from = -1;
      for (let d = 0; d < 4; d++) {
        const s = newSample[neighbors[c * 4 + d] as number] as number;
        if (s >= 0 && this.sPlate[s] === owner) {
          same++;
          from = s;
        }
      }
      if (same < 2 || from < 0) continue;
      const intruder = newSample[c] as number;
      const x = positions[c * 3] as number;
      const y = positions[c * 3 + 1] as number;
      const z = positions[c * 3 + 2] as number;
      const converging = this.closing(this.sPlate[intruder] as number, owner, x, y, z) > 0;
      // Na frente de uma placa que avança por cima da outra (aproximando e ela vence a sobreposição),
      // 2 vizinhas bastam (degrau de borda diagonal à grade); fora disso, só dente de verdade (3).
      const front = converging && this.beats(from, intruder, owner);
      if (same < 3 && !front) continue;
      const ref = refOf(owner, c);
      let i = this.find(owner, ref);
      if (i < 0) i = this.addSample(owner, ref, this.sElev[from] as number, this.sCrust[from] as number, this.sBirth[from] as number);
      newSample[c] = i;
      if (converging) doomed.push(intruder);
    }
    if (doomed.length) {
      const shown = new Uint8Array(this.count);
      for (let c = 0; c < n; c++) if ((newSample[c] as number) >= 0) shown[newSample[c] as number] = 1;
      for (const i of doomed) if (!shown[i]) this.kill(i);
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
    const accreted = this.accrete(front, inv);
    // Repete até não sobrar pedaço pequeno: dois pedaços de placas diferentes encostados trocam de
    // dona ao mesmo tempo e isso podia deixar uma célula solta nova.
    for (let pass = 0; pass < 4 && this.absorbFragments(inv); pass++);
    for (const key of accreted) front.delete(key);
    // Suturas sem contato somem; grupos no fim do estágio ganham polo novo (antes das fronteiras,
    // que leem o movimento novo).
    const contact = this.continentalContacts(front);
    const sums = this.plateSums();
    this.updateSutures(contact, sums);
    if (this.stagesEnabled) {
      this.advanceCycle(sums);
      this.advanceStages(sums);
    }
    updateBoundaries(world);
    if (this.reliefEnabled) this.relief();
    // Depois do relevo: a recomposição que completa a colisão ainda ergue a cordilheira.
    if (this.weldCollisions(front, contact)) updateBoundaries(world);
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
        // Mesma regra da sobreposição: entre duas oceânicas, a polaridade do par decide quem mergulha.
        const subducts = cOcean && (!nOcean || this.subducts(world.plate[c] as number, world.plate[nb] as number));
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
    const pa = this.sPlate[a] as number;
    const pb = this.sPlate[b] as number;
    // Duas oceânicas de placas diferentes: a polaridade do par (a mesma ao longo de toda a fronteira).
    if (ca === Crust.Oceanic && pa !== pb) return this.subducts(pb, pa);
    return pa === prevOwner && pb !== prevOwner;
  }

  /** Grupo de solda da placa (a menor placa ligada a ela por suturas). */
  private find_(p: number): number {
    return this.group[p] as number;
  }

  /** Refaz os grupos a partir das suturas (componentes ligadas). */
  private rebuildGroups(): void {
    const plates = this.angle.length;
    const parent = Int32Array.from({ length: plates }, (_, k) => k);
    const root = (p: number): number => {
      while (parent[p] !== p) p = parent[p] as number;
      return p;
    };
    for (const key of this.sutures.keys()) {
      const ra = root(Math.floor(key / 256));
      const rb = root(key % 256);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
    for (let p = 0; p < plates; p++) this.group[p] = root(p);
  }

  /** Placas do grupo de `p`. */
  private members(p: number): number[] {
    const g = this.group[p];
    const out: number[] = [];
    for (let k = 0; k < this.angle.length; k++) if (this.group[k] === g) out.push(k);
    return out;
  }

  /**
   * Contato continental de cada par de placas: quantas células de crosta continental de uma têm
   * crosta continental da outra a até SUTURE_REACH células. Só para as placas em suturas ou numa
   * frente de colisão desta recomposição.
   */
  private continentalContacts(front: Map<number, number[]>): Map<number, number> {
    const world = this.world;
    const { neighbors } = world.grid;
    const n = world.cellCount;
    const involved = new Uint8Array(this.angle.length);
    for (const key of [...this.sutures.keys(), ...front.keys()]) {
      involved[Math.floor(key / 256)] = 1;
      involved[key % 256] = 1;
    }
    const contact = new Map<number, number>();
    if (!involved.some((v) => v)) return contact;
    // Só células a até SUTURE_REACH de uma fronteira de placa podem ter contato com outra placa.
    const near = new Uint8Array(n);
    let ring: number[] = [];
    for (let c = 0; c < n; c++) {
      const p = world.plate[c] as number;
      for (let d = 0; d < 4; d++) {
        if (world.plate[neighbors[c * 4 + d] as number] !== p) {
          near[c] = 1;
          ring.push(c);
          break;
        }
      }
    }
    for (let step = 1; step < SUTURE_REACH; step++) {
      const out: number[] = [];
      for (const c of ring) {
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (!near[k]) {
            near[k] = 1;
            out.push(k);
          }
        }
      }
      ring = out;
    }
    const stamp = new Int32Array(n).fill(-1);
    const seenPairs: number[] = [];
    let frontier: number[] = [];
    let next: number[] = [];
    for (let c = 0; c < n; c++) {
      const p = world.plate[c] as number;
      if (!near[c] || !involved[p] || world.crust[c] !== Crust.Continental) continue;
      seenPairs.length = 0;
      frontier.length = 0;
      frontier.push(c);
      stamp[c] = c;
      for (let step = 0; step < SUTURE_REACH; step++) {
        next.length = 0;
        for (const k of frontier) {
          for (let d = 0; d < 4; d++) {
            const nb = neighbors[k * 4 + d] as number;
            if (stamp[nb] === c) continue;
            stamp[nb] = c;
            next.push(nb);
            const q = world.plate[nb] as number;
            if (q !== p && world.crust[nb] === Crust.Continental && !seenPairs.includes(q)) seenPairs.push(q);
          }
        }
        [frontier, next] = [next, frontier];
      }
      for (const q of seenPairs) {
        const key = pairKey(p, q);
        contact.set(key, (contact.get(key) ?? 0) + 1);
      }
    }
    return contact;
  }

  /** Soma das posições (todas e só as continentais) e área continental de cada placa. */
  private plateSums(): { all: Float64Array; cont: Float64Array; contCells: Float64Array; totalCont: number } {
    const world = this.world;
    const { positions } = world.grid;
    const plates = this.angle.length;
    const all = new Float64Array(plates * 3);
    const cont = new Float64Array(plates * 3);
    const contCells = new Float64Array(plates);
    let totalCont = 0;
    for (let c = 0; c < world.cellCount; c++) {
      const p = world.plate[c] as number;
      const x = positions[c * 3] as number;
      const y = positions[c * 3 + 1] as number;
      const z = positions[c * 3 + 2] as number;
      all[p * 3] = (all[p * 3] as number) + x;
      all[p * 3 + 1] = (all[p * 3 + 1] as number) + y;
      all[p * 3 + 2] = (all[p * 3 + 2] as number) + z;
      if (world.crust[c] !== Crust.Continental) continue;
      cont[p * 3] = (cont[p * 3] as number) + x;
      cont[p * 3 + 1] = (cont[p * 3 + 1] as number) + y;
      cont[p * 3 + 2] = (cont[p * 3 + 2] as number) + z;
      contCells[p] = (contCells[p] as number) + 1;
      totalCont++;
    }
    return { all, cont, contCells, totalCont };
  }

  /**
   * Suturas: com contato, zera a contagem; sem contato por SUTURE_GRACE recomposições, a sutura
   * some. Se um grupo se divide, cada pedaço ganha polo novo (antes, as placas ficavam soldadas à
   * distância para sempre).
   */
  private updateSutures(contact: Map<number, number>, sums: ReturnType<Tectonics['plateSums']>): void {
    let changed = false;
    for (const [key, s] of this.sutures) {
      if ((contact.get(key) ?? 0) > 0) {
        s.miss = 0;
        continue;
      }
      s.miss++;
      if (s.miss >= SUTURE_GRACE) {
        this.sutures.delete(key);
        this.suturesDissolved++;
        changed = true;
      }
    }
    if (!changed) return;
    const before = Int32Array.from(this.group);
    this.rebuildGroups();
    const done = new Set<number>();
    for (let p = 0; p < this.angle.length; p++) {
      const g = this.group[p] as number;
      if (done.has(g)) continue;
      done.add(g);
      const members = this.members(p);
      // O grupo mudou se alguém do grupo antigo ficou de fora.
      const old = before[p] as number;
      let split = false;
      for (let k = 0; k < this.angle.length; k++) if (before[k] === old && this.group[k] !== g) split = true;
      if (split) this.reorganize(members, sums);
    }
  }

  /** Grupos cujo estágio acabou ganham polo de Euler novo, conforme a fase do ciclo. */
  private advanceStages(sums: ReturnType<Tectonics['plateSums']>): void {
    for (let p = 0; p < this.angle.length; p++) {
      if (this.group[p] !== p || this.drift < (this.stageEnd[p] as number)) continue;
      const members = this.members(p);
      this.reorganize(members, sums, this.planFor(members, sums));
    }
  }

  /** Plano de movimento de um grupo na fase atual do ciclo. */
  private planFor(members: number[], sums: ReturnType<Tectonics['plateSums']>): MotionPlan {
    const free: MotionPlan = { turnMax: STAGE_TURN_MAX, speedMin: STAGE_SPEED_MIN, speedMax: STAGE_SPEED_MAX };
    // Dispersão depois de uma ruptura: entre os rumos sorteados, o que menos empurra contra outros
    // continentes. A primeira dispersão (a da Pangeia) fica como no G1 até o G3 (riftes traçados).
    if (this.phase === 'dispersal') {
      return this.ruptures > 0 ? { ...free, avoid: this.outsideContacts(members), awayFrom: this.cycleCenter } : free;
    }
    if (this.phase === 'supercontinent' && members.includes(this.superRoot)) {
      return { turnMax: STAGE_TURN_MAX, speedMin: SUPERCONTINENT_SPEED_MIN, speedMax: SUPERCONTINENT_SPEED_MAX };
    }
    // Reunião (ou continentes que ainda não entraram no supercontinente): rumo ao ponto de reunião.
    let cont = 0;
    for (const p of members) cont += sums.contCells[p] as number;
    if (this.assemblyPoint && cont >= CONTINENT_SHARE * this.world.cellCount) {
      return { toward: this.assemblyPoint, turnMax: ASSEMBLY_TURN_MAX, speedMin: ASSEMBLY_SPEED_MIN, speedMax: STAGE_SPEED_MAX };
    }
    return free;
  }

  /** Divisas continentais do grupo com placas de fora dele (ponto, normal para fora, placa vizinha). */
  private outsideContacts(members: number[]): { p: Vec3; n: Vec3; plate: number }[] {
    const world = this.world;
    const { neighbors, positions } = world.grid;
    const inGroup = new Uint8Array(this.angle.length);
    for (const p of members) inGroup[p] = 1;
    const out: { p: Vec3; n: Vec3; plate: number }[] = [];
    for (let c = 0; c < world.cellCount; c++) {
      if (!inGroup[world.plate[c] as number] || world.crust[c] !== Crust.Continental) continue;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        const q = world.plate[k] as number;
        if (inGroup[q] || world.crust[k] !== Crust.Continental) continue;
        const px = positions[c * 3] as number;
        const py = positions[c * 3 + 1] as number;
        const pz = positions[c * 3 + 2] as number;
        const nx = (positions[k * 3] as number) - px;
        const ny = (positions[k * 3 + 1] as number) - py;
        const nz = (positions[k * 3 + 2] as number) - pz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        out.push({ p: [px, py, pz], n: [nx / nl, ny / nl, nz / nl], plate: q });
      }
    }
    return out;
  }

  /** Crosta continental de cada grupo (raiz → células) e o maior grupo. */
  private groupShares(sums: ReturnType<Tectonics['plateSums']>): { byRoot: Map<number, number>; best: number; bestCells: number } {
    const byRoot = new Map<number, number>();
    for (let p = 0; p < this.angle.length; p++) {
      const r = this.group[p] as number;
      byRoot.set(r, (byRoot.get(r) ?? 0) + (sums.contCells[p] as number));
    }
    let best = -1;
    let bestCells = 0;
    for (const [r, c] of byRoot) {
      if (c > bestCells) {
        best = r;
        bestCells = c;
      }
    }
    return { byRoot, best, bestCells };
  }

  /** Centro (unitário) da crosta continental de um conjunto de placas, ou null. */
  private continentalCenter(members: number[], sums: ReturnType<Tectonics['plateSums']>): Vec3 | null {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of members) {
      x += sums.cont[p * 3] as number;
      y += sums.cont[p * 3 + 1] as number;
      z += sums.cont[p * 3 + 2] as number;
    }
    const l = Math.hypot(x, y, z);
    return l > 1e-9 ? [x / l, y / l, z / l] : null;
  }

  /** Placas do grupo com continente de verdade (≥ CONTINENT_SHARE do planeta). */
  private continentalMembers(members: number[], sums: ReturnType<Tectonics['plateSums']>): number {
    let k = 0;
    for (const p of members) if ((sums.contCells[p] as number) >= CONTINENT_SHARE * this.world.cellCount) k++;
    return k;
  }

  /**
   * Ciclo de Wilson (G2): dispersão → reunião (continentes rumo a um ponto de reunião) →
   * supercontinente (≥ SUPERCONTINENT_SHARE do continente num grupo) → mandato → ruptura → dispersão.
   */
  private advanceCycle(sums: ReturnType<Tectonics['plateSums']>): void {
    const total = sums.totalCont;
    if (!total) return;
    const { byRoot, best, bestCells } = this.groupShares(sums);
    const frac = bestCells / total;
    if (this.phase !== 'supercontinent') {
      const members = best >= 0 ? this.members(best) : [];
      // Supercontinente formado (na reunião ou já na dispersão, quando os pedaços batem em vizinhos):
      // o mandato começa na hora.
      if (frac >= SUPERCONTINENT_SHARE && this.continentalMembers(members, sums) >= 2) {
        this.phase = 'supercontinent';
        this.superRoot = best;
        this.phaseEnd = this.drift + TENURE * this.rng.range(TENURE_JITTER_MIN, TENURE_JITTER_MAX);
        this.cycleCenter = this.continentalCenter(members, sums) ?? this.cycleCenter;
        this.supercontinents++;
        // O supercontinente quase para (o resto continua vindo para ele).
        this.reorganize(members, sums, this.planFor(members, sums));
        return;
      }
      if (this.phase === 'dispersal') {
        if (this.drift >= this.phaseEnd) this.startAssembly(sums);
        return;
      }
      if (this.drift < this.phaseEnd) return;
      // Regra secundária: sem supercontinente a tempo, um bloco grande racha mesmo assim; senão,
      // nova reunião em volta de onde a terra está.
      if (frac >= BIG_BLOCK_SHARE && this.continentalMembers(members, sums) >= 2 && this.rupture(members, sums)) return;
      const all: number[] = [];
      for (let p = 0; p < this.angle.length; p++) all.push(p);
      this.cycleCenter = this.continentalCenter(all, sums) ?? this.cycleCenter;
      this.startAssembly(sums);
      return;
    }
    // Supercontinente: se perdeu a maior parte (sutura que sumiu), volta à reunião; no fim do
    // mandato, racha.
    const root = this.group[this.superRoot] as number;
    if ((byRoot.get(root) ?? 0) / total < SUPERCONTINENT_SHARE * 0.75) {
      this.phase = 'assembly';
      this.phaseEnd = this.drift + ASSEMBLY_MAX;
      return;
    }
    if (this.drift >= this.phaseEnd && !this.rupture(this.members(root), sums)) {
      // Não achou como rachar (grupo sem suturas que dividam): tenta de novo no próximo estágio.
      this.phaseEnd = this.drift + TENURE * 0.25;
    }
  }

  /** Começa a reunião: sorteia o ponto de reunião perto do centro do último supercontinente. */
  private startAssembly(sums: ReturnType<Tectonics['plateSums']>): void {
    const c = this.cycleCenter;
    const latC = Math.abs(Math.asin(Math.max(-1, Math.min(1, c[1]))));
    // Base tangente em c.
    const ref: Vec3 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1x = ref[1] * c[2] - ref[2] * c[1];
    const e1y = ref[2] * c[0] - ref[0] * c[2];
    const e1z = ref[0] * c[1] - ref[1] * c[0];
    const l1 = Math.hypot(e1x, e1y, e1z);
    const e1: Vec3 = [e1x / l1, e1y / l1, e1z / l1];
    const e2: Vec3 = [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]];
    let point: Vec3 = c;
    let bestLat = Infinity;
    for (let k = 0; k < STAGE_DRAWS; k++) {
      const b = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(ASSEMBLY_DISTANCE_MIN, ASSEMBLY_DISTANCE_MAX);
      const t: Vec3 = [
        e1[0] * Math.cos(b) + e2[0] * Math.sin(b),
        e1[1] * Math.cos(b) + e2[1] * Math.sin(b),
        e1[2] * Math.cos(b) + e2[2] * Math.sin(b),
      ];
      const q: Vec3 = [c[0] * Math.cos(d) + t[0] * Math.sin(d), c[1] * Math.cos(d) + t[1] * Math.sin(d), c[2] * Math.cos(d) + t[2] * Math.sin(d)];
      const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, q[1]))));
      if (lat < bestLat) {
        bestLat = lat;
        point = q;
      }
      if (lat <= ASSEMBLY_LAT_MAX || lat <= latC) {
        point = q;
        break;
      }
    }
    this.assemblyPoint = point;
    this.phase = 'assembly';
    this.phaseEnd = this.drift + ASSEMBLY_MAX;
    // Todos os grupos continentais miram o ponto de reunião já.
    const done = new Set<number>();
    for (let p = 0; p < this.angle.length; p++) {
      const g = this.group[p] as number;
      if (done.has(g)) continue;
      done.add(g);
      const members = this.members(p);
      const plan = this.planFor(members, sums);
      if (plan.toward) this.reorganize(members, sums, plan);
    }
  }

  /**
   * Ruptura (G2) de um grupo soldado pelas suturas: escolhe o corte de 1 a 3 suturas que divide o
   * grupo em 2 ou 3 pedaços com pelo menos RUPTURE_MIN_PIECE do continente cada, preferindo as suturas
   * mais antigas e os pedaços equilibrados. Em 3 pedaços (junção tríplice), um braço pode falhar.
   * Cada pedaço ganha polo novo para longe da fenda. Retorna se rachou.
   */
  private rupture(members: number[], sums: ReturnType<Tectonics['plateSums']>, forced = false): boolean {
    const set = new Set(members);
    const edges: { key: number; a: number; b: number; age: number }[] = [];
    for (const [key, s] of this.sutures) {
      const a = Math.floor(key / 256);
      const b = key % 256;
      if (set.has(a) && set.has(b)) edges.push({ key, a, b, age: this.drift - s.bornDrift });
    }
    if (!edges.length) return false;
    const groupCont = members.reduce((acc, p) => acc + (sums.contCells[p] as number), 0) || 1;
    const maxAge = Math.max(...edges.map((e) => e.age)) || 1;
    // Componentes do grupo sem as suturas cortadas.
    const pieces = (cut: Set<number>): number[][] => {
      const parent = new Map<number, number>(members.map((p) => [p, p]));
      const root = (p: number): number => {
        while (parent.get(p) !== p) p = parent.get(p) as number;
        return p;
      };
      for (const e of edges) {
        if (cut.has(e.key)) continue;
        const ra = root(e.a);
        const rb = root(e.b);
        if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
      }
      const byRoot = new Map<number, number[]>();
      for (const p of members) {
        const r = root(p);
        const list = byRoot.get(r);
        if (list) list.push(p);
        else byRoot.set(r, [p]);
      }
      return [...byRoot.values()];
    };
    const tryCuts = (minPiece: number, maxPiece = 1): { cut: typeof edges; parts: number[][] } | null => {
      let best: { cut: typeof edges; parts: number[][]; score: number } | null = null;
      const consider = (cut: typeof edges) => {
        const parts = pieces(new Set(cut.map((e) => e.key)));
        if (parts.length < 2 || parts.length > 3) return;
        // Corte mínimo: toda sutura cortada separa dois pedaços diferentes.
        const pieceOf = new Map<number, number>();
        parts.forEach((list, i) => list.forEach((p) => pieceOf.set(p, i)));
        if (cut.some((e) => pieceOf.get(e.a) === pieceOf.get(e.b))) return;
        const shares = parts.map((list) => list.reduce((acc, p) => acc + (sums.contCells[p] as number), 0) / groupCont);
        const smallest = Math.min(...shares);
        if (smallest < minPiece || Math.max(...shares) >= maxPiece) return;
        const age = cut.reduce((acc, e) => acc + e.age, 0) / cut.length / maxAge;
        const score = 0.5 * age + 0.5 * (smallest * parts.length);
        if (!best || score > best.score) best = { cut, parts, score };
      };
      edges.forEach((ei, i) => {
        consider([ei]);
        edges.forEach((ej, j) => {
          if (j <= i) return;
          consider([ei, ej]);
          if (edges.length > 12) return;
          edges.forEach((ek, k) => {
            if (k > j) consider([ei, ej, ek]);
          });
        });
      });
      return best;
    };
    // De preferência nenhum pedaço continua sendo um supercontinente (senão o mandato recomeçaria já).
    const choice =
      tryCuts(RUPTURE_MIN_PIECE, SUPERCONTINENT_SHARE) ??
      tryCuts(RUPTURE_MIN_PIECE / 2, SUPERCONTINENT_SHARE) ??
      tryCuts(RUPTURE_MIN_PIECE) ??
      tryCuts(RUPTURE_MIN_PIECE / 2) ??
      (forced ? tryCuts(0) : null);
    if (!choice) return false;
    let { cut, parts } = choice;
    // Junção tríplice: um dos braços pode falhar (a sutura fica; o vale interior é o G3).
    if (parts.length === 3 && this.rng.next() < FAILED_ARM_CHANCE) {
      const kept = cut[Math.floor(this.rng.next() * cut.length)] as (typeof cut)[number];
      cut = cut.filter((e) => e !== kept);
      this.failedArms.push({ a: kept.a, b: kept.b, drift: this.drift });
      parts = pieces(new Set(cut.map((e) => e.key)));
    }
    for (const e of cut) {
      this.sutures.delete(e.key);
      this.collisions.delete(e.key);
    }
    this.rebuildGroups();
    // Polo que abre a fenda de cada pedaço. Na divisa com os outros pedaços (célula p, normal n
    // apontando para fora), a velocidade normal é ω·(p × n): o polo oposto à soma de p × n afasta a
    // divisa inteira, mesmo numa fenda curva (antes: "para longe do centro da fenda", e uma parte da
    // fenda fechava e soldava de novo).
    const world = this.world;
    const { neighbors, positions } = world.grid;
    const pieceOf = new Int32Array(this.angle.length).fill(-1);
    parts.forEach((list, i) => list.forEach((p) => (pieceOf[p] = i)));
    // Só a fenda continental (onde o bloco racha) entra no polo; a divisa oceânica do outro lado
    // de uma placa que envolve outra não pode abrir inteira (lá vira subducção). Sem fenda
    // continental, usa a divisa toda.
    const m = parts.map(() => [0, 0, 0] as Vec3);
    const mAll = parts.map(() => [0, 0, 0] as Vec3);
    const avoid = parts.map(() => [] as { p: Vec3; n: Vec3; plate: number }[]);
    for (let c = 0; c < world.cellCount; c++) {
      const i = pieceOf[world.plate[c] as number] as number;
      if (i < 0) continue;
      const px = positions[c * 3] as number;
      const py = positions[c * 3 + 1] as number;
      const pz = positions[c * 3 + 2] as number;
      for (let d = 0; d < 4; d++) {
        const k = neighbors[c * 4 + d] as number;
        const q = world.plate[k] as number;
        const j = pieceOf[q] as number;
        if (j === i) continue;
        const nx = (positions[k * 3] as number) - px;
        const ny = (positions[k * 3 + 1] as number) - py;
        const nz = (positions[k * 3 + 2] as number) - pz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        if (j < 0) {
          // Divisa continental com uma placa de fora do grupo: não empurrar contra ela.
          if (world.crust[c] === Crust.Continental && world.crust[k] === Crust.Continental) {
            (avoid[i] as { p: Vec3; n: Vec3; plate: number }[]).push({ p: [px, py, pz], n: [nx / nl, ny / nl, nz / nl], plate: q });
          }
          continue;
        }
        const both = world.crust[c] === Crust.Continental && world.crust[k] === Crust.Continental;
        for (const v of both ? [m[i] as Vec3, mAll[i] as Vec3] : [mAll[i] as Vec3]) {
          v[0] += (py * nz - pz * ny) / nl;
          v[1] += (pz * nx - px * nz) / nl;
          v[2] += (px * ny - py * nx) / nl;
        }
      }
    }
    parts.forEach((list, i) => {
      const v = Math.hypot(...(m[i] as Vec3)) > 1e-9 ? (m[i] as Vec3) : (mAll[i] as Vec3);
      const l = Math.hypot(...v);
      const plan: MotionPlan = { turnMax: RIFT_TURN_MAX, speedMin: RIFT_SPEED_MIN, speedMax: RIFT_SPEED_MAX, avoid: avoid[i] ?? [] };
      if (l > 1e-9) plan.pole = [-v[0] / l, -v[1] / l, -v[2] / l];
      this.reorganize(list, sums, plan);
    });
    this.cycleCenter = this.continentalCenter(members, sums) ?? this.cycleCenter;
    this.phase = 'dispersal';
    this.phaseEnd = this.drift + DISPERSAL_TIME;
    this.assemblyPoint = null;
    this.superRoot = -1;
    this.ruptures++;
    // Os outros continentes também param de vir para a reunião: rumo novo, para longe do
    // supercontinente antigo (senão um pedaço batia num bloco que ainda vinha e tudo se soldava de novo).
    const ruptured = new Set(members);
    const done = new Set<number>();
    for (let p = 0; p < this.angle.length; p++) {
      const g = this.group[p] as number;
      if (ruptured.has(p) || done.has(g)) continue;
      done.add(g);
      const others = this.members(p);
      if (others.some((q) => ruptured.has(q)) || this.continentalMembers(others, sums) === 0) continue;
      this.reorganize(others, sums, this.planFor(others, sums));
    }
    return true;
  }

  /**
   * Racha agora o maior grupo soldado (só para o "Medir desempenho", que mede o caminho da ruptura).
   * Se ainda não há grupo soldado, solda antes as duas placas continentais com mais contato, como
   * numa colisão. Retorna se rachou.
   */
  forceRupture(): boolean {
    let sums = this.plateSums();
    // O maior grupo com 2 placas ou mais.
    let best = -1;
    let bestCells = 0;
    for (const [root, cells] of this.groupShares(sums).byRoot) {
      if (this.members(root).length >= 2 && cells > bestCells) {
        best = root;
        bestCells = cells;
      }
    }
    if (best < 0) {
      const contact = new Map<number, number>();
      const { neighbors } = this.world.grid;
      for (let c = 0; c < this.world.cellCount; c++) {
        if (this.world.crust[c] !== Crust.Continental) continue;
        const a = this.world.plate[c] as number;
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          const b = this.world.plate[k] as number;
          if (b !== a && this.world.crust[k] === Crust.Continental) contact.set(pairKey(a, b), (contact.get(pairKey(a, b)) ?? 0) + 1);
        }
      }
      let key = -1;
      let most = 0;
      for (const [k, v] of contact) {
        if (v > most) {
          most = v;
          key = k;
        }
      }
      if (key < 0) return false;
      this.weld(Math.floor(key / 256), key % 256);
      sums = this.plateSums();
      best = this.group[Math.floor(key / 256)] as number;
    }
    const ok = this.rupture(this.members(best), sums, true);
    if (ok) updateBoundaries(this.world);
    return ok;
  }

  /** Estado do ciclo de Wilson (para o painel e os testes). */
  get cycle(): { phase: CyclePhase; supercontinents: number; ruptures: number; failedArms: number } {
    return { phase: this.phase, supercontinents: this.supercontinents, ruptures: this.ruptures, failedArms: this.failedArms.length };
  }

  /**
   * Polo de Euler novo para um grupo (G1): o rumo do centro do grupo vira até ±STAGE_TURN_MAX, a
   * velocidade é sorteada de novo (menor com muito continente) e o estágio recomeça. Rumo que levaria
   * o centro além de POLAR_GUARD, chegando mais perto do polo, é sorteado de novo.
   */
  private reorganize(
    members: number[],
    sums: ReturnType<Tectonics['plateSums']>,
    plan: MotionPlan = { turnMax: STAGE_TURN_MAX, speedMin: STAGE_SPEED_MIN, speedMax: STAGE_SPEED_MAX },
  ): void {
    if (!members.length) return;
    const rng = this.rng;
    let contCells = 0;
    for (const p of members) contCells += sums.contCells[p] as number;
    const src = contCells > 0 ? sums.cont : sums.all;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (const p of members) {
      gx += src[p * 3] as number;
      gy += src[p * 3 + 1] as number;
      gz += src[p * 3 + 2] as number;
    }
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-9) return;
    const g: Vec3 = [gx / gl, gy / gl, gz / gl];
    // Rumo atual do centro: ω × g (ou um rumo qualquer, se o grupo está parado).
    const p0 = members[0] as number;
    const s0 = this.speed[p0] as number;
    const wx = (this.axis[p0 * 3] as number) * s0;
    const wy = (this.axis[p0 * 3 + 1] as number) * s0;
    const wz = (this.axis[p0 * 3 + 2] as number) * s0;
    let dir: Vec3 = [wy * g[2] - wz * g[1], wz * g[0] - wx * g[2], wx * g[1] - wy * g[0]];
    // Rumo de base pelo plano: para o ponto de reunião.
    let near = false;
    const target = plan.toward;
    if (target) {
      const k = target[0] * g[0] + target[1] * g[1] + target[2] * g[2];
      const t: Vec3 = [target[0] - k * g[0], target[1] - k * g[1], target[2] - k * g[2]];
      if (Math.hypot(...t) > 1e-6) dir = t;
      // Já em cima do ponto de reunião: anda devagar (não passa direto).
      if (k > Math.cos(8 * DEG)) near = true;
    }
    if (Math.hypot(...dir) < 1e-6) {
      const z = rng.range(-1, 1);
      const t = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - z * z);
      const u: Vec3 = [r * Math.cos(t), r * Math.sin(t), z];
      dir = [g[1] * u[2] - g[2] * u[1], g[2] * u[0] - g[0] * u[2], g[0] * u[1] - g[1] * u[0]];
    }
    const dl = Math.hypot(...dir) || 1;
    dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const side: Vec3 = [g[1] * dir[2] - g[2] * dir[1], g[2] * dir[0] - g[0] * dir[2], g[0] * dir[1] - g[1] * dir[0]];
    const share = sums.totalCont > 0 ? contCells / sums.totalCont : 0;
    const slow = 1 - STAGE_CONTINENT_SLOWDOWN * Math.min(1, share / 0.5);
    const latNow = Math.abs(Math.asin(Math.max(-1, Math.min(1, g[1]))));
    let best: { axis: Vec3; speed: number; stage: number; lat: number } | null = null;
    // Ruptura: avalia todos os sorteios e fica com o que passa na guarda e menos aperta os vizinhos.
    let bestPenalty = Infinity;
    const penalty = (axis: Vec3, speed: number): number => {
      let sum = 0;
      for (const a of plan.avoid ?? []) {
        const q = a.plate;
        const s = this.speed[q] as number;
        const ox = axis[0] * speed - (this.axis[q * 3] as number) * s;
        const oy = axis[1] * speed - (this.axis[q * 3 + 1] as number) * s;
        const oz = axis[2] * speed - (this.axis[q * 3 + 2] as number) * s;
        // Velocidade normal: ω·(p × n).
        const v = ox * (a.p[1] * a.n[2] - a.p[2] * a.n[1]) + oy * (a.p[2] * a.n[0] - a.p[0] * a.n[2]) + oz * (a.p[0] * a.n[1] - a.p[1] * a.n[0]);
        if (v > 0) sum += v;
      }
      return sum;
    };
    const draws = plan.pole || plan.avoid ? STAGE_DRAWS * 2 : STAGE_DRAWS;
    for (let k = 0; k < draws; k++) {
      let axis: Vec3;
      if (plan.pole) {
        // Polo da fenda inclinado ao acaso (o primeiro sorteio é o polo puro).
        const pole = plan.pole;
        if (k === 0) axis = pole;
        else {
          const z = rng.range(-1, 1);
          const th = rng.range(0, Math.PI * 2);
          const r = Math.sqrt(1 - z * z);
          const j = Math.tan(plan.turnMax);
          const v: Vec3 = [pole[0] + j * r * Math.cos(th), pole[1] + j * r * Math.sin(th), pole[2] + j * z];
          const vl = Math.hypot(...v) || 1;
          axis = [v[0] / vl, v[1] / vl, v[2] / vl];
        }
      } else {
        const a = rng.range(-plan.turnMax, plan.turnMax);
        const d: Vec3 = [
          dir[0] * Math.cos(a) + side[0] * Math.sin(a),
          dir[1] * Math.cos(a) + side[1] * Math.sin(a),
          dir[2] * Math.cos(a) + side[2] * Math.sin(a),
        ];
        const ax: Vec3 = [g[1] * d[2] - g[2] * d[1], g[2] * d[0] - g[0] * d[2], g[0] * d[1] - g[1] * d[0]];
        const al = Math.hypot(...ax) || 1;
        axis = [ax[0] / al, ax[1] / al, ax[2] / al];
      }
      const speed = rng.range(plan.speedMin, plan.speedMax) * slow * (near ? 0.3 : 1);
      const stage = rng.range(STAGE_MIN, STAGE_MAX);
      // Maior latitude do centro ao longo do estágio (giro de speed × stage em torno do eixo novo).
      let lat = 0;
      for (let q = 1; q <= 4; q++) {
        const e = rotateAbout(g, axis, (speed * stage * q) / 4);
        lat = Math.max(lat, Math.abs(Math.asin(Math.max(-1, Math.min(1, e[1])))));
      }
      const guarded = lat <= POLAR_GUARD || lat <= latNow;
      if (plan.pole || plan.avoid) {
        // Abre a fenda (o polo inclinado ainda tem componente no polo da fenda), passa na guarda e
        // aperta os vizinhos o mínimo possível.
        const opens = !plan.pole || axis[0] * plan.pole[0] + axis[1] * plan.pole[1] + axis[2] * plan.pole[2] > 0;
        // Aproximar do supercontinente antigo: velocidade do centro (ω × g) na direção dele.
        let back = 0;
        if (plan.awayFrom) {
          const f = plan.awayFrom;
          const vx = axis[1] * g[2] - axis[2] * g[1];
          const vy = axis[2] * g[0] - axis[0] * g[2];
          const vz = axis[0] * g[1] - axis[1] * g[0];
          back = Math.max(0, speed * (vx * f[0] + vy * f[1] + vz * f[2])) * 1e3;
        }
        const pen = penalty(axis, speed) + back + (guarded ? 0 : 1e6) + (opens ? 0 : 1e9);
        if (pen < bestPenalty) {
          bestPenalty = pen;
          best = { axis, speed, stage, lat };
        }
        continue;
      }
      if (!best || lat < best.lat) best = { axis, speed, stage, lat };
      if (guarded) {
        best = { axis, speed, stage, lat };
        break;
      }
    }
    if (!best) return;
    this.setMotion(members, best.axis, best.speed);
    for (const p of members) this.stageEnd[p] = this.drift + best.stage;
    this.reorganizations++;
  }

  /** Congela a posição atual de cada placa em rot0 e passa a girar em torno do eixo novo. */
  private setMotion(members: number[], axis: Vec3, speed: number): void {
    this.motionChanges++;
    const m = new Float64Array(9);
    for (const p of members) {
      this.rotation(p, m);
      this.rot0.set(m, p * 9);
      this.angle0[p] = this.angle[p] as number;
      this.speed[p] = speed;
      this.axis[p * 3] = axis[0];
      this.axis[p * 3 + 1] = axis[1];
      this.axis[p * 3 + 2] = axis[2];
      const plate = this.world.plates[p];
      if (plate) plate.omega = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    }
  }

  /** Idade média e profundidade média do fundo oceânico de cada placa (para decidir a polaridade). */
  private plateOcean: { birth: Float64Array; depth: Float64Array } | null = null;

  private preparePolarity(): void {
    const plates = this.angle.length;
    const birth = new Float64Array(plates);
    const depth = new Float64Array(plates);
    const count = new Float64Array(plates);
    const world = this.world;
    for (let c = 0; c < world.cellCount; c++) {
      const i = this.cellSample[c] as number;
      if (i < 0 || this.sCrust[i] !== Crust.Oceanic) continue;
      const p = this.sPlate[i] as number;
      birth[p] = (birth[p] as number) + (this.sBirth[i] as number);
      depth[p] = (depth[p] as number) + (this.sElev[i] as number);
      count[p] = (count[p] as number) + 1;
    }
    for (let p = 0; p < plates; p++) {
      const k = (count[p] as number) || 1;
      birth[p] = (birth[p] as number) / k;
      depth[p] = (depth[p] as number) / k;
    }
    this.plateOcean = { birth, depth };
  }

  /**
   * A placa a mergulha sob a b (entre duas oceânicas)? Decidido no primeiro encontro do par e
   * guardado: a de fundo oceânico mais velho (mais denso) mergulha; empate, a mais funda; empate,
   * a de número menor. Assim toda a fronteira tem a mesma polaridade, sempre.
   */
  private subducts(a: number, b: number): boolean {
    if (a === b) return false;
    const key = pairKey(a, b);
    let sub = this.polarity.get(key);
    if (sub === undefined) {
      const po = this.plateOcean;
      const ba = po ? (po.birth[a] as number) : 0;
      const bb = po ? (po.birth[b] as number) : 0;
      const da = po ? (po.depth[a] as number) : 0;
      const db = po ? (po.depth[b] as number) : 0;
      sub = ba !== bb ? (ba < bb ? a : b) : da !== db ? (da < db ? a : b) : Math.min(a, b);
      this.polarity.set(key, sub);
    }
    return sub === a;
  }

  /**
   * Solda: o contador de colisão de cada par sobe a cada recomposição com frente e desce sem frente
   * (antes acumulava para sempre, e toques esporádicos ao longo de minutos soldavam placas que mal se
   * encostavam). Ao chegar em WELD_AFTER, com contato continental, nasce uma sutura e os dois grupos
   * passam a girar juntos (vetor de rotação médio, pesado pela área).
   */
  private weldCollisions(front: Map<number, number[]>, contact: Map<number, number>): boolean {
    const before = this.welds;
    // Sequências de colisão seguidas de cada par (só para medir).
    for (const key of [...this.collisionRuns.keys()]) if (!front.has(key)) this.collisionRuns.delete(key);
    for (const key of front.keys()) {
      const run = (this.collisionRuns.get(key) ?? 0) + 1;
      this.collisionRuns.set(key, run);
      this.longestCollision = Math.max(this.longestCollision, run);
    }
    for (const [key, k] of [...this.collisions]) {
      if (front.has(key)) continue;
      if (k <= 1) this.collisions.delete(key);
      else this.collisions.set(key, k - 1);
    }
    for (const key of front.keys()) {
      const a = Math.floor(key / 256);
      const b = key % 256;
      if (this.find_(a) === this.find_(b)) continue;
      const k = (this.collisions.get(key) ?? 0) + 1;
      this.collisions.set(key, k);
      if (k >= WELD_AFTER && (contact.get(key) ?? 0) > 0) this.weld(a, b);
    }
    return this.welds !== before;
  }

  private weld(a: number, b: number): void {
    const world = this.world;
    const key = pairKey(a, b);
    this.sutures.set(key, { born: this.tick, bornDrift: this.drift, miss: 0 });
    this.collisions.delete(key);
    this.rebuildGroups();
    const members = this.members(a);
    // Área de cada placa agora.
    const area = new Float64Array(this.angle.length);
    for (let c = 0; c < world.cellCount; c++) area[world.plate[c] as number] = (area[world.plate[c] as number] as number) + 1;
    const omega: Vec3 = [0, 0, 0];
    let total = 0;
    for (const p of members) {
      const w = area[p] as number;
      const s = this.speed[p] as number;
      omega[0] += (this.axis[p * 3] as number) * s * w;
      omega[1] += (this.axis[p * 3 + 1] as number) * s * w;
      omega[2] += (this.axis[p * 3 + 2] as number) * s * w;
      total += w;
    }
    if (total > 0) for (let d = 0; d < 3; d++) omega[d] = (omega[d] as number) / total;
    const speed = Math.hypot(omega[0], omega[1], omega[2]);
    const axis: Vec3 = speed > 0 ? [omega[0] / speed, omega[1] / speed, omega[2] / speed] : [0, 1, 0];
    this.setMotion(members, axis, speed);
    // Estágio novo para o grupo soldado (o polo novo vem no fim dele).
    const stage = this.rng.range(STAGE_MIN, STAGE_MAX);
    for (const p of members) this.stageEnd[p] = this.drift + stage;
    this.welds++;
  }

  /** Suturas atuais (par de placas e passo em que nasceram), para medir e testar. */
  sutureList(): { a: number; b: number; born: number }[] {
    return [...this.sutures].map(([key, s]) => ({ a: Math.floor(key / 256), b: key % 256, born: s.born }));
  }

  /** Grupo de solda de cada placa (a menor placa do grupo), para medir e testar. */
  groupOf(p: number): number {
    return this.find_(p);
  }

  /**
   * Pedaço solto de placa (componente que não é o principal, ou a placa inteira) menor que
   * FRAGMENT_SHARE do planeta passa para a placa vizinha com quem mais faz divisa: a crosta é
   * regravada no referencial da nova dona e passa a andar com ela.
   */
  private absorbFragments(inv: Float64Array): boolean {
    const world = this.world;
    const { neighbors } = world.grid;
    const n = world.cellCount;
    const limit = Math.max(4, Math.round(FRAGMENT_SHARE * n));
    const comp = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    const compPlate: number[] = [];
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if (comp[c] !== -1 || this.cellSample[c] === -1) continue;
      const id = sizes.length;
      const p = world.plate[c] as number;
      let size = 0;
      comp[c] = id;
      stack.push(c);
      while (stack.length) {
        const k = stack.pop() as number;
        size++;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (comp[nb] === -1 && world.plate[nb] === p && this.cellSample[nb] !== -1) {
            comp[nb] = id;
            stack.push(nb);
          }
        }
      }
      sizes.push(size);
      compPlate.push(p);
    }
    // Pequeno: pedaço solto ou a placa inteira já menor que o limite.
    const small = (id: number) => (sizes[id] as number) < limit;
    // Divisas de cada pedaço pequeno com outras placas.
    const contacts = new Map<number, Map<number, number>>();
    for (let c = 0; c < n; c++) {
      const id = comp[c] as number;
      if (id < 0 || !small(id)) continue;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d] as number;
        const q = world.plate[nb] as number;
        if (q === compPlate[id] || this.cellSample[nb] === -1) continue;
        let m = contacts.get(id);
        if (!m) contacts.set(id, (m = new Map()));
        m.set(q, (m.get(q) ?? 0) + 1);
      }
    }
    const target = new Map<number, number>();
    for (const [id, m] of contacts) {
      let best = -1;
      let bestCount = 0;
      for (const [q, k] of m) if (k > bestCount || (k === bestCount && q < best)) [best, bestCount] = [q, k];
      if (best >= 0) target.set(id, best);
    }
    if (!target.size) return false;
    for (let c = 0; c < n; c++) {
      const id = comp[c] as number;
      const to = id >= 0 ? target.get(id) : undefined;
      if (to !== undefined) this.transferCell(c, to, inv);
    }
    this.fragmentsAbsorbed += target.size;
    return true;
  }

  /** Passa a crosta da célula para a placa `to`: regravada no referencial dela, anda com ela. */
  private transferCell(c: number, to: number, inv: Float64Array): void {
    const world = this.world;
    const { positions } = world.grid;
    const q: Vec3 = [0, 0, 0];
    const old = this.cellSample[c] as number;
    this.toPlate(to, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, inv, q);
    const ref = world.grid.pointToCell(q[0], q[1], q[2]);
    // Se a nova dona já tem amostra ali (escondida sob o pedaço), ela recebe a crosta do pedaço.
    let i = this.find(to, ref);
    if (i >= 0) {
      this.sElev[i] = this.sElev[old] as number;
      this.sCrust[i] = this.sCrust[old] as number;
      this.sBirth[i] = this.sBirth[old] as number;
    } else {
      i = this.addSample(to, ref, this.sElev[old] as number, this.sCrust[old] as number, this.sBirth[old] as number);
    }
    this.kill(old);
    this.cellSample[c] = i;
    world.plate[c] = to;
  }

  /** Crosta continental de cada placa, em células. */
  private continentalArea(): Float64Array {
    const world = this.world;
    const area = new Float64Array(this.angle.length);
    for (let c = 0; c < world.cellCount; c++) {
      if (world.crust[c] === Crust.Continental) area[world.plate[c] as number] = (area[world.plate[c] as number] as number) + 1;
    }
    return area;
  }

  /**
   * Acreção: numa colisão continental em que uma das placas tem pouco continente (< CONTINENT_SHARE),
   * a crosta continental dela ligada à frente de colisão passa para a outra placa ("fragmento pequeno
   * gruda na placa maior"). O contato acaba ali: nem solda as placas, nem fica moendo para sempre.
   * Retorna os pares resolvidos assim.
   */
  private accrete(front: Map<number, number[]>, inv: Float64Array): number[] {
    if (!front.size) return [];
    const world = this.world;
    const { neighbors } = world.grid;
    const limit = CONTINENT_SHARE * world.cellCount;
    const area = this.continentalArea();
    const done: number[] = [];
    for (const [key, cells] of front) {
      const a = Math.floor(key / 256);
      const b = key % 256;
      if ((area[a] as number) >= limit && (area[b] as number) >= limit) continue;
      const small = (area[a] as number) <= (area[b] as number) ? a : b;
      const big = small === a ? b : a;
      // Continente da placa pequena encostado na frente (a célula da frente e as vizinhas).
      const seen = new Set<number>();
      const stack: number[] = [];
      for (const c of cells) {
        for (const k of [c, neighbors[c * 4] as number, neighbors[c * 4 + 1] as number, neighbors[c * 4 + 2] as number, neighbors[c * 4 + 3] as number]) {
          if (!seen.has(k) && world.plate[k] === small && world.crust[k] === Crust.Continental) {
            seen.add(k);
            stack.push(k);
          }
        }
      }
      while (stack.length) {
        const k = stack.pop() as number;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (!seen.has(nb) && world.plate[nb] === small && world.crust[nb] === Crust.Continental) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      for (const k of seen) if (this.cellSample[k] !== -1) this.transferCell(k, big, inv);
      area[big] = (area[big] as number) + seen.size;
      area[small] = (area[small] as number) - seen.size;
      if (seen.size) this.fragmentsAbsorbed++;
      done.push(key);
    }
    return done;
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
