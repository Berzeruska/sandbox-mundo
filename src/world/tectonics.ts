import type { Vec3 } from './cubesphere';
import { createRng, type Rng } from '../core/rng';
import { Noise3D } from './noise';
import { Boundary, CONTINENTAL_DEPTH, Crust, DISPERSAL_STAGE, DISPERSAL_STAGE_MIN, MAX_PLATE_IDS, plateColor, POLAR_GUARD, rotateAbout, updateBoundaries } from './plates';
import {
  FAILED_ARM_CHANCE,
  MICRO_SHARE_FLOOR,
  MICRO_SHARE_MAX,
  MICRO_SHARE_MIN,
  MICROCONTINENT_CHANCE,
  retraceBorders,
  sliverAlong,
  stepDistance,
  traceArm,
} from './rifts';
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
/**
 * Vale de rifte (correção 1): fenda entre dois continentes com menos desta largura (células) nasce
 * como terra afundada, não como fundo oceânico. Com esta largura ou mais, o meio vira dorsal.
 * A amostra do vale é continental com nascimento (`sBirth`) recente; a crosta continental antiga
 * nasce em ANCIENT.
 */
export const RIFT_VALLEY_WIDTH = 3;
/** O fundo do vale fica entre estes metros abaixo das bordas (varia por célula, sem sorteio). */
export const RIFT_DROP_MIN = 300;
export const RIFT_DROP_MAX = 800;
/**
 * Rifte que abre como zíper (G3): onde a fenda já virou mar, o mar avança por até tantas células por
 * recomposição ao longo do vale que ainda liga as duas margens, se as placas ali ainda se afastam.
 */
export const RIFT_UNZIP_CELLS = 3;

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
export { FAILED_ARM_CHANCE };
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
const COLLISION_MAX = 7000;
/**
 * G4: a crosta continental consumida numa colisão vira montanha na placa de cima. A "espessura" de cada
 * célula consumida é a altura dela acima desta base (m); ela é repartida em sino na faixa da frente.
 */
export const COLLISION_BASE = -3500;
/** Largura do sino (células) numa colisão de frente; numa oblíqua, até o dobro (mais baixa e larga). */
export const COLLISION_SIGMA = 4;
/** Alcance máximo do planalto a partir da frente (células): salvaguarda, a medida fica bem abaixo. */
const COLLISION_REACH_MAX = 40;
/**
 * Províncias de crosta (G4): rigidez fixa no referencial da placa, de 0 (faixa móvel, fraca) a 1
 * (cráton). Acima de CRATON_RIGID a crosta não engrossa: a cordilheira para na frente dela (escarpa).
 */
export const CRATON_RIGID = 0.7;
const PROVINCE_FREQ = 2.2;
/** Picos e passagens ao longo da frente: ruído preso à placa, escala de ~6 células. */
const STRIKE_CELLS = 6;
/**
 * Ombreira de rifte (G4): as bordas de uma fenda nova sobem até SHOULDER_MIN–SHOULDER_MAX m (sorteado
 * por trecho), de SHOULDER_RATE por recomposição, de SHOULDER_NEAR a SHOULDER_FAR células da fenda.
 * A faixa mais perto da fenda é a margem passiva (afunda): a ombreira vira escarpa costeira.
 */
export const SHOULDER_MIN = 600;
export const SHOULDER_MAX = 1600;
const SHOULDER_RATE = 150;
const SHOULDER_NEAR = 3;
const SHOULDER_FAR = 6;
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
/**
 * Erosão: acima desta altura (m) o relevo cede um pouco a cada recomposição. 0,5% e alisamento de 3%
 * (decisão do usuário no G4): com 3,5% e 25%, a cordilheira sumia ~1 min depois da colisão e quase
 * nada ficava acima de 4.000 m; agora uma cadeia velha baixa em ~8 min (20×, placas 100%).
 */
const EROSION_START = 2500;
const EROSION_RATE = 0.005;
/** Acima desta altura (m) o relevo suaviza com as vizinhas (cordilheiras viram faixas, não riscos). */
const SMOOTH_START = 1200;
const SMOOTH_RATE = 0.03;

/** Profundidade do fundo oceânico pela idade: dorsal rasa, afunda com a raiz da idade. */
/** Chave de um par de placas (sem ordem). */
function pairKey(a: number, b: number): number {
  return a < b ? a * 256 + b : b * 256 + a;
}

export function oceanDepthAt(age: number): number {
  return RIDGE_DEPTH - ABYSSAL_EXTRA * Math.sqrt(Math.min(1, Math.max(0, age) / AGE_FULL_TICKS));
}

/** Células por bloco na soma do fundo oceânico de cada placa (`preparePolarity`). */
const POLARITY_CHUNK = 4096;

export class Tectonics {
  readonly world: WorldState;
  /** Ângulo acumulado de cada placa (rad) e o ângulo na última recomposição. */
  angle: Float64Array;
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
  /** Áreas de trabalho de `rotation`, `centerNow` e `closing` (chamadas por célula: sem lixo). */
  private readonly rodrigues = new Float64Array(9);
  private readonly centerMatrix = new Float64Array(9);
  private readonly centerA = new Float64Array(3);
  private readonly centerB = new Float64Array(3);
  /** Arrays de trabalho do `recompose` (do tamanho do mundo), reaproveitados a cada recomposição. */
  private readonly scratchBand: Uint8Array;
  private readonly scratchPrevPlate: Uint8Array;
  private readonly scratchSample: Int32Array;
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
  /**
   * Ruído da margem passiva gravado no rifte (G3), 1–255; 0 = usar o ruído do referencial da placa.
   * Gravado na posição do mundo na hora em que o continente racha, então os dois lados da fenda (que
   * ali estavam encostados) afundam igual e o encaixe das costas não se apaga.
   */
  private sMargin: Uint8Array;
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
  readonly erosionEnabled: boolean;
  private rigidityOverride: ((plate: number, ref: number) => number) | null;
  /** Províncias de crosta (G4): ruído fixo no referencial das placas. */
  private provinceNoise: Noise3D;
  /** Crosta consumida nas frentes de colisão desta recomposição, à espera de virar montanha (G4). */
  private deposits = new Map<number, { plate: number; mass: number; normal: number; count: number }>();
  /** Espessura recebida das colisões e a que virou montanha (m × células), para medir e testar. */
  collisionMassIn = 0;
  collisionMassOut = 0;

  constructor(
    world: WorldState,
    options: {
      relief?: boolean;
      stages?: boolean;
      /** Erosão leve (os testes de massa da colisão desligam). */
      erosion?: boolean;
      /** Rigidez da crosta por placa e ponto do referencial (testes); senão, as províncias. */
      rigidity?: (plate: number, ref: number) => number;
    } = {},
  ) {
    this.world = world;
    this.reliefEnabled = options.relief ?? true;
    this.stagesEnabled = options.stages ?? true;
    this.erosionEnabled = options.erosion ?? true;
    this.rigidityOverride = options.rigidity ?? null;
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
    this.sMargin = new Uint8Array(cap);
    this.initialPlate = Uint8Array.from(world.plate);
    this.marginNoise = new Noise3D(createRng((world.params.seed ^ 0x2545f491) >>> 0));
    this.provinceNoise = new Noise3D(createRng((world.params.seed ^ 0x51ed270b) >>> 0));
    this.cellSample = new Int32Array(n);
    this.scratchBand = new Uint8Array(n);
    this.scratchPrevPlate = new Uint8Array(n);
    this.scratchSample = new Int32Array(n);
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
    // Braços que falharam na quebra da Pangeia (geração v3): o vale aparece quando as placas andam.
    for (const path of world.aulacogens) this.carveAulacogen(path);
  }

  /**
   * Aulacógeno (G3): ao longo do braço que falhou, o terreno afunda RIFT_DROP_MIN a RIFT_DROP_MAX numa
   * faixa de 1 a 2 células e vira vale de rifte (lago ou golfo estreito, conforme o nível do mar).
   */
  private carveAulacogen(path: readonly number[]): void {
    const { neighbors } = this.world.grid;
    const band = new Set<number>(path);
    // Um lado a mais em metade do caminho: a faixa tem 1 ou 2 células.
    path.forEach((c, k) => {
      if (Math.floor(k / 6) % 2 === 0) band.add(neighbors[c * 4 + (k % 4)] as number);
    });
    for (const c of band) {
      const i = this.cellSample[c] as number;
      if (i < 0 || this.sCrust[i] !== Crust.Continental) continue;
      const h = (Math.imul(c ^ 0x2c1b3c6d, 0x297a2d39) >>> 0) / 4294967296;
      this.sElev[i] = (this.sElev[i] as number) - (RIFT_DROP_MIN + (RIFT_DROP_MAX - RIFT_DROP_MIN) * h);
      this.sBirth[i] = this.tick;
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
    this.sMargin[i] = 0;
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
    const perSample = 1 + 4 + 4 + 1 + 4 + 1 + 1;
    return this.sPlate.length * perSample + this.cellSample.byteLength + this.initialPlate.byteLength + this.scratchBand.byteLength * 2 + this.scratchSample.byteLength + this.extra.size * 40;
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
    this.sMargin = g(this.sMargin, (k) => new Uint8Array(k));
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
      this.sMargin[w] = this.sMargin[i] as number;
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

  /** Deriva acumulada (soma do controle "Placas" × MAX_PLATE_RATE a cada passo): o tempo geológico. */
  get driftNow(): number {
    return this.drift;
  }

  /**
   * O próximo `step(rate)` vai recompor o mapa? Mesma conta do `step`, sem mudar nada. O ajudante da
   * geologia usa para não começar uma recomposição antes de a anterior ser aplicada (correção 2).
   */
  willRecompose(rate: number): boolean {
    if (rate <= 0) return false;
    const limit = RECOMPOSE_CELLS * this.world.grid.cellAngle;
    for (let p = 0; p < this.angle.length; p++) {
      const next = (this.angle[p] as number) + MAX_PLATE_RATE * rate * (this.speed[p] as number);
      if (Math.abs(next - (this.lastAngle[p] as number)) >= limit) return true;
    }
    return false;
  }

  /**
   * Pincelada vinda de outro ajudante (correção 2): a amostra da placa `plate` no ponto `ref` do
   * referencial dela passa a ter esta altura e crosta (o mesmo que `syncCells` faz por célula).
   * Amostra que já não existe (consumida, ou passada para outra placa) é ignorada.
   */
  syncSample(plate: number, ref: number, elevation: number, crust: number): void {
    const i = this.find(plate, ref);
    if (i < 0) return;
    this.sElev[i] = elevation;
    this.sCrust[i] = crust;
  }

  /** Ponto do referencial da placa mostrado em cada célula (-1 = nenhum), para `syncSample`. */
  writeCellRefs(out: Int32Array): void {
    for (let c = 0; c < this.world.cellCount; c++) {
      const i = this.cellSample[c] as number;
      out[c] = i >= 0 ? (this.sRef[i] as number) : -1;
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
    const r = this.rodrigues;
    r[0] = c + kx * kx * t;
    r[1] = kx * ky * t - kz * s;
    r[2] = kx * kz * t + ky * s;
    r[3] = ky * kx * t + kz * s;
    r[4] = c + ky * ky * t;
    r[5] = ky * kz * t - kx * s;
    r[6] = kz * kx * t - ky * s;
    r[7] = kz * ky * t + kx * s;
    r[8] = c + kz * kz * t;
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
  private centerNow(p: number, out: Vec3 | Float64Array): void {
    const m = this.centerMatrix;
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
  /** Velocidade relativa entre as placas a e b no ponto (módulo). */
  private relativeSpeed(a: number, b: number, c: number): number {
    const { positions } = this.world.grid;
    const x = positions[c * 3] as number;
    const y = positions[c * 3 + 1] as number;
    const z = positions[c * 3 + 2] as number;
    const sa = this.speed[a] as number;
    const sb = this.speed[b] as number;
    const wx = (this.axis[a * 3] as number) * sa - (this.axis[b * 3] as number) * sb;
    const wy = (this.axis[a * 3 + 1] as number) * sa - (this.axis[b * 3 + 1] as number) * sb;
    const wz = (this.axis[a * 3 + 2] as number) * sa - (this.axis[b * 3 + 2] as number) * sb;
    return Math.hypot(wy * z - wz * y, wz * x - wx * z, wx * y - wy * x);
  }

  /** No centro da célula `c`. Recebe a célula, não o ponto: sem números soltos na chamada (sem lixo). */
  private closing(a: number, b: number, c: number): number {
    const { positions } = this.world.grid;
    const x = positions[c * 3] as number;
    const y = positions[c * 3 + 1] as number;
    const z = positions[c * 3 + 2] as number;
    const ca = this.centerA;
    const cb = this.centerB;
    this.centerNow(a, ca);
    this.centerNow(b, cb);
    let dx = (cb[0] as number) - (ca[0] as number);
    let dy = (cb[1] as number) - (ca[1] as number);
    let dz = (cb[2] as number) - (ca[2] as number);
    const along = dx * x + dy * y + dz * z;
    dx -= along * x;
    dy -= along * y;
    dz -= along * z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const sa = this.speed[a] as number;
    const akx = (this.axis[a * 3] as number) * sa;
    const aky = (this.axis[a * 3 + 1] as number) * sa;
    const akz = (this.axis[a * 3 + 2] as number) * sa;
    const sb = this.speed[b] as number;
    const bkx = (this.axis[b * 3] as number) * sb;
    const bky = (this.axis[b * 3 + 1] as number) * sb;
    const bkz = (this.axis[b * 3 + 2] as number) * sb;
    const va0 = aky * z - akz * y;
    const va1 = akz * x - akx * z;
    const va2 = akx * y - aky * x;
    const vb0 = bky * z - bkz * y;
    const vb1 = bkz * x - bkx * z;
    const vb2 = bkx * y - bky * x;
    return ((va0 - vb0) * dx + (va1 - vb1) * dy + (va2 - vb2) * dz) / len;
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
    const band = this.scratchBand.fill(0);
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

    const prevPlate = this.scratchPrevPlate;
    prevPlate.set(world.plate);
    const newSample = this.scratchSample.fill(-1);
    const q: Vec3 = [0, 0, 0];
    const pull = (p: number, c: number): number => {
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, inv, q);
      return this.find(p, world.grid.pointToCellOf(q));
    };
    const refOf = (p: number, c: number): number => {
      this.toPlate(p, positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number, inv, q);
      return world.grid.pointToCellOf(q);
    };
    // Frente de colisão continental de cada par nesta recomposição: células onde houve consumo.
    const front = new Map<number, number[]>();
    const deepInside = (c: number, owner: number): boolean => {
      if (prevPlate[c] !== owner) return false;
      for (let d = 0; d < 4; d++) if (prevPlate[neighbors[c * 4 + d] as number] !== owner) return false;
      return true;
    };

    const gaps: number[] = [];
    // Amostras que cobrem a célula (no máximo uma por placa). Array fixo: zerar uma lista a cada célula
    // fazia o motor jogar fora o espaço dela e criar outro (lixo para a limpeza de memória).
    const covering = new Int32Array(plates);
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
      let coverCount = 0;
      for (let p = 0; p < plates; p++) {
        const i = pull(p, c);
        if (i >= 0) covering[coverCount++] = i;
      }
      if (coverCount === 0) {
        gaps.push(c);
        continue;
      }
      if (coverCount === 1) {
        newSample[c] = covering[0] as number;
        if ((this.sPlate[covering[0] as number] as number) !== prevPlate[c]) switched.push(c);
        continue;
      }
      // Sobreposição: escolhe a vencedora; a perdedora só é consumida se for aproximação de verdade.
      let win = covering[0] as number;
      for (let k = 1; k < coverCount; k++) {
        const other = covering[k] as number;
        if (this.beats(other, win, prevPlate[c] as number)) win = other;
      }
      // Histerese: se a vencedora está entrando numa célula de outra placa sem aproximação de
      // verdade (só arredondamento, ex.: falha transformante), a célula fica com a dona de antes.
      // Sem isso, a dona trocava toda vez que o arredondamento trocava (oscilação de 1 célula).
      const prevOwner = prevPlate[c] as number;
      if ((this.sPlate[win] as number) !== prevOwner && this.closing(prevOwner, this.sPlate[win] as number, c) <= 0) {
        for (let k = 0; k < coverCount; k++) if ((this.sPlate[covering[k] as number] as number) === prevOwner) win = covering[k] as number;
      }
      newSample[c] = win;
      for (let k = 0; k < coverCount; k++) {
        const i = covering[k] as number;
        if (i === win) continue;
        const loser = this.sPlate[i] as number;
        const winner = this.sPlate[win] as number;
        if (loser === winner) continue;
        // Consumida se as placas se aproximam ali, ou se a crosta perdedora entrou fundo no território
        // que a vencedora já tinha (a célula e as 4 vizinhas eram dela): isso não é arredondamento.
        // Antes só valia o primeiro teste (direção entre os centros, grosseira na borda), e crosta
        // ficava escondida sob a outra placa, acumulando e reaparecendo depois como pedaços soltos.
        const closing = this.closing(loser, winner, c);
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
          // G4: a crosta que entra por baixo vira montanha na placa de cima (a que venceu).
          const mass = Math.max(0, (this.sElev[i] as number) - COLLISION_BASE);
          const rel = this.relativeSpeed(loser, winner, c);
          const normal = rel > 1e-12 ? Math.min(1, closing / rel) : 1;
          const d = this.deposits.get(c);
          if (d && d.plate === winner) {
            d.mass += mass;
            d.normal += normal;
            d.count++;
          } else this.deposits.set(c, { plate: winner, mass, normal, count: 1 });
          this.collisionMassIn += mass;
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
      const converging = this.closing(this.sPlate[intruder] as number, owner, c) > 0;
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

    // Buracos: dorsal (crosta oceânica nova) onde as placas se afastam, ou vale de rifte se a fenda entre
    // dois continentes ainda é estreita; senão, cicatriza copiando.
    // Processa de fora para dentro, para cada buraco ter um vizinho já resolvido.
    let pending = gaps;
    // Votos das placas vizinhas de cada buraco (array fixo, zerado por buraco: sem lixo).
    const ownerVotes = new Int32Array(plates);
    for (let guard = 0; pending.length && guard < 1000; guard++) {
      const still: number[] = [];
      for (const c of pending) {
        let fromSample = -1;
        let covered = 0;
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[c * 4 + d] as number;
          const s = newSample[nb] as number;
          if (s < 0) continue;
          covered++;
          if (covered === 1) ownerVotes.fill(0);
          ownerVotes[this.sPlate[s] as number] = (ownerVotes[this.sPlate[s] as number] as number) + 1;
          if (this.sPlate[s] === prevPlate[c] || fromSample < 0) fromSample = s;
        }
        if (covered === 0 || fromSample < 0) {
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
        const opening = other >= 0 && this.closing(owner, other, c) < 0;
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
        let i: number;
        if (opening || !isolatedHole) {
          // Fenda estreita entre dois continentes: vale de rifte; senão, dorsal como antes.
          const floor = this.riftFloor(c, owner, ref, newSample);
          i = Number.isNaN(floor)
            ? this.addSample(owner, ref, RIDGE_DEPTH, Crust.Oceanic, this.tick)
            : this.addSample(owner, ref, floor, Crust.Continental, this.tick);
        } else {
          i = this.addSample(owner, ref, this.sElev[fromSample] as number, this.sCrust[fromSample] as number, this.sBirth[fromSample] as number);
        }
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
    this.unzipRifts();
    if (this.reliefEnabled) this.relief();
    else this.deposits.clear();
    // Depois do relevo: a recomposição que completa a colisão ainda ergue a cordilheira.
    if (this.weldCollisions(front, contact)) updateBoundaries(world);
    this.recompositions++;
    this.compact();
  }

  /**
   * Rifte que abre como zíper (G3). Vale de rifte que ainda encosta na outra placa (a ponte entre as
   * duas margens), numa fronteira em que as placas se afastam, vira fundo oceânico novo quando o mar
   * da mesma fenda já chegou a ele: o oceano avança RIFT_UNZIP_CELLS células por recomposição pelo
   * eixo do vale. Rifte parado (fronteira que não afasta) fica vale em terra (aulacógeno, decisão do
   * usuário); as bordas do vale, que já não encostam na outra placa, também ficam.
   */
  private unzipRifts(): void {
    const world = this.world;
    const { neighbors } = world.grid;
    const n = world.cellCount;
    const youngOcean = (c: number): boolean => {
      const i = this.cellSample[c] as number;
      return i >= 0 && this.sCrust[i] === Crust.Oceanic && (this.sBirth[i] as number) > ANCIENT;
    };
    const bridge = (c: number): boolean => {
      const i = this.cellSample[c] as number;
      if (i < 0 || !this.isRiftValley(i) || world.boundary[c] !== Boundary.Divergent) return false;
      for (let d = 0; d < 4; d++) if (world.plate[neighbors[c * 4 + d] as number] !== world.plate[c]) return true;
      return false;
    };
    let frontier: number[] = [];
    const done = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      if (!bridge(c)) continue;
      for (let d = 0; d < 4; d++) {
        if (youngOcean(neighbors[c * 4 + d] as number)) {
          frontier.push(c);
          done[c] = 1;
          break;
        }
      }
    }
    for (let step = 0; step < RIFT_UNZIP_CELLS && frontier.length; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        const i = this.cellSample[c] as number;
        this.sCrust[i] = Crust.Oceanic;
        this.sElev[i] = RIDGE_DEPTH;
        this.sBirth[i] = this.tick;
        world.crust[c] = Crust.Oceanic;
        world.elevation[c] = RIDGE_DEPTH;
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (!done[k] && bridge(k)) {
            done[k] = 1;
            next.push(k);
          }
        }
      }
      frontier = next;
    }
  }

  /** Rigidez da crosta na célula (0 faixa móvel … 1 cráton), presa ao referencial da placa (G4). */
  private rigidity(c: number): number {
    const i = this.cellSample[c] as number;
    if (i < 0) return 0;
    const ref = this.sRef[i] as number;
    const plate = this.sPlate[i] as number;
    if (this.rigidityOverride) return this.rigidityOverride(plate, ref);
    const p = this.world.grid.positions;
    const v = this.provinceNoise.sample(
      (p[ref * 3] as number) * PROVINCE_FREQ + plate * 7.3,
      (p[ref * 3 + 1] as number) * PROVINCE_FREQ,
      (p[ref * 3 + 2] as number) * PROVINCE_FREQ,
    );
    // Crátons onde o ruído é alto (núcleos), faixas móveis no resto; transição suave.
    const t = Math.min(1, Math.max(0, (v - 0.05) / 0.4));
    return t * t * (3 - 2 * t);
  }

  /**
   * G4: a crosta consumida em cada célula de frente de colisão vira montanha na placa de cima.
   * - Sino em volta da frente, mais largo (e mais baixo) quanto mais oblíqua a colisão.
   * - Ao longo da frente, a parte de cada célula varia com um ruído preso à placa: picos e passagens.
   * - Crosta rígida (cráton) não engrossa nem deixa passar: a cordilheira para na frente dela (escarpa).
   * - Acima do teto, o excesso vai para a faixa seguinte, mais para dentro: a cordilheira vira planalto.
   */
  private collisionMountains(elev: Float32Array): void {
    if (!this.deposits.size) return;
    const world = this.world;
    const { neighbors, positions, cellAngle } = world.grid;
    const n = world.cellCount;
    const dist = new Int32Array(n).fill(-1);
    const strikeFreq = 1 / (STRIKE_CELLS * cellAngle);
    const strike = (c: number): number => {
      const i = this.cellSample[c] as number;
      const ref = i >= 0 ? (this.sRef[i] as number) : c;
      return 0.4 + 1.2 * (0.5 + 0.5 * this.marginNoise.sample((positions[ref * 3] as number) * strikeFreq + 57, (positions[ref * 3 + 1] as number) * strikeFreq, (positions[ref * 3 + 2] as number) * strikeFreq));
    };
    for (const [c0, dep] of [...this.deposits].sort((a, b) => a[0] - b[0])) {
      if (world.plate[c0] !== dep.plate || dep.mass <= 0) continue;
      const normal = dep.normal / dep.count;
      const sigma = COLLISION_SIGMA * (2 - normal);
      const reach = Math.ceil(2.5 * sigma);
      // Células da placa de cima em volta da frente, por distância (sem atravessar cráton nem oceano).
      const layers: number[][] = [[c0]];
      const touched: number[] = [c0];
      dist[c0] = 0;
      const open = (k: number) =>
        dist[k] === -1 && world.plate[k] === dep.plate && world.crust[k] === Crust.Continental && this.rigidity(k) < CRATON_RIGID;
      for (let d = 1; d <= COLLISION_REACH_MAX; d++) {
        const next: number[] = [];
        for (const c of layers[d - 1] as number[]) {
          for (let e = 0; e < 4; e++) {
            const k = neighbors[c * 4 + e] as number;
            if (!open(k)) continue;
            dist[k] = d;
            touched.push(k);
            next.push(k);
          }
        }
        if (!next.length) break;
        layers.push(next);
        if (d >= reach && layers.length > reach + 1) break;
      }
      // Sino nas camadas até o alcance; o que bater no teto passa para as camadas seguintes.
      let weights = 0;
      const share: number[][] = layers.map((layer, d) =>
        layer.map((c) => {
          if (d > reach) return 0;
          const w = Math.exp(-((d / sigma) ** 2)) * strike(c) * (1 - this.rigidity(c));
          weights += w;
          return w;
        }),
      );
      let left = dep.mass;
      if (weights > 0) {
        let overflow = 0;
        layers.forEach((layer, d) => {
          layer.forEach((c, k) => {
            const want = (dep.mass * (share[d]?.[k] ?? 0)) / weights;
            const e = elev[c] as number;
            const put = Math.max(0, Math.min(want, COLLISION_MAX - e));
            elev[c] = e + put;
            overflow += want - put;
            left -= want;
          });
        });
        left += overflow;
      }
      // Planalto: o excesso enche as camadas seguintes até o teto, da frente para dentro.
      for (let d = 0; d < layers.length && left > 1e-6; d++) {
        for (const c of layers[d] as number[]) {
          const e = elev[c] as number;
          const put = Math.max(0, Math.min(left, COLLISION_MAX - e));
          elev[c] = e + put;
          left -= put;
          if (left <= 1e-6) break;
        }
        // Acabaram as camadas: cresce mais uma (o planalto alarga).
        if (d === layers.length - 1 && left > 1e-6 && layers.length <= COLLISION_REACH_MAX) {
          const next: number[] = [];
          for (const c of layers[d] as number[]) {
            for (let e = 0; e < 4; e++) {
              const k = neighbors[c * 4 + e] as number;
              if (!open(k)) continue;
              dist[k] = d + 1;
              touched.push(k);
              next.push(k);
            }
          }
          if (next.length) layers.push(next);
        }
      }
      this.collisionMassOut += dep.mass - Math.max(0, left);
      for (const c of touched) dist[c] = -1;
    }
    this.deposits.clear();
  }

  /**
   * G4: ombreira de rifte. As bordas de uma fenda nova (vale de rifte ou fundo oceânico jovem) sobem de
   * SHOULDER_NEAR a SHOULDER_FAR células dela, até SHOULDER_MIN–SHOULDER_MAX m conforme o trecho. Mais
   * perto da fenda, a margem passiva afunda: quando a fenda vira mar, sobra uma escarpa costeira.
   */
  private riftShoulders(elev: Float32Array): void {
    const world = this.world;
    const { neighbors, positions, cellAngle } = world.grid;
    const n = world.cellCount;
    const dist = new Uint8Array(n).fill(255);
    let frontier: number[] = [];
    for (let c = 0; c < n; c++) {
      const i = this.cellSample[c] as number;
      if (i < 0 || (this.sBirth[i] as number) <= ANCIENT || this.tick - (this.sBirth[i] as number) >= MARGIN_AGE) continue;
      dist[c] = 0;
      frontier.push(c);
    }
    if (!frontier.length) return;
    const freq = 1 / (8 * cellAngle);
    for (let d = 1; d <= SHOULDER_FAR && frontier.length; d++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let e = 0; e < 4; e++) {
          const k = neighbors[c * 4 + e] as number;
          if (dist[k] !== 255 || world.crust[k] !== Crust.Continental) continue;
          dist[k] = d;
          next.push(k);
          // Só em terra (a ombreira não faz plataforma submersa virar terra).
          if (d < SHOULDER_NEAR || (elev[k] as number) <= world.seaLevel) continue;
          const i = this.cellSample[k] as number;
          const ref = i >= 0 ? (this.sRef[i] as number) : k;
          const v = 0.5 + 0.5 * this.marginNoise.sample((positions[ref * 3] as number) * freq - 13, (positions[ref * 3 + 1] as number) * freq, (positions[ref * 3 + 2] as number) * freq);
          const target = SHOULDER_MIN + (SHOULDER_MAX - SHOULDER_MIN) * Math.min(1, Math.max(0, v));
          const h = elev[k] as number;
          if (h < target) elev[k] = Math.min(target, h + SHOULDER_RATE);
        }
      }
      frontier = next;
    }
  }

  /** Amostra de vale de rifte: continental nascida durante o jogo (ver RIFT_VALLEY_WIDTH). */
  private isRiftValley(i: number): boolean {
    return this.sCrust[i] === Crust.Continental && (this.sBirth[i] as number) > ANCIENT;
  }

  /**
   * Altura do fundo do vale de rifte numa fenda `c`, ou NaN se ali deve nascer dorsal.
   * Procura, atravessando a fenda (células ainda sem crosta e vale já aberto), a borda continental
   * de uma placa e a de outra. Se as duas existem e a fenda inteira tem menos de RIFT_VALLEY_WIDTH
   * células, o fundo fica entre RIFT_DROP_MIN e RIFT_DROP_MAX abaixo da média das bordas.
   * Fundo oceânico no caminho (o rifte já virou mar) ou um dos lados oceânico: dorsal.
   */
  private riftFloor(c: number, owner: number, ref: number, newSample: Int32Array): number {
    const { neighbors } = this.world.grid;
    const seen = [c];
    let ring = [c];
    let plateA = -1;
    let distA = 0;
    let elevA = 0;
    let distB = 0;
    let elevB = 0;
    for (let dist = 1; dist < RIFT_VALLEY_WIDTH && !distB && ring.length; dist++) {
      const next: number[] = [];
      for (const k of ring) {
        for (let d = 0; d < 4; d++) {
          const nb = neighbors[k * 4 + d] as number;
          if (seen.includes(nb)) continue;
          seen.push(nb);
          const s = newSample[nb] as number;
          if (s < 0 || this.isRiftValley(s)) {
            next.push(nb);
            continue;
          }
          if (this.sCrust[s] !== Crust.Continental) continue;
          const p = this.sPlate[s] as number;
          if (plateA < 0) {
            plateA = p;
            distA = dist;
            elevA = this.sElev[s] as number;
          } else if (p !== plateA && !distB) {
            distB = dist;
            elevB = this.sElev[s] as number;
          }
        }
      }
      ring = next;
    }
    if (!distB || distA + distB - 1 >= RIFT_VALLEY_WIDTH) return NaN;
    // Variação por célula do referencial da placa: determinística e presa à crosta.
    const h = (Math.imul(ref ^ Math.imul(owner + 1, 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296;
    return (elevA + elevB) / 2 - (RIFT_DROP_MIN + (RIFT_DROP_MAX - RIFT_DROP_MIN) * h);
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
          // G4: a cordilheira de colisão vem da crosta consumida (collisionMountains), não daqui.
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
        const saved = i >= 0 ? (this.sMargin[i] as number) : 0;
        const v = saved ? (saved - 1) / 254 : 0.5 + 0.5 * this.marginNoise.sample(x * 14, y * 14, z * 14);
        const target = md === 0 ? -160 : md === 1 ? -60 : 40;
        const e = elev[c] as number;
        if (e > target) elev[c] = Math.max(target, e - MARGIN_RATE * (0.2 + 1.6 * v * v) * (1 - md / (MARGIN_REACH + 1)));
      }
    }

    // G4: crosta consumida vira cordilheira e planalto; bordas de fenda nova sobem (ombreira).
    this.collisionMountains(elev);
    this.riftShoulders(elev);

    // 4) Erosão leve: picos cedem e o relevo alto suaviza com as vizinhas.
    for (let c = 0; c < n && this.erosionEnabled; c++) {
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
    // Listas de tamanho fixo: zerar listas comuns a cada célula fazia o motor jogar fora o espaço
    // delas e criar outro (lixo para a limpeza de memória). A ordem dos pares é a mesma de antes.
    const seenPairs = new Int32Array(this.angle.length);
    let frontier = new Int32Array(n);
    let next = new Int32Array(n);
    for (let c = 0; c < n; c++) {
      const p = world.plate[c] as number;
      if (!near[c] || !involved[p] || world.crust[c] !== Crust.Continental) continue;
      let pairCount = 0;
      frontier[0] = c;
      let count = 1;
      stamp[c] = c;
      for (let step = 0; step < SUTURE_REACH; step++) {
        let nextCount = 0;
        for (let f = 0; f < count; f++) {
          const k = frontier[f] as number;
          for (let d = 0; d < 4; d++) {
            const nb = neighbors[k * 4 + d] as number;
            if (stamp[nb] === c) continue;
            stamp[nb] = c;
            next[nextCount++] = nb;
            const q = world.plate[nb] as number;
            if (q === p || world.crust[nb] !== Crust.Continental) continue;
            let seen = false;
            for (let k2 = 0; k2 < pairCount && !seen; k2++) seen = seenPairs[k2] === q;
            if (!seen) seenPairs[pairCount++] = q;
          }
        }
        const t = frontier;
        frontier = next;
        next = t;
        count = nextCount;
      }
      for (let k = 0; k < pairCount; k++) {
        const key = pairKey(p, seenPairs[k] as number);
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
    // continentes. A primeira dispersão (a da Pangeia) fica como no G1: medido no G3 em 20 sementes,
    // usar a mesma regra nela não melhorou o critério de formas (11 contra 12 de 20 aos 3 min).
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
    // G3: a fenda é traçada célula a célula (riftes traçados, junção tríplice, braço que falha,
    // microcontinente). Braço que falha mantém as suturas daquele par; braço novo pode criar placa.
    const traced = this.traceRupture(parts);
    if (traced.kept.length) {
      const pieceOf = new Map<number, number>();
      parts.forEach((list, i) => list.forEach((p) => pieceOf.set(p, i)));
      const keptPair = (a: number, b: number) =>
        traced.kept.some(([x, y]) => (pieceOf.get(a) === x && pieceOf.get(b) === y) || (pieceOf.get(a) === y && pieceOf.get(b) === x));
      cut = cut.filter((e) => !keptPair(e.a, e.b));
    }
    parts = traced.parts;
    // Placas novas (braço que cortou uma placa, microcontinente): somas refeitas.
    const after = traced.created ? this.plateSums() : sums;
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
      this.reorganize(list, after, plan);
    });
    // Braço novo: a placa nova anda com o pedaço de onde saiu, mais um giro que abre o braço em relação
    // a ele (polo oposto à soma de p × n na divisa dos dois). Com o polo próprio de cada pedaço, uma
    // junção de 3 pedaços não abria os 3 braços ao mesmo tempo.
    if (traced.arm) {
      const { id, from } = traced.arm;
      const host = from[0] as number;
      const fromSet = new Set(from);
      const v: Vec3 = [0, 0, 0];
      for (let c = 0; c < world.cellCount; c++) {
        if (world.plate[c] !== id) continue;
        const px = positions[c * 3] as number;
        const py = positions[c * 3 + 1] as number;
        const pz = positions[c * 3 + 2] as number;
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (!fromSet.has(world.plate[k] as number)) continue;
          const nx = (positions[k * 3] as number) - px;
          const ny = (positions[k * 3 + 1] as number) - py;
          const nz = (positions[k * 3 + 2] as number) - pz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          v[0] += (py * nz - pz * ny) / nl;
          v[1] += (pz * nx - px * nz) / nl;
          v[2] += (px * ny - py * nx) / nl;
        }
      }
      const vl = Math.hypot(...v);
      const open = this.rng.range(RIFT_SPEED_MIN, RIFT_SPEED_MAX) * 0.6;
      const hs = this.speed[host] as number;
      const w: Vec3 = [0, 1, 2].map((k) => (this.axis[host * 3 + k] as number) * hs - (vl > 1e-9 ? ((v[k] as number) / vl) * open : 0)) as Vec3;
      const speed = Math.hypot(...w);
      if (speed > 1e-9) this.setMotion([id], [w[0] / speed, w[1] / speed, w[2] / speed], speed);
      this.stageEnd[id] = this.stageEnd[host] as number;
    }
    // Microcontinente: anda com a média das duas placas da fenda (as duas se afastam dele).
    if (traced.micro) {
      const { id, a, b } = traced.micro;
      const w: Vec3 = [0, 1, 2].map((k) => ((this.axis[a * 3 + k] as number) * (this.speed[a] as number) + (this.axis[b * 3 + k] as number) * (this.speed[b] as number)) / 2) as Vec3;
      const speed = Math.hypot(...w);
      if (speed > 1e-9) this.setMotion([id], [w[0] / speed, w[1] / speed, w[2] / speed], speed);
      this.stageEnd[id] = this.drift + this.rng.range(STAGE_MIN, STAGE_MAX);
    }
    this.cycleCenter = this.continentalCenter(members, after) ?? this.cycleCenter;
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
      if (others.some((q) => ruptured.has(q)) || this.continentalMembers(others, after) === 0) continue;
      this.reorganize(others, after, this.planFor(others, after));
    }
    return true;
  }

  /** Matrizes inversas da posição de cada placa (mundo → referencial dela), para `transferCell`. */
  private inverses(): Float64Array {
    const plates = this.angle.length;
    const inv = new Float64Array(plates * 9);
    const m = new Float64Array(9);
    for (let p = 0; p < plates; p++) {
      this.rotation(p, m);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) inv[p * 9 + i * 3 + j] = m[j * 3 + i] as number;
    }
    return inv;
  }

  /** Aumenta os arrays por placa para `count` placas. */
  private growPlates(count: number): void {
    const grow = (a: Float64Array, per: number): Float64Array => {
      const b = new Float64Array(count * per);
      b.set(a);
      return b;
    };
    this.angle = grow(this.angle, 1);
    this.lastAngle = grow(this.lastAngle, 1);
    this.axis = grow(this.axis, 3);
    this.speed = grow(this.speed, 1);
    this.center0 = grow(this.center0, 3);
    this.rot0 = grow(this.rot0, 9);
    this.angle0 = grow(this.angle0, 1);
    this.stageEnd = grow(this.stageEnd, 1);
    const group = new Int32Array(count);
    group.set(this.group);
    this.group = group;
  }

  /**
   * Número para uma placa nova (G3: braço que corta uma placa, microcontinente): o de uma placa que
   * sumiu ou um novo, até MAX_PLATE_IDS (o desenho guarda a placa em 4 bits). -1 se não há.
   * O referencial da placa nova é o mundo agora; ela fica parada até ganhar polo.
   */
  private allocPlate(center: Vec3): number {
    const world = this.world;
    const cells = new Uint32Array(this.angle.length);
    for (let c = 0; c < world.cellCount; c++) cells[world.plate[c] as number] = (cells[world.plate[c] as number] as number) + 1;
    let id = -1;
    for (let p = 0; p < this.angle.length && id < 0; p++) if (!cells[p]) id = p;
    if (id < 0) {
      if (this.angle.length >= MAX_PLATE_IDS) return -1;
      id = this.angle.length;
      this.growPlates(id + 1);
    }
    // O que sobrou da placa antiga com este número (crosta escondida, suturas, colisões) some.
    for (let i = 0; i < this.count; i++) if (this.sAlive[i] && this.sPlate[i] === id) this.kill(i);
    const involves = (key: number) => Math.floor(key / 256) === id || key % 256 === id;
    for (const key of [...this.sutures.keys()]) if (involves(key)) this.sutures.delete(key);
    for (const key of [...this.collisions.keys()]) if (involves(key)) this.collisions.delete(key);
    for (const key of [...this.collisionRuns.keys()]) if (involves(key)) this.collisionRuns.delete(key);
    for (const key of [...this.polarity.keys()]) if (involves(key)) this.polarity.delete(key);
    this.rot0.set([1, 0, 0, 0, 1, 0, 0, 0, 1], id * 9);
    this.angle[id] = 0;
    this.lastAngle[id] = 0;
    this.angle0[id] = 0;
    this.axis.set([0, 1, 0], id * 3);
    this.speed[id] = 0;
    this.center0.set(center, id * 3);
    this.stageEnd[id] = this.drift + STAGE_MIN;
    world.plates[id] = { id, seed: center, center: [...center] as Vec3, omega: [0, 0, 0], continental: 1, color: plateColor(id) };
    this.rebuildGroups();
    return id;
  }

  /**
   * Passa as células para a placa `to` e, das placas de onde elas saíram, também o oceano que fica
   * mais perto delas que da terra que continua na placa (a placa nova não fica só com a terra).
   */
  private moveWithOcean(cells: readonly number[], to: number, inv: Float64Array): void {
    const world = this.world;
    const { neighbors } = world.grid;
    const n = world.cellCount;
    const from = new Set<number>();
    for (const c of cells) from.add(world.plate[c] as number);
    from.delete(to);
    const owner = new Int8Array(n).fill(-1);
    let frontier: number[] = [];
    for (const c of cells) {
      owner[c] = 1;
      frontier.push(c);
    }
    for (let c = 0; c < n; c++) {
      if (owner[c] === -1 && from.has(world.plate[c] as number) && world.crust[c] === Crust.Continental) {
        owner[c] = 0;
        frontier.push(c);
      }
    }
    while (frontier.length) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let d = 0; d < 4; d++) {
          const k = neighbors[c * 4 + d] as number;
          if (owner[k] !== -1 || !from.has(world.plate[k] as number)) continue;
          owner[k] = owner[c] as number;
          next.push(k);
        }
      }
      frontier = next;
    }
    for (let c = 0; c < n; c++) if (owner[c] === 1 && this.cellSample[c] !== -1 && world.plate[c] !== to) this.transferCell(c, to, inv);
  }

  /** Margem passiva igual dos dois lados (G3): grava o ruído na posição de agora, perto da fenda. */
  private markMargins(paths: readonly (readonly number[])[]): void {
    const world = this.world;
    const { positions } = world.grid;
    const sources: number[] = [];
    for (const path of paths) sources.push(...path);
    if (!sources.length) return;
    const all = new Uint8Array(world.cellCount).fill(1);
    const dist = stepDistance(world.grid, sources, all, MARGIN_REACH + 2);
    for (let c = 0; c < world.cellCount; c++) {
      if ((dist[c] as number) > MARGIN_REACH + 2) continue;
      const i = this.cellSample[c] as number;
      if (i < 0) continue;
      const v = 0.5 + 0.5 * this.marginNoise.sample((positions[c * 3] as number) * 14, (positions[c * 3 + 1] as number) * 14, (positions[c * 3 + 2] as number) * 14);
      this.sMargin[i] = 1 + Math.round(254 * Math.min(1, Math.max(0, v)));
    }
  }

  /**
   * Ruptura traçada (G3). Entra com os pedaços (conjuntos de placas) escolhidos pelas suturas e:
   * - retraça cada divisa continental entre pedaços como braço de rifte (serpenteia, degraus de falha
   *   transformante, braços que se encontram em junção tríplice); a terra de cada lado passa para o
   *   pedaço daquele lado;
   * - numa junção de 3 pedaços, com chance FAILED_ARM_CHANCE um braço falha (aulacógeno);
   * - com só 2 pedaços, sai um terceiro braço do meio da fenda para dentro do pedaço maior: com chance
   *   FAILED_ARM_CHANCE falha (aulacógeno); senão corta o pedaço e o lado menor vira placa nova;
   * - com chance MICROCONTINENT_CHANCE, uma lasca ao lado da fenda vira placa própria;
   * - grava o ruído da margem passiva dos dois lados da fenda.
   */
  private traceRupture(parts: number[][]): {
    parts: number[][];
    kept: [number, number][];
    micro: { id: number; a: number; b: number } | null;
    /** Braço novo que cortou um pedaço: a placa nova e as placas do pedaço de onde ela saiu. */
    arm: { id: number; from: number[] } | null;
    created: boolean;
  } {
    const world = this.world;
    const grid = world.grid;
    const n = world.cellCount;
    const { neighbors, positions } = grid;
    const pieceOfPlate = new Map<number, number>();
    parts.forEach((list, i) => list.forEach((p) => pieceOfPlate.set(p, i)));
    const region = new Uint8Array(n);
    const label = new Int32Array(n).fill(-1);
    for (let c = 0; c < n; c++) {
      const i = pieceOfPlate.get(world.plate[c] as number);
      if (i === undefined || world.crust[c] !== Crust.Continental || this.cellSample[c] === -1) continue;
      region[c] = 1;
      label[c] = i;
    }
    const height = (c: number) => world.heightAboveSea(c);
    const res = retraceBorders({ grid, region, label, height, rng: this.rng, failChance: parts.length >= 3 ? FAILED_ARM_CHANCE : 0 });
    // Pedaços juntados por braço que falhou.
    const kept: [number, number][] = res.kept.map((k) => [k.a, k.b]);
    const rootOf = new Map<number, number>();
    const root = (i: number): number => {
      while (rootOf.has(i) && rootOf.get(i) !== i) i = rootOf.get(i) as number;
      return i;
    };
    for (const [a, b] of kept) {
      const ra = root(a);
      const rb = root(b);
      if (ra !== rb) rootOf.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    for (const { a, b, path } of res.kept) {
      this.carveAulacogen(path);
      this.failedArms.push({ a, b, drift: this.drift });
    }
    const merged = new Map<number, number[]>();
    parts.forEach((list, i) => {
      const r = root(i);
      merged.set(r, [...(merged.get(r) ?? []), ...list]);
    });
    const pieceIds = [...merged.keys()].sort((x, y) => x - y);
    const plateRoot = (p: number): number => root(pieceOfPlate.get(p) ?? -1);
    let inv = this.inverses();

    // Terra que trocou de lado: passa para uma placa do pedaço novo dela (a vizinha mais perto).
    let pending: number[] = [];
    for (let c = 0; c < n; c++) if (region[c] && plateRoot(world.plate[c] as number) !== root(label[c] as number)) pending.push(c);
    for (let pass = 0; pass < 30 && pending.length; pass++) {
      const still: number[] = [];
      for (const c of pending) {
        const want = root(label[c] as number);
        let to = -1;
        for (let d = 0; d < 4 && to < 0; d++) {
          const q = world.plate[neighbors[c * 4 + d] as number] as number;
          if (plateRoot(q) === want) to = q;
        }
        if (to >= 0) this.transferCell(c, to, inv);
        else still.push(c);
      }
      if (still.length === pending.length) break;
      pending = still;
    }
    const opened: number[][] = res.cuts.map((k) => k.path);
    const out = pieceIds.map((r) => merged.get(r) as number[]);
    let micro: { id: number; a: number; b: number } | null = null;
    let newArm: { id: number; from: number[] } | null = null;
    const main = [...res.cuts].sort((x, y) => y.path.length - x.path.length)[0];

    // Terceiro braço: só 2 pedaços, do meio da fenda para dentro do maior.
    if (out.length === 2 && main && main.path.length >= 16) {
      const path = main.path;
      const j = Math.floor(path.length / 2);
      const J = path[j] as number;
      const P = (c: number): Vec3 => [positions[c * 3] as number, positions[c * 3 + 1] as number, positions[c * 3 + 2] as number];
      const pa = P(path[Math.max(0, j - 4)] as number);
      const pb = P(path[Math.min(path.length - 1, j + 4)] as number);
      const pj = P(J);
      const t: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const tl = Math.hypot(...t) || 1;
      const tu: Vec3 = [t[0] / tl, t[1] / tl, t[2] / tl];
      const side: Vec3 = [pj[1] * tu[2] - pj[2] * tu[1], pj[2] * tu[0] - pj[0] * tu[2], pj[0] * tu[1] - pj[1] * tu[0]];
      // Pedaço maior (em terra) e de que lado da fenda ele fica.
      const landOf = (list: number[]) => {
        let k = 0;
        for (let c = 0; c < n; c++) if (region[c] && list.includes(world.plate[c] as number)) k++;
        return k;
      };
      const big = landOf(out[0] as number[]) >= landOf(out[1] as number[]) ? 0 : 1;
      const bigPlates = out[big] as number[];
      const probe = (sign: number) => grid.pointToCell(pj[0] + sign * side[0] * 4 * grid.cellAngle, pj[1] + sign * side[1] * 4 * grid.cellAngle, pj[2] + sign * side[2] * 4 * grid.cellAngle);
      const sign = bigPlates.includes(world.plate[probe(1)] as number) ? 1 : -1;
      const turn = this.rng.range(-25, 25) * DEG;
      const dir: Vec3 = [0, 1, 2].map((k) => sign * (side[k] as number) * Math.cos(turn) + (tu[k] as number) * Math.sin(turn)) as Vec3;
      const allowed = new Uint8Array(n);
      const onMain = new Uint8Array(n);
      for (const c of path) onMain[c] = 1;
      for (let c = 0; c < n; c++) if (region[c] && !onMain[c] && bigPlates.includes(world.plate[c] as number)) allowed[c] = 1;
      allowed[J] = 1;
      const coast = (c: number) => {
        for (let d = 0; d < 4; d++) if (!region[neighbors[c * 4 + d] as number]) return true;
        return false;
      };
      const arm = traceArm({ grid, allowed, start: J, direction: dir, goal: coast, height, rng: this.rng, noise: this.marginNoise });
      if (arm && arm.length >= 8) {
        let split = false;
        if (this.rng.next() >= FAILED_ARM_CHANCE) {
          // Os dois lados do braço dentro do pedaço maior: o menor vira placa nova.
          const blocked = new Uint8Array(n);
          for (const c of arm) blocked[c] = 1;
          for (const c of path) blocked[c] = 1;
          const sideA: number[] = [];
          const seen = new Uint8Array(n);
          const comps: number[][] = [];
          for (let c = 0; c < n; c++) {
            if (!allowed[c] || blocked[c] || seen[c]) continue;
            const comp: number[] = [];
            const stack = [c];
            seen[c] = 1;
            while (stack.length) {
              const k = stack.pop() as number;
              comp.push(k);
              for (let d = 0; d < 4; d++) {
                const m = neighbors[k * 4 + d] as number;
                if (allowed[m] && !blocked[m] && !seen[m]) {
                  seen[m] = 1;
                  stack.push(m);
                }
              }
            }
            comps.push(comp);
          }
          comps.sort((x, y) => y.length - x.length);
          const piece = comps[1];
          if (piece && piece.length >= CONTINENT_SHARE * n && piece.length >= 0.15 * (comps[0] as number[]).length) {
            sideA.push(...piece);
            let x = 0;
            let y = 0;
            let z = 0;
            for (const c of sideA) {
              x += positions[c * 3] as number;
              y += positions[c * 3 + 1] as number;
              z += positions[c * 3 + 2] as number;
            }
            const l = Math.hypot(x, y, z) || 1;
            const id = this.allocPlate([x / l, y / l, z / l]);
            if (id >= 0) {
              inv = this.inverses();
              this.moveWithOcean(sideA, id, inv);
              for (const list of out) {
                const k = list.indexOf(id);
                if (k >= 0) list.splice(k, 1);
              }
              out.push([id]);
              opened.push(arm);
              newArm = { id, from: bigPlates.filter((q) => q !== id) };
              split = true;
            }
          }
        }
        if (!split) {
          this.carveAulacogen(arm);
          this.failedArms.push({ a: bigPlates[0] as number, b: bigPlates[0] as number, drift: this.drift });
        }
      }
    }

    // Microcontinente: lasca ao lado da fenda principal.
    if (main && main.path.length >= 20 && this.rng.next() < MICROCONTINENT_CHANCE) {
      const sideSign: 1 | -1 = this.rng.next() < 0.5 ? 1 : -1;
      const land = new Uint8Array(n);
      for (let c = 0; c < n; c++) if (world.crust[c] === Crust.Continental && pieceOfPlate.has(world.plate[c] as number)) land[c] = 1;
      let width = this.rng.int(3, 8);
      let cells = sliverAlong(grid, land, main.path, sideSign, width);
      if (cells.length < MICRO_SHARE_MIN * n) cells = sliverAlong(grid, land, main.path, sideSign, (width = 8));
      while (cells.length > MICRO_SHARE_MAX * n && width > 3) cells = sliverAlong(grid, land, main.path, sideSign, --width);
      const from = cells.length ? (world.plate[cells[0] as number] as number) : -1;
      const across = world.plate[main.path[0] as number] === from ? (world.plate[main.path[main.path.length - 1] as number] as number) : (world.plate[main.path[0] as number] as number);
      if (cells.length >= MICRO_SHARE_FLOOR * n && from >= 0) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (const c of cells) {
          x += positions[c * 3] as number;
          y += positions[c * 3 + 1] as number;
          z += positions[c * 3 + 2] as number;
        }
        const l = Math.hypot(x, y, z) || 1;
        const id = this.allocPlate([x / l, y / l, z / l]);
        if (id >= 0) {
          inv = this.inverses();
          for (const c of cells) if (this.cellSample[c] !== -1) this.transferCell(c, id, inv);
          for (const list of out) {
            const k = list.indexOf(id);
            if (k >= 0) list.splice(k, 1);
          }
          // Lado de lá da fenda: uma placa de outro pedaço encostada no braço.
          let b = across;
          for (const c of main.path) {
            const q = world.plate[c] as number;
            if (q !== from && q !== id) {
              b = q;
              break;
            }
          }
          micro = { id, a: from, b };
          opened.push(main.path);
        }
      }
    }
    this.markMargins(opened);
    return { parts: out.filter((list) => list.length), kept, micro, arm: newArm, created: out.length > merged.size || micro !== null };
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
    // Em blocos, por uma função pequena: chamada muitas vezes, ela fica otimizada de uma recomposição
    // para a outra. Num laço único, cada recomposição começava sem otimizar e cada soma criava lixo.
    // Mesma ordem de soma (mesmo resultado).
    for (let c = 0; c < world.cellCount; c += POLARITY_CHUNK) {
      this.sumOcean(c, Math.min(world.cellCount, c + POLARITY_CHUNK), birth, depth, count);
    }
    for (let p = 0; p < plates; p++) {
      const k = (count[p] as number) || 1;
      birth[p] = (birth[p] as number) / k;
      depth[p] = (depth[p] as number) / k;
    }
    this.plateOcean = { birth, depth };
  }

  private sumOcean(from: number, to: number, birth: Float64Array, depth: Float64Array, count: Float64Array): void {
    const { cellSample, sCrust, sPlate, sBirth, sElev } = this;
    for (let c = from; c < to; c++) {
      const i = cellSample[c] as number;
      if (i < 0 || sCrust[i] !== Crust.Oceanic) continue;
      const p = sPlate[i] as number;
      birth[p] = (birth[p] as number) + (sBirth[i] as number);
      depth[p] = (depth[p] as number) + (sElev[i] as number);
      count[p] = (count[p] as number) + 1;
    }
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
    const ref = world.grid.pointToCellOf(q);
    // Se a nova dona já tem amostra ali (escondida sob o pedaço), ela recebe a crosta do pedaço.
    let i = this.find(to, ref);
    if (i >= 0) {
      this.sElev[i] = this.sElev[old] as number;
      this.sCrust[i] = this.sCrust[old] as number;
      this.sBirth[i] = this.sBirth[old] as number;
    } else {
      i = this.addSample(to, ref, this.sElev[old] as number, this.sCrust[old] as number, this.sBirth[old] as number);
    }
    this.sMargin[i] = this.sMargin[old] as number;
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
