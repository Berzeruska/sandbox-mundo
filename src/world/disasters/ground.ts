import { Biome } from '../biomes';
import type { WorldState } from '../state';

/**
 * Chão de cada célula depois dos desastres (Bloco Desastres v2, R2): a vegetação em porcentagem e um
 * estado temporário (em chamas, queimada, lava...). O bioma por baixo continua o mesmo; quem pinta é
 * `src/render/colors.ts` (cor do bioma misturada com o solo nu pela cobertura, e a cor do estado por
 * cima). Lógica pura e determinística. As células ficam no lugar nas recomposições (o que dura séculos,
 * como o basalto, passa a andar com a placa na R7).
 */
export const CellState = {
  None: 0,
  Burning: 1,
  Burned: 2,
  Lava: 3,
  Basalt: 4,
  Flooded: 5,
  Mud: 6,
  Crack: 7,
  Fertile: 8,
  Heat: 9,
  Ash: 10,
  /** Lago que a enchente deixa numa bacia fechada (R4). */
  Lake: 11,
  /** Deslizamento do terremoto (R5): cicatriz clara em cima, entulho escuro embaixo (nível = posição). */
  Slide: 12,
  /** Tsunami (R6): fundo do mar exposto antes da onda, faixa de espuma, água do mar sobre a terra. */
  Seabed: 13,
  Wave: 14,
  Surge: 15,
  /** Vulcão sob gelo (C10): água do degelo descendo de uma vez e o sedimento que ela deixa. */
  Meltwater: 16,
  Outwash: 17,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

/** Nome do estado para o toque ("Floresta temperada · queimada · vegetação 20%"). */
export const STATE_NAMES: Record<number, string> = {
  [CellState.Burning]: 'em chamas',
  [CellState.Burned]: 'queimada',
  [CellState.Lava]: 'lava',
  [CellState.Basalt]: 'basalto',
  [CellState.Flooded]: 'alagada',
  [CellState.Mud]: 'lama',
  [CellState.Crack]: 'fenda',
  [CellState.Fertile]: 'solo fértil',
  [CellState.Heat]: 'calor da seca',
  [CellState.Ash]: 'cinzas',
  [CellState.Lake]: 'lago da enchente',
  [CellState.Slide]: 'deslizamento',
  [CellState.Seabed]: 'fundo do mar exposto',
  [CellState.Wave]: 'onda do tsunami',
  [CellState.Surge]: 'água do tsunami',
  [CellState.Meltwater]: 'enchente do degelo',
  [CellState.Outwash]: 'areia e cascalho do degelo',
};

/**
 * Anos para a vegetação voltar de 0 a 100% (especificação, base comum 1). Biomas fora da tabela
 * (desertos, gelo, montanha, picos, praia e mar) não têm vegetação para perder.
 */
export const REGROW_YEARS: Readonly<Partial<Record<number, number>>> = {
  [Biome.Grassland]: 4,
  [Biome.Steppe]: 4,
  [Biome.Savanna]: 4,
  [Biome.Swamp]: 10,
  [Biome.Tundra]: 20,
  [Biome.TropicalForest]: 30,
  [Biome.TemperateForest]: 40,
  [Biome.Taiga]: 60,
};

export function hasVegetation(biome: number): boolean {
  return REGROW_YEARS[biome] !== undefined;
}

/** As mesmas tabelas em arrays (o laço anual passa por milhares de células). */
const REGROW_TABLE = new Float32Array(32);
for (const [b, y] of Object.entries(REGROW_YEARS)) REGROW_TABLE[Number(b)] = y as number;

/** Estados em que a vegetação não volta (o chão ainda queima, é rocha, está salgado ou na seca). */
const NO_REGROW: ReadonlySet<number> = new Set([CellState.Burning, CellState.Lava, CellState.Basalt, CellState.Mud, CellState.Heat, CellState.Lake, CellState.Surge, CellState.Meltwater, CellState.Outwash]);
const NO_REGROW_TABLE = new Uint8Array(32);
for (const s of NO_REGROW) NO_REGROW_TABLE[s] = 1;
/** Solo fértil (o que a enchente deixa): a vegetação volta 2× mais rápido. */
const FERTILE_REGROW = 2;
/**
 * O que vem quando o estado acaba: a lava esfria em basalto, o fogo deixa a terra queimada (2–4 anos;
 * a vegetação volta por baixo). Duração em anos (mínimo e máximo, sorteada por célula de forma fixa).
 */
const NEXT_STATE: Readonly<Partial<Record<number, readonly [Exclude<CellState, 0>, number, number]>>> = {
  [CellState.Lava]: [CellState.Basalt, 100, 300],
  [CellState.Burning]: [CellState.Burned, 2, 4],
  // A água da enchente baixa e deixa solo fértil por 20–40 anos (R4).
  [CellState.Flooded]: [CellState.Fertile, 20, 40],
  [CellState.Lake]: [CellState.Fertile, 20, 40],
  // A água do tsunami volta para o mar e deixa lama salgada (15–30 anos sem nada crescer).
  [CellState.Surge]: [CellState.Mud, 15, 30],
  // A enchente do degelo passa e deixa areia e cascalho (30–80 anos).
  [CellState.Meltwater]: [CellState.Outwash, 30, 80],
};
/** Estados que só a lava cobre (um alagamento não apaga um derrame de basalto). */
const ROCK: ReadonlySet<number> = new Set([CellState.Lava, CellState.Basalt]);

/** Número fixo por célula em [0, 1). */
export function cellHash(c: number, salt = 0): number {
  return (Math.imul((c ^ salt) ^ 0x5bd1e995, 0x27d4eb2d) >>> 0) / 4294967296;
}

export class Ground {
  /** Cobertura de vegetação (0–1; 1 = cheia). */
  readonly cover: Float32Array;
  readonly state: Uint8Array;
  readonly start: Int32Array;
  readonly until: Int32Array;
  /** Intensidade do estado na célula (0–255): o calor da seca, a profundidade da enchente. */
  readonly level: Uint8Array;
  /**
   * Rocha do vulcão (R7), independente do estado: 0 = nenhuma; 1–254 = cone (posição: 254 na borda da
   * cratera, 1 no pé); 255 = cratera. Fica enquanto o cone existir (a lava passa por cima e esfria).
   */
  readonly rock: Uint8Array;
  /** Células com rocha de vulcão. */
  readonly rockCells = new Set<number>();
  /** Células com vegetação abaixo de 100% ou com estado (para não varrer o mundo todo). */
  readonly active = new Set<number>();
  /** Passo atual (para a força dos estados na hora de pintar). */
  tick = 0;
  /** Aparência já mandada à tela por célula (só repinta quando muda de verdade). */
  private shown: Uint16Array;
  private dirty = new Set<number>();
  /**
   * Agenda: em que passo vence o estado de cada célula (células por passo). Cada passo só olha a sua
   * lista, em vez de varrer todas as células ativas (milhares numa seca grande ou num solo fértil).
   */
  private due = new Map<number, number[]>();
  private expiredUpTo = -1;

  constructor(cellCount: number) {
    this.cover = new Float32Array(cellCount).fill(1);
    this.state = new Uint8Array(cellCount);
    this.start = new Int32Array(cellCount);
    this.until = new Int32Array(cellCount);
    this.level = new Uint8Array(cellCount);
    this.rock = new Uint8Array(cellCount);
    this.shown = new Uint16Array(cellCount).fill(FULL_KEY);
  }

  get bytes(): number {
    return this.cover.byteLength + this.state.byteLength + this.start.byteLength + this.until.byteLength + this.level.byteLength + this.rock.byteLength + this.shown.byteLength;
  }

  /**
   * Põe o estado `s` na célula de `tick` até `tick + years`, com a intensidade `level` (0–1). Só a lava
   * cobre lava e basalto.
   */
  setState(c: number, s: Exclude<CellState, 0>, tick: number, years: number, ticksPerYear: number, level = 1): void {
    if (ROCK.has(this.state[c] as number) && s !== CellState.Lava) return;
    this.state[c] = s;
    this.level[c] = Math.round(Math.max(0, Math.min(1, level)) * 255);
    this.start[c] = tick;
    const until = tick + Math.max(1, Math.round(years * ticksPerYear));
    this.until[c] = until;
    const list = this.due.get(until);
    if (list) list.push(c);
    else this.due.set(until, [c]);
    this.touch(c);
  }

  /** A vegetação perde a fração `f` do que tem (0–1). */
  damage(c: number, f: number): void {
    const before = this.cover[c] as number;
    this.cover[c] = before * (1 - Math.max(0, Math.min(1, f)));
    if (this.cover[c] !== before) this.touch(c);
  }

  /** Força do estado (1 no começo, 0 no fim). */
  strength(c: number): number {
    if (!this.state[c]) return 0;
    const total = (this.until[c] as number) - (this.start[c] as number);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, ((this.until[c] as number) - this.tick) / total));
  }

  private touch(c: number): void {
    this.active.add(c);
    this.dirty.add(c);
  }

  /** Estados vencidos saem (ou viram o seguinte, ex.: lava → basalto). Roda a cada passo. */
  expire(tick: number, ticksPerYear: number): void {
    this.tick = tick;
    if (!this.due.size) {
      this.expiredUpTo = tick;
      return;
    }
    // Passos vencidos desde a última vez (em ordem); num salto grande, só as listas que existem.
    const from = this.expiredUpTo + 1;
    const steps: number[] = [];
    if (tick >= from && tick - from <= 64) {
      for (let t = from; t <= tick; t++) if (this.due.has(t)) steps.push(t);
    } else {
      for (const t of this.due.keys()) if (t <= tick) steps.push(t);
      steps.sort((a, b) => a - b);
    }
    this.expiredUpTo = tick;
    for (const t of steps) {
      const list = this.due.get(t) as number[];
      this.due.delete(t);
      for (const c of list) this.expireCell(c, t, tick, ticksPerYear);
    }
  }

  private expireCell(c: number, due: number, tick: number, ticksPerYear: number): void {
    const s = this.state[c] as number;
    // Entrada velha da agenda (a célula ganhou outro estado depois): ignora.
    if (!s || (this.until[c] as number) !== due) return;
    const next = NEXT_STATE[s];
    this.state[c] = CellState.None;
    // O fogo acabou (a vegetação virou cinza) ou o mar passou por cima (arrancou tudo).
    if (s === CellState.Burning || s === CellState.Surge || s === CellState.Meltwater) this.cover[c] = 0;
    if (next) this.setState(c, next[0], tick, next[1] + (next[2] - next[1]) * cellHash(c, s), ticksPerYear);
    this.dirty.add(c);
  }

  /**
   * Um ano: a vegetação volta na velocidade do bioma (com variação por região, para não voltar em
   * bloco). Células cheias e sem estado saem da lista. Roda sobre milhares de células (basalto dura
   * séculos): tabelas em arrays e saída cedo do que não muda.
   */
  year(world: WorldState): void {
    const { biome, ice, elevation } = world;
    const sea = world.seaLevel;
    for (const c of this.active) {
      const s = this.state[c] as number;
      // Estado que vai sumindo: a cor pode mudar de degrau.
      if (s) this.dirty.add(c);
      const cover = this.cover[c] as number;
      if (cover >= 1) {
        if (!s) this.active.delete(c);
        continue;
      }
      const years = REGROW_TABLE[biome[c] as number] as number;
      if (!years || (elevation[c] as number) <= sea || ice[c]) {
        // Sem vegetação aqui (deserto, gelo, mar): nada a voltar.
        this.cover[c] = 1;
        this.dirty.add(c);
        if (!s) this.active.delete(c);
        continue;
      }
      if (NO_REGROW_TABLE[s]) continue;
      const pace = regrowPace(world, c) * (s === CellState.Fertile ? FERTILE_REGROW : 1);
      const next = Math.min(1, cover + pace / years);
      this.cover[c] = next;
      this.dirty.add(c);
      if (!s && next >= 1) this.active.delete(c);
    }
  }

  /** Células cuja aparência mudou desde a última vez (para repintar só essas). */
  takeChanged(): number[] {
    const out: number[] = [];
    for (const c of this.dirty) {
      const key = this.keyOf(c);
      if (key === this.shown[c]) continue;
      this.shown[c] = key;
      out.push(c);
    }
    this.dirty.clear();
    return out;
  }

  /** Aparência em degraus: estado, força (8 níveis) e cobertura (de 4 em 4%). */
  private keyOf(c: number): number {
    const s = this.state[c] as number;
    const level = s ? Math.ceil(this.strength(c) * 7) : 0;
    return (s << 11) | (level << 8) | Math.round((this.cover[c] as number) * 25);
  }

  /** Intensidade do estado (0–1). */
  levelOf(c: number): number {
    return (this.level[c] as number) / 255;
  }

  /** Marca (ou tira, com 0) a rocha de vulcão na célula. */
  setRock(c: number, value: number): void {
    if (this.rock[c] === value) return;
    this.rock[c] = value;
    if (value) this.rockCells.add(c);
    else this.rockCells.delete(c);
    // A aparência muda: força a repintura (a chave não vê a rocha).
    this.shown[c] = 0xffff;
    this.dirty.add(c);
  }

  /**
   * As placas andaram (recomposição): o chão de cada célula vai junto com a crosta, como o relevo.
   * `oldKey(c)` é a identidade (placa e ponto de referência) da célula antes; `newKey(c)`, depois. Chão
   * em crosta que sumiu (subducção) some; fenda nova nasce sem nada. Devolve célula antiga → nova.
   */
  remap(oldKey: (c: number) => number, newKey: (c: number) => number, cellCount: number): Map<number, number> {
    const moving = new Set<number>([...this.active, ...this.rockCells]);
    const byKey = new Map<number, number>();
    const snap = new Map<number, { cover: number; state: number; start: number; until: number; level: number; rock: number }>();
    for (const c of moving) {
      byKey.set(oldKey(c), c);
      snap.set(c, {
        cover: this.cover[c] as number,
        state: this.state[c] as number,
        start: this.start[c] as number,
        until: this.until[c] as number,
        level: this.level[c] as number,
        rock: this.rock[c] as number,
      });
      this.cover[c] = 1;
      this.state[c] = CellState.None;
      this.rock[c] = 0;
      this.shown[c] = 0xffff;
      this.dirty.add(c);
    }
    this.active.clear();
    this.rockCells.clear();
    const moved = new Map<number, number>();
    if (!byKey.size) return moved;
    for (let c = 0; c < cellCount; c++) {
      const from = byKey.get(newKey(c));
      if (from === undefined || moved.has(from)) continue;
      const v = snap.get(from) as { cover: number; state: number; start: number; until: number; level: number; rock: number };
      moved.set(from, c);
      this.cover[c] = v.cover;
      this.state[c] = v.state;
      this.start[c] = v.start;
      this.until[c] = v.until;
      this.level[c] = v.level;
      this.rock[c] = v.rock;
      if (v.rock) this.rockCells.add(c);
      if (v.state || v.cover < 1) this.active.add(c);
      if (v.state) {
        const list = this.due.get(v.until);
        if (list) list.push(c);
        else this.due.set(v.until, [c]);
      }
      this.shown[c] = 0xffff;
      this.dirty.add(c);
    }
    return moved;
  }

  clear(): void {
    for (const c of this.active) {
      this.cover[c] = 1;
      this.state[c] = CellState.None;
      this.shown[c] = FULL_KEY;
    }
    for (const c of this.rockCells) this.rock[c] = 0;
    this.rockCells.clear();
    this.active.clear();
    this.dirty.clear();
    this.due.clear();
  }
}

/** Chave da célula intacta (cobertura cheia, sem estado). */
const FULL_KEY = 25;

/**
 * Ritmo da volta (0,75–1,3): mais rápido onde chove mais na região e um pouco por célula, para a
 * vegetação voltar em manchas.
 */
function regrowPace(world: WorldState, c: number): number {
  const v = 1 + 0.18 * (world.rainNoise[c] as number) + 0.24 * (cellHash(c, 0x9e37) - 0.5);
  return Math.max(0.75, Math.min(1.3, v));
}
