import { createRng, type Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { CellState, Ground } from './ground';
import { quakeDamage } from './quake-damage';
import { canStartSandstorm, type DustView, MAX_SANDSTORMS, NOTABLE_SAND_RADIUS, pickSandstormCell, PLAYER_SAND_RADIUS, SAND_RADIUS, SANDSTORM_CHANCE, SandstormProcess } from './sandstorm';
import { CRATER_RADIUS, GIANT_WINTER, impact, METEOR_NAMES, MeteorProcess, sampleNaturalMeteor, SEA_TSUNAMI } from './meteor';
import { IceReturnProcess, MELT_CELLS_PER_ICE, MELT_MAX_CELLS, MELT_MIN_ICE, MeltwaterProcess, NOTABLE_MELT_CELLS } from './meltwater';
import { IceMode } from '../state';
import { HurricaneProcess, MAX_PER_QUADRANT, MAX_STORMS_WORLD, quadrantOf, stormName, type StormView } from './hurricane';
import {
  arcSpacing,
  ASH_LIGHTNING,
  ASH_LIGHTNING_FIRE,
  ashPlume,
  AWAKE_YEARS,
  coneCells,
  coneTop,
  ERUPTION_EVERY,
  growCone,
  LavaProcess,
  lavaBudget,
  LIGHTNING_WAKE,
  nextWake,
  sampleCone,
  type Volcano,
  type VolcanoKind,
} from './volcano';
import { DROUGHT_YEARS, NOTABLE_DROUGHT_RADIUS, sampleDroughtRadius, startDrought } from './drought';
import { DEPTH, FLOOD_CELLS, FloodProcess, floodPlan, lowestNear, NOTABLE_FLOOD_CELLS, PLAYER_FLOOD_CELLS, WET_YEARS } from './flood';
import { canBurn, FireProcess, LIGHTNING_PER_YEAR, lightningIgnites, NOTABLE_FIRE_CELLS, pickLightningCell, PLAYER_FIRE_BOOST, PLAYER_FIRE_RADIUS } from './fire';
import { buildFaults, type Fault, feltRadius, MAX_MAGNITUDE, NOTABLE_MAGNITUDE, sampleMagnitude, stressDrop, yearlyStress } from './quakes';
import { planTsunami, TSUNAMI_MIN_MAGNITUDE, tsunamiReach, TsunamiProcess } from './tsunami';
import { areaLabel, decimal, DEFAULT_FREQUENCY, DisasterKind, FREQUENCIES, type DisasterEvent, type FireCause } from './types';
import {
  DROUGHT_CHANCE,
  FLOOD_CHANCE,
  HURRICANE_CHANCE,
  HURRICANE_LAT,
  HURRICANE_MIN_TEMP,
  latitudeOf,
  pickCell,
  sampleCategory,
} from './weather';
import {
  ERUPTIONS_PER_YEAR,
  eruptionUplift,
  HOTSPOT_MAX_PER_YEAR,
  HOTSPOT_METERS_PER_CELL,
  HOTSPOT_YEARS,
  hotspotPulse,
  makeHotspots,
  MAX_VEI,
  NOTABLE_VEI,
  sampleVei,
  ventCell,
} from './volcanoes';
import { Boundary, Crust } from '../plates';
import { MAX_PLATE_RATE } from '../tectonics';

export { DisasterKind, FREQUENCIES, DEFAULT_FREQUENCY, DISASTER_NAMES, type DisasterEvent } from './types';
export { CellState, Ground } from './ground';
export type { FireCause } from './types';

/** Relevo erguido por um desastre (erupção): o relógio aplica como um pincel de Elevar. */
export interface Uplift {
  point: Vec3;
  /** Raio (células) e altura no centro (m). */
  radius: number;
  meters: number;
}

/** Relevo mudado célula a célula por um desastre (para sempre, gravado na placa como o pincel). */
export interface TerrainChange {
  cells: number[];
  /** Metros a somar em cada célula. */
  deltas: number[];
}

/** Gelo mudado por um desastre (vulcão derretendo; volta ao clima depois), gravado na placa. */
export interface IceChange {
  cells: number[];
  /** `IceMode` novo das células. */
  mode: number;
}

/** O que os desastres de um passo fizeram: o relógio aplica e avisa a tela. */
export interface DisasterOutcome {
  events: DisasterEvent[];
  /** Células cuja aparência mudou (vegetação ou estado): repintar. */
  marked: number[];
  uplifts: Uplift[];
  terrain: TerrainChange[];
  ice: IceChange[];
  /** Invernos de impacto começando neste passo (meteoro gigante): °C a menos e anos. */
  winters: { amount: number; years: number }[];
}

/**
 * Um desastre que anda passo a passo no relógio (R2: 1 passo = 1 mês; o fogo avança, a lava escorre, a
 * água sobe e desce). Roda uma vez por passo, na ordem em que começou; sorteios só pelo gerador com
 * semente dos desastres. Devolve false quando acabou.
 */
export interface DisasterProcess {
  step(tick: number, out: DisasterOutcome): boolean;
  /** As placas andaram: célula antiga → nova (os que duram anos acompanham). */
  remap?(moved: ReadonlyMap<number, number>): void;
}

/** Quanto tempo (anos) cada marca curta dos desastres de hoje dura (R3–R8 refazem cada um). */
/** Chance de a lava acender fogo em cada vizinha com vegetação em que encosta. */
const LAVA_FIRE = 0.12;
/** Respingos de lava quando um raio acerta um vulcão (células). */
const SPATTER_CELLS: readonly [number, number] = [4, 8];

/**
 * Desastres do mundo (T8–T12): vivem no relógio e andam com o passo do jogo; sorteios próprios, na ordem
 * dos passos (mesma semente + mesmos comandos = mesmos desastres). Os naturais são sorteados uma vez
 * por ano de jogo; os do jogador acontecem no passo em que chegam.
 */
export class Disasters {
  /** Vegetação e estado de cada célula. */
  readonly ground: Ground;
  /** Nível de frequência (índice de FREQUENCIES). */
  frequency = DEFAULT_FREQUENCY;
  private rng: Rng;
  private faults = new Map<number, Fault>();
  /** Pontos quentes (fixos no manto: direções no mundo) e quanto (células) a placa já andou por cima. */
  hotspots: Vec3[];
  private hotspotTravel: number[] = [];
  private nextId = 1;
  /** Gelo derretido por vulcões, voltando ao clima devagar (C10). */
  private iceReturn = new IceReturnProcess();
  /** Tempestades de areia andando (C12). */
  private dust: SandstormProcess[] = [];
  /** Furacões e ciclones andando (R8). */
  private storms: HurricaneProcess[] = [];
  /** Vulcões no mapa (R7), na ordem em que nasceram. */
  volcanoes: Volcano[] = [];
  private nextVolcanoId = 1;
  /** Relevo dos vulcões do começo, para o relógio aplicar antes de o mundo aparecer. */
  private initialTerrain: TerrainChange[] = [];
  /** Desastres em andamento (passo a passo). */
  private processes: DisasterProcess[] = [];
  /** Contagem por tipo (para testes e o painel). */
  readonly counts = new Array<number>(10).fill(0);
  /** Velocidade das placas no último passo (com elas paradas, a geologia congela). */
  private plateRate = 0;
  /** Saída do passo em andamento (os desastres passo a passo avisam por ela quando acabam). */
  private stepOut: DisasterOutcome | null = null;

  constructor(private world: WorldState) {
    this.rng = createRng((world.params.seed ^ 0x6d15a57e) >>> 0);
    this.ground = new Ground(world.cellCount);
    this.hotspots = makeHotspots(createRng((world.params.seed ^ 0x40750f07) >>> 0));
    this.onRecompose();
    this.placeInitialVolcanoes();
  }

  /**
   * Vulcões do começo (R7): um a cada ~ARC_SPACING células das fronteiras convergentes (do lado da
   * placa de cima) e um em cada ponto quente, todos dormindo, acordando em momentos sorteados.
   */
  private placeInitialVolcanoes(): void {
    const world = this.world;
    const rng = createRng((world.params.seed ^ 0x7a1c0e5b) >>> 0);
    for (const f of this.faults.values()) {
      if (f.type !== Boundary.Convergent) continue;
      const spacing = arcSpacing(world);
      const count = Math.floor(f.cells.length / 2 / spacing);
      for (let k = 0; k < count; k++) {
        const cell = ventCell(world, f.cells[rng.int(0, f.cells.length - 1)] as number, f.type, rng);
        if (this.volcanoNear(cell, spacing * 0.7)) continue;
        this.addVolcano(cell, 'arc', -1, rng, this.initialTerrain, 0);
      }
    }
    this.hotspots.forEach((p, k) => {
      const cell = world.grid.pointToCell(p[0], p[1], p[2]);
      if (!this.volcanoNear(cell, 3)) this.addVolcano(cell, 'hotspot', k, rng, this.initialTerrain, 0);
    });
    // Dormindo, cada um com um tempo sorteado até acordar (os primeiros acordam logo).
    const factor = FREQUENCIES[DEFAULT_FREQUENCY]?.factor ?? 1;
    for (const v of this.volcanoes) v.until = Math.round(rng.next() * nextWake(v, 0, factor, rng));
  }

  /** Relevo dos vulcões do começo (uma vez; o relógio aplica antes de o mundo aparecer). */
  takeInitialTerrain(): TerrainChange[] {
    const t = this.initialTerrain;
    this.initialTerrain = [];
    return t;
  }

  /** Vulcão a até `cells` células de `cell`, ou undefined. */
  volcanoNear(cell: number, cells: number): Volcano | undefined {
    let best: Volcano | undefined;
    let bestD = cells;
    for (const v of this.volcanoes) {
      const d = cellDistance(this.world, v.cell, cell);
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** Vulcão novo em `cell`: ergue o cone (mudança de relevo em `terrain`) e marca a rocha. */
  private addVolcano(cell: number, kind: VolcanoKind, hotspot: number, rng: Rng, terrain: TerrainChange[], tick: number): Volcano {
    const cone = sampleCone(this.world, cell, kind, rng);
    // No mar, o vulcão do jogador já nasce ilha.
    const depth = kind === 'player' ? Math.max(0, -this.world.heightAboveSea(cell)) : 0;
    const v: Volcano = { id: this.nextVolcanoId++, cell, kind, hotspot, cone, top: coneTop(cone) + (depth ? depth + 150 : 0), awake: false, until: tick, nextEruption: tick, extinct: false };
    // Nasce dormindo (quem o cria acordado chama `wake` logo depois).
    v.until = nextWake(v, tick, FREQUENCIES[this.frequency]?.factor ?? 0, rng);
    this.volcanoes.push(v);
    const t = growCone(this.world, this.ground, v, null);
    if (t.cells.length) terrain.push(t);
    return v;
  }

  /**
   * As placas andaram (recomposição): o chão e os vulcões vão junto com a crosta. `oldKey`/`newKey`:
   * identidade (placa, ponto de referência) de cada célula antes e depois.
   */
  remap(oldKey: (c: number) => number, newKey: (c: number) => number): void {
    const moved = this.ground.remap(oldKey, newKey, this.world.cellCount);
    this.volcanoes = this.volcanoes.filter((v) => {
      const to = moved.get(v.cell);
      if (to === undefined) return false;
      v.cell = to;
      return true;
    });
    for (const p of this.processes) p.remap?.(moved);
    // O gelo para voltar ao clima não anda: o modo do gelo fica no lugar, não vai com a placa (achado
    // da revisão E13, 2026-10-19: andando, a volta caía em outra célula e o gelo apagado ficava).
  }

  /** Fronteiras novas (depois de cada recomposição): refaz os trechos, a tensão continua. */
  onRecompose(): void {
    this.faults = buildFaults(this.world, this.faults, this.rng);
  }

  /** Começa um desastre que anda passo a passo (roda a partir do próximo passo). */
  start(p: DisasterProcess): void {
    this.processes.push(p);
  }

  /** Quantos desastres estão andando agora. */
  get running(): number {
    return this.processes.length;
  }

  /**
   * Um passo do jogo: os desastres em andamento avançam, os estados vencidos saem e, uma vez por ano,
   * a vegetação volta e os naturais são sorteados. Os desastres naturais da geologia só correm com as
   * placas andando (`plateRate` > 0: "em 0 a geologia congela").
   */
  step(tick: number, plateRate: number): DisasterOutcome | null {
    this.plateRate = plateRate;
    const out: DisasterOutcome = { events: [], marked: [], uplifts: [], terrain: [], ice: [], winters: [] };
    this.ground.expire(tick, TICKS_PER_YEAR);
    // Gelo derretido por vulcão voltando ao clima (só fica gelo onde o clima é de gelo).
    if (this.iceReturn.pending) {
      const back = this.iceReturn.take(tick);
      if (back.length) out.ice.push({ cells: back, mode: IceMode.Auto });
    }
    this.stepOut = out;
    if (this.processes.length) this.processes = this.processes.filter((p) => p.step(tick, out));
    if (tick % TICKS_PER_YEAR === 0) this.yearly(tick, plateRate, out);
    this.stepOut = null;
    out.marked = this.ground.takeChanged();
    return out.events.length || out.marked.length || out.uplifts.length || out.terrain.length || out.ice.length || out.winters.length ? out : null;
  }

  private yearly(tick: number, plateRate: number, out: DisasterOutcome): void {
    this.ground.year(this.world);
    const factor = FREQUENCIES[this.frequency]?.factor ?? 0;
    // Geologia (vulcões e pontos quentes) congela com as placas paradas.
    if (plateRate > 0) {
      this.hotspotGrowth(tick, plateRate, out);
      this.volcanoYear(tick, factor, out);
    }
    // Clima: continua com as placas paradas.
    if (factor > 0) this.weather(tick, factor, out);
    // Meteoros naturais: pequenos os mais comuns, gigante raríssimo (C12). Mudam o relevo: com as placas
    // paradas não caem (a regra "em 0 a geologia congela"; o do jogador cai sempre).
    if (factor > 0 && plateRate > 0) {
      const size = sampleNaturalMeteor(this.rng, factor);
      if (size) this.meteor(this.rng.int(0, this.world.cellCount - 1), size, tick, false, out);
    }
    if (factor > 0 && plateRate > 0) {
      for (const f of this.faults.values()) {
        // Arco: nasce um vulcão novo onde ainda não há (e já acorda); dorsal: erupção no fundo do mar.
        const rate = ERUPTIONS_PER_YEAR[f.type];
        if (rate && this.rng.next() < rate * f.length * f.speed * factor) {
          const cell = ventCell(this.world, f.cells[this.rng.int(0, f.cells.length - 1)] as number, f.type, this.rng);
          if (f.type === Boundary.Convergent) {
            if (!this.volcanoNear(cell, arcSpacing(this.world) * 0.7)) this.wake(this.addVolcano(cell, 'arc', -1, this.rng, out.terrain, tick), tick, false, out);
          } else {
            this.ridgeEruption(cell, sampleVei(this.rng.next(), 0, 2), tick, out);
          }
        }
        f.stress += yearlyStress(f) * factor;
        if (f.stress < f.threshold) continue;
        const max = MAX_MAGNITUDE[f.type] ?? 7;
        const m = sampleMagnitude(this.rng.next(), max);
        f.stress = Math.max(0, f.stress - stressDrop(m, max));
        f.threshold = this.rng.range(0.3, 1);
        const cell = f.cells[this.rng.int(0, f.cells.length - 1)] as number;
        this.quake(cell, m, tick, false, out);
      }
    }
  }

  /**
   * Desastre provocado pelo jogador no ponto `point` (funciona com qualquer frequência). `strength`: a
   * força escolhida no cartão (magnitude do terremoto e do tsunami, categoria do furacão).
   */
  trigger(kind: DisasterKind, point: Vec3, tick: number, strength?: number): DisasterOutcome {
    const out: DisasterOutcome = { events: [], marked: [], uplifts: [], terrain: [], ice: [], winters: [] };
    const world = this.world;
    this.ground.tick = tick;
    const cell = world.grid.pointToCell(point[0], point[1], point[2]);
    if (kind === DisasterKind.Quake) {
      // Do jogador: a magnitude escolhida; sem escolha, forte (7 a 9), do tamanho que a fronteira deixa.
      const max = Math.max(8, MAX_MAGNITUDE[world.boundary[cell] as number] ?? 8.5);
      this.quake(cell, strength ?? 7 + (max - 7) * this.rng.next(), tick, true, out);
    } else if (kind === DisasterKind.Volcano) {
      // Do jogador: tocar num vulcão acorda e faz entrar em erupção; fora, cria um novo ali (no mar já
      // nasce ilha). Sempre forte (IEV 4 a 6).
      const near = this.volcanoNear(cell, 2);
      const hit = near && cellDistance(world, near.cell, cell) <= near.cone + 0.6 ? near : this.addVolcano(cell, 'player', -1, this.rng, out.terrain, tick);
      hit.extinct = false;
      this.wake(hit, tick, true, out, 4 + this.rng.int(0, 2));
    } else if (kind === DisasterKind.Drought) {
      if (!world.isWater(cell)) this.drought(cell, tick, true, out);
    } else if (kind === DisasterKind.Flood) {
      if (!world.isWater(cell)) this.flood(cell, tick, true, out);
    } else if (kind === DisasterKind.Hurricane) {
      // No mar mais perto (até 40 passos); longe de qualquer mar, nasce ali mesmo (e logo enfraquece).
      const sea = nearestWater(world, cell, 40);
      this.hurricane(sea >= 0 ? sea : cell, strength ?? 3 + this.rng.int(0, 2), tick, true, out);
    } else if (kind === DisasterKind.Fire) {
      // Na vegetação mais perto (até 6 células) do toque.
      const start = nearest(world, cell, 6, (c) => canBurn(world, this.ground, c));
      if (start >= 0) this.startFire(start, tick, true, 'jogador');
    } else if (kind === DisasterKind.Sandstorm) {
      // Só em areia ou seca (E4): no deserto ou seca mais perto do toque (até 6 células).
      const start = nearest(world, cell, 6, (c) => canStartSandstorm(world, this.ground, c));
      if (start >= 0) this.sandstorm(start, tick, true, out);
    } else if (kind === DisasterKind.Meteor) {
      this.meteor(cell, strength ?? 2, tick, true, out);
    } else if (kind === DisasterKind.Lightning) {
      // O raio do jogador sempre cai onde ele tocou e, em vegetação, sempre acende.
      this.lightning(cell, tick, true, out);
      if (canBurn(world, this.ground, cell)) this.startFire(cell, tick, true, 'raio');
    } else if (kind === DisasterKind.Tsunami) {
      const sea = nearestWater(world, cell, 12);
      if (sea >= 0) this.quake(sea, strength ?? 8.3 + 0.9 * this.rng.next(), tick, true, out);
    }
    out.marked = this.ground.takeChanged();
    return out;
  }

  /** Tensão (0–1, relativa ao limite) de cada célula de fronteira: camada "Ver tensão". */
  stressMap(out: Float32Array): void {
    out.fill(0);
    for (const f of this.faults.values()) {
      const v = Math.min(1, f.stress / f.threshold);
      for (const c of f.cells) out[c] = v;
    }
  }

  /**
   * Pontos quentes: a placa que passa por cima vai sendo erguida (sem aviso), na medida certa para
   * formar ilhas em fila; de vez em quando, uma erupção visível.
   */
  private hotspotGrowth(tick: number, plateRate: number, out: DisasterOutcome): void {
    const world = this.world;
    const year = tick / TICKS_PER_YEAR;
    for (let k = 0; k < this.hotspots.length; k++) {
      const p = this.hotspots[k] as Vec3;
      const cell = world.grid.pointToCell(p[0], p[1], p[2]);
      const continental = world.crust[cell] === Crust.Continental;
      if (year % HOTSPOT_YEARS === 0) {
        // Velocidade da placa no ponto (rad/ano) e quanto erguer para dar ~1 ilha por célula andada.
        const w = world.plates[world.plate[cell] as number]?.omega ?? [0, 0, 0];
        const v = Math.hypot(w[1] * p[2] - w[2] * p[1], w[2] * p[0] - w[0] * p[2], w[0] * p[1] - w[1] * p[0]) * MAX_PLATE_RATE * plateRate * TICKS_PER_YEAR;
        const cells = (v * HOTSPOT_YEARS) / world.grid.cellAngle;
        const travel = (this.hotspotTravel[k] ?? 0) + cells;
        this.hotspotTravel[k] = travel;
        const perYear = Math.min(HOTSPOT_MAX_PER_YEAR, (HOTSPOT_METERS_PER_CELL * cells) / HOTSPOT_YEARS);
        // Debaixo de continente o magma quase não sobe (vira planalto, não ilha).
        const meters = perYear * HOTSPOT_YEARS * hotspotPulse(travel) * (continental ? 0.25 : 1);
        if (meters > 1) out.uplifts.push({ point: p, radius: 1.3, meters });
      }
      // O vulcão do ponto quente anda com a placa: longe dele, apaga (fica o cone, na cadeia) e nasce
      // outro em cima do ponto quente.
      const v = this.volcanoes.find((x) => x.hotspot === k && !x.extinct);
      if (v && cellDistance(world, v.cell, cell) > v.cone + 1.5) {
        v.extinct = true;
        v.awake = false;
      }
      if ((!v || v.extinct) && !this.volcanoNear(cell, 2.5)) this.addVolcano(cell, 'hotspot', k, this.rng, out.terrain, tick);
    }
  }

  /** Um ano dos vulcões: acordam, entram em erupção, voltam a dormir. */
  private volcanoYear(tick: number, factor: number, out: DisasterOutcome): void {
    for (const v of this.volcanoes) {
      if (v.extinct) continue;
      if (!v.awake) {
        if (factor > 0 && tick >= v.until) this.wake(v, tick, false, out);
        continue;
      }
      if (tick >= v.until) {
        v.awake = false;
        v.until = nextWake(v, tick, factor, this.rng);
        continue;
      }
      if (tick >= v.nextEruption) this.erupt(v, this.sampleVolcanoVei(v), tick, false, false, out);
    }
  }

  /**
   * Vulcão acordado debaixo do gelo (C10): o calor derrete o gelo do cone e em volta (raio do cone + 2) e
   * a água do degelo desce de uma vez pelo terreno (jökulhlaup). O gelo volta ao clima décadas depois.
   */
  private meltUnderIce(v: Volcano, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const { cells, dist } = coneCells(world, v, v.cone + 2);
    const melted = cells.filter((c) => world.ice[c] && !world.isWater(c));
    if (!melted.length) return;
    out.ice.push({ cells: melted, mode: IceMode.Erased });
    this.iceReturn.add(melted, tick);
    if (melted.length < MELT_MIN_ICE) return;
    // A água sai pelo ponto mais baixo em volta do cone.
    let start = -1;
    cells.forEach((c, k) => {
      const d = dist[k] as number;
      if (d < v.cone || world.isWater(c)) return;
      if (start < 0 || (world.elevation[c] as number) < (world.elevation[start] as number)) start = c;
    });
    if (start < 0) return;
    const budget = Math.min(MELT_MAX_CELLS, MELT_CELLS_PER_ICE * melted.length);
    const cone = cells.filter((c, k) => (dist[k] as number) < v.cone && c !== start);
    this.start(new MeltwaterProcess(world, this.ground, start, cone, budget));
    this.event(DisasterKind.Flood, start, budget, budget >= NOTABLE_MELT_CELLS, manual, `Enchente do degelo · vulcão sob o gelo`, Math.sqrt(budget / Math.PI) + 1, tick, out);
  }

  /** IEV de uma erupção natural, pelo tipo: arco forte; ponto quente no oceano manso, no continente explosivo. */
  private sampleVolcanoVei(v: Volcano): number {
    if (v.kind === 'hotspot') {
      return this.world.crust[v.cell] === Crust.Continental ? sampleVei(this.rng.next(), 3, MAX_VEI) : sampleVei(this.rng.next(), 0, 2);
    }
    return sampleVei(this.rng.next(), 2, MAX_VEI);
  }

  /** O vulcão acorda (3–20 anos de erupções) e já entra em erupção. */
  private wake(v: Volcano, tick: number, manual: boolean, out: DisasterOutcome, vei = this.sampleVolcanoVei(v)): void {
    v.awake = true;
    v.until = tick + Math.round(this.rng.range(AWAKE_YEARS[0], AWAKE_YEARS[1]) * TICKS_PER_YEAR);
    this.erupt(v, vei, tick, manual, true, out);
  }

  /**
   * Erupção (R7): lava na cratera até o vulcão dormir, cone que cresce (o relevo sobe para sempre),
   * lava escorrendo pelo terreno (passo a passo), cinzas a favor do vento e raios nelas (IEV ≥ 4).
   */
  private erupt(v: Volcano, vei: number, tick: number, manual: boolean, waking: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const ground = this.ground;
    v.nextEruption = tick + Math.round(this.rng.range(ERUPTION_EVERY[0], ERUPTION_EVERY[1]) * TICKS_PER_YEAR);
    const { cells } = coneCells(world, v);
    const lavaYears = Math.max(1, (v.until - tick) / TICKS_PER_YEAR);
    for (const c of cells) if (ground.rock[c] === 255) ground.setState(c, CellState.Lava, tick, lavaYears, TICKS_PER_YEAR);
    // O cone cresce: os pequenos (ilhas, do jogador) ganham raio; todos ganham um pouco de altura.
    const from = { cone: v.cone, top: v.top };
    if (v.cone < 5 && v.kind !== 'arc' && this.rng.next() < 0.5) v.cone++;
    v.top += (v.cone - from.cone) * 380 + 15 * vei;
    const grown = growCone(world, ground, v, from);
    if (grown.cells.length) out.terrain.push(grown);
    this.meltUnderIce(v, tick, manual, out);
    this.start(
      new LavaProcess(
        world,
        ground,
        this.rng,
        v,
        lavaBudget(vei, this.rng),
        // A lava acende fogo na vegetação em que encosta.
        (c) => {
          if (this.rng.next() < LAVA_FIRE && canBurn(world, ground, c)) this.startFire(c, ground.tick, manual, 'lava');
        },
        (lc, ld) => {
          if (lc.length) this.stepOut?.terrain.push({ cells: lc, deltas: ld });
        },
        // Lava por cima de gelo: derrete (volta ao clima depois, devagar).
        (c) => {
          this.stepOut?.ice.push({ cells: [c], mode: IceMode.Erased });
          this.iceReturn.add([c], ground.tick);
        },
      ),
    );
    // Cinzas e raios na nuvem de cinzas.
    const plume = ashPlume(world, ground, v, vei, tick, this.rng);
    if (plume.length) {
      const bolts = this.rng.int(ASH_LIGHTNING[0], ASH_LIGHTNING[1]);
      for (let k = 0; k < bolts; k++) {
        const c = plume[this.rng.int(0, plume.length - 1)] as number;
        this.lightning(c, tick, manual, out);
        if (canBurn(world, ground, c) && this.rng.next() < ASH_LIGHTNING_FIRE) this.startFire(c, tick, manual, 'raio');
      }
    }
    const source = v.kind === 'hotspot' ? 'ponto quente' : v.kind === 'arc' ? 'arco vulcânico' : '';
    this.count(DisasterKind.Volcano);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Volcano,
      tick,
      point: cellPoint(world, v.cell),
      magnitude: vei,
      notable: vei >= NOTABLE_VEI,
      manual,
      label: `${waking ? 'Vulcão acordou' : 'Erupção'} (IEV ${vei})${source ? ` · ${source}` : ''}`,
      radius: (v.cone + 1) * world.grid.cellAngle,
    });
  }

  /** Desastres climáticos do ano: seca, enchente, furacão e incêndio (só sob seca). */
  private weather(tick: number, factor: number, out: DisasterOutcome): void {
    const world = this.world;
    const rng = this.rng;
    if (rng.next() < DROUGHT_CHANCE * factor) {
      // Mais provável onde já é seco.
      const c = pickCell(world, rng, (i) => !world.isWater(i) && !world.ice[i] && rng.next() > (world.precipitation[i] as number) / 2000);
      if (c >= 0) this.drought(c, tick, false, out);
    }
    if (rng.next() < FLOOD_CHANCE * factor) {
      const c = pickCell(world, rng, (i) => !world.isWater(i) && !world.ice[i] && world.heightAboveSea(i) < 300 && (world.precipitation[i] as number) > 900);
      if (c >= 0) this.flood(c, tick, false, out);
    }
    if (rng.next() < HURRICANE_CHANCE * factor) {
      const c = pickCell(world, rng, (i) => {
        const lat = Math.abs(latitudeOf(world, i));
        return world.isWater(i) && !world.ice[i] && lat >= HURRICANE_LAT[0] && lat <= HURRICANE_LAT[1] && (world.temperature[i] as number) >= HURRICANE_MIN_TEMP;
      });
      if (c >= 0) this.hurricane(c, sampleCategory(rng.next()), tick, false, out);
    }
    // Tempestade de areia: nasce num deserto (ou na seca).
    if (rng.next() < SANDSTORM_CHANCE * factor) {
      const c = pickSandstormCell(world, this.ground, rng);
      if (c >= 0) this.sandstorm(c, tick, false, out);
    }
    // Raios: caem debaixo das nuvens carregadas e, "secos", na seca; só os que acendem fogo contam.
    const strikes = LIGHTNING_PER_YEAR * factor;
    const n = Math.floor(strikes) + (rng.next() < strikes - Math.floor(strikes) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const c = pickLightningCell(world, this.ground, rng);
      if (c < 0 || rng.next() >= lightningIgnites(world, this.ground, c)) continue;
      this.lightning(c, tick, false, out);
      this.startFire(c, tick, false, 'raio');
    }
  }

  /**
   * Raio caindo na célula `c` (o clarão na tela; não vira aviso). Num vulcão adormecido, acorda ele (o
   * do jogador sempre; o natural, raramente).
   */
  private lightning(c: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    this.event(DisasterKind.Lightning, c, 1, false, manual, 'Raio', 1, tick, out);
    const v = this.volcanoNear(c, 5);
    if (!v || cellDistance(this.world, v.cell, c) > v.cone + 0.6) return;
    // A lava espirra (teste da 30e5e93): respingos no cone, que podem acender o mato em volta.
    this.spatter(v, tick, manual);
    if (v.awake || v.extinct) return;
    if (manual || (this.plateRate > 0 && this.rng.next() < LIGHTNING_WAKE)) this.wake(v, tick, manual, out);
  }

  /** Respingos de lava do raio: 4–8 células do cone com lava por pouco tempo; o mato em volta pode pegar fogo. */
  private spatter(v: Volcano, tick: number, manual: boolean): void {
    const world = this.world;
    const { cells } = coneCells(world, v, v.cone + 1.6);
    const land = cells.filter((x) => !world.isWater(x) && this.ground.rock[x] !== 255);
    const n = Math.min(land.length, this.rng.int(SPATTER_CELLS[0], SPATTER_CELLS[1]));
    for (let k = 0; k < n; k++) {
      const x = land.splice(this.rng.int(0, land.length - 1), 1)[0] as number;
      this.ground.damage(x, 1);
      this.ground.setState(x, CellState.Lava, tick, this.rng.range(0.3, 1), TICKS_PER_YEAR);
      for (let d = 0; d < 4; d++) {
        const j = world.grid.neighbors[x * 4 + d] as number;
        if (canBurn(world, this.ground, j) && this.rng.next() < LAVA_FIRE * 2) this.startFire(j, tick, manual, 'lava');
      }
    }
  }

  /** Começa um incêndio em `start` (anda passo a passo; o aviso sai quando apaga, se foi grande). */
  private startFire(start: number, tick: number, manual: boolean, cause: FireCause): void {
    const world = this.world;
    const fire = new FireProcess(
      world,
      this.ground,
      this.rng,
      start,
      tick,
      (burned) => {
        const out = this.stepOut;
        if (!out) return;
        const radius = Math.sqrt(burned / Math.PI) + 1;
        this.event(DisasterKind.Fire, start, burned, burned >= NOTABLE_FIRE_CELLS, manual, `Incêndio · ${areaLabel(burned, world.cellCount)} queimados`, radius, this.ground.tick, out);
        (out.events[out.events.length - 1] as DisasterEvent).cause = cause;
      },
      manual ? PLAYER_FIRE_BOOST : 1,
    );
    if (manual) {
      const p = cellPoint(world, start);
      fire.igniteAlso(world.grid.cellsInCap(p[0], p[1], p[2], PLAYER_FIRE_RADIUS * world.grid.cellAngle), tick);
    }
    this.start(fire);
  }

  /**
   * Seca (R4): região grande de borda irregular vira semiárido; a vegetação morre ano a ano (processo).
   * Mais longa onde já é seco.
   */
  private drought(center: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const radius = sampleDroughtRadius(this.rng, manual);
    const dryness = 1 - Math.min(1, (world.precipitation[center] as number) / 2000);
    const years = Math.round(DROUGHT_YEARS[0] + (DROUGHT_YEARS[1] - DROUGHT_YEARS[0]) * Math.min(1, this.rng.next() * 0.6 + dryness * 0.5));
    const started = startDrought(world, this.ground, center, radius, years, tick);
    if (!started) return;
    this.start(started.process);
    const cells = started.cells.length;
    this.event(DisasterKind.Drought, center, cells, radius >= NOTABLE_DROUGHT_RADIUS, manual, `Seca · ${areaLabel(cells, world.cellCount)}, ${years} anos`, radius, tick, out);
  }

  /**
   * Enchente (R4): a água sobe a partir do ponto mais baixo perto de `center`, pelo terreno baixo, em ~1 s
   * (processo); fica 1–3 anos e deixa solo fértil (numa bacia fechada, um lago).
   */
  private flood(center: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const start = lowestNear(world, this.ground, center);
    if (start < 0) return;
    const [lo, hi] = manual ? PLAYER_FLOOD_CELLS : FLOOD_CELLS;
    const maxCells = Math.round(lo + (hi - lo) * (manual ? this.rng.next() : this.rng.next() ** 2));
    const depth = this.rng.range(DEPTH[0], DEPTH[1]);
    const plan = floodPlan(world, this.ground, start, depth, maxCells);
    const years = this.rng.range(WET_YEARS[0], WET_YEARS[1]);
    this.start(new FloodProcess(world, this.ground, plan, tick, years, this.rng));
    const n = plan.cells.length;
    const radius = Math.sqrt(n / Math.PI) + 1;
    this.event(DisasterKind.Flood, start, n, n >= NOTABLE_FLOOD_CELLS, manual, `Enchente · ${areaLabel(n, world.cellCount)}${plan.closed ? ' · vai sobrar um lago' : ''}`, radius, tick, out);
  }

  /**
   * Furacão ou ciclone (R8): anda passo a passo; a chuva em terra dispara enchentes. No máximo 2 por quadrante (o do jogador só respeita o
   * total de 8).
   */
  private hurricane(start: number, category: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const point = cellPoint(world, start);
    const active = this.storms.filter((h) => h.view());
    if (active.length >= MAX_STORMS_WORLD) return;
    if (!manual && active.filter((h) => (h.view() as StormView).quadrant === quadrantOf(point)).length >= MAX_PER_QUADRANT) return;
    const h = new HurricaneProcess(world, this.ground, this.rng, start, category, tick, this.storms.filter((x) => x.startTick === tick).length, manual, {
      flood: (cell, t) => {
        const out2 = this.stepOut;
        if (out2) this.flood(cell, t, manual, out2);
      },
    });
    this.storms.push(h);
    this.start(h);
    const t = h.track;
    this.count(DisasterKind.Hurricane);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Hurricane,
      tick,
      point,
      magnitude: t.category,
      notable: t.landfall && t.category >= 4,
      manual,
      label: `${stormName(t.category)} categoria ${t.category}${t.landfall ? ' · vai tocar terra' : ''}`,
      radius: 0.04 + 0.012 * t.category,
    });
  }

  /**
   * Meteoro (C12): entra no céu (o risco na tela) e bate ENTRY_TICKS passos depois: cratera no relevo,
   * entulho, vegetação derrubada e incêndios; no mar, tsunami (médio para cima); o gigante esfria o
   * planeta por um tempo.
   */
  private meteor(cell: number, size: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const s = Math.max(1, Math.min(4, Math.round(size)));
    this.count(DisasterKind.Meteor);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Meteor,
      tick,
      point: cellPoint(world, cell),
      magnitude: s,
      notable: s >= 2,
      manual,
      label: `Meteoro ${METEOR_NAMES[s]}`,
      radius: (CRATER_RADIUS[s] as number) * world.grid.cellAngle,
    });
    this.start(
      new MeteorProcess(tick, (t) => {
        const o = this.stepOut;
        if (!o) return;
        const atSea = world.isWater(cell);
        const hit = impact(world, this.ground, cell, s, t, this.rng);
        if (hit.terrainCells.length) o.terrain.push({ cells: hit.terrainCells, deltas: hit.terrainDeltas });
        for (const f of hit.fires) if (canBurn(world, this.ground, f)) this.startFire(f, t, manual, 'meteoro');
        const m = SEA_TSUNAMI[s] as number;
        if (atSea && m > 0) {
          this.start(new TsunamiProcess(this.ground, planTsunami(world, cell, m), m, t, this.rng));
          this.count(DisasterKind.Tsunami);
          o.events.push({ id: this.nextId++, kind: DisasterKind.Tsunami, tick: t, point: cellPoint(world, cell), magnitude: m, notable: true, manual, label: `Tsunami do meteoro`, radius: tsunamiReach(m) });
        }
        if (s === 4) o.winters.push({ amount: GIANT_WINTER.amount, years: GIANT_WINTER.years });
      }),
    );
  }

  /** Tempestade de areia (C12): anda com o vento e deixa areia por cima da vegetação fora do deserto. */
  private sandstorm(cell: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    this.dust = this.dust.filter((x) => x.view());
    if (this.dust.length >= MAX_SANDSTORMS) return;
    const [lo, hi] = manual ? PLAYER_SAND_RADIUS : SAND_RADIUS;
    const radius = lo + Math.floor((hi - lo + 1) * (manual ? this.rng.next() : this.rng.next() ** 2));
    const p = new SandstormProcess(this.world, this.ground, cell, radius, this.rng, tick, this.dust.filter((x) => x.startTick === tick).length);
    // Perto do mar ela nasce menor (a poeira fica em terra, E4).
    const r = p.radiusCells;
    if (r <= 0) return;
    this.dust.push(p);
    this.start(p);
    this.event(DisasterKind.Sandstorm, cell, r, r >= NOTABLE_SAND_RADIUS, manual, `Tempestade de areia · ${areaLabel(Math.round(Math.PI * r * r), this.world.cellCount)}`, r, tick, out);
  }

  /** Tempestades de areia andando agora (para o desenho). */
  dustViews(): DustView[] {
    this.dust = this.dust.filter((x) => x.view());
    return this.dust.map((x) => x.view() as DustView);
  }

  /** Furacões e ciclones andando agora (para o desenho). */
  stormViews(): StormView[] {
    this.storms = this.storms.filter((h) => h.view());
    return this.storms.map((h) => h.view() as StormView);
  }

  /** Evento simples (centro, área em células, raio em células). */
  private event(kind: DisasterKind, cell: number, area: number, notable: boolean, manual: boolean, label: string, radiusCells: number, tick: number, out: DisasterOutcome): void {
    this.count(kind);
    out.events.push({ id: this.nextId++, kind, tick, point: cellPoint(this.world, cell), magnitude: area, notable, manual, label, radius: radiusCells * this.world.grid.cellAngle });
  }

  /** Erupção numa dorsal: ergue o fundo do mar (sem cone nem lava à vista). */
  private ridgeEruption(cell: number, vei: number, tick: number, out: DisasterOutcome): void {
    const world = this.world;
    const point = cellPoint(world, cell);
    const up = eruptionUplift(vei);
    out.uplifts.push({ point, radius: up.radius, meters: up.meters });
    this.count(DisasterKind.Volcano);
    out.events.push({ id: this.nextId++, kind: DisasterKind.Volcano, tick, point, magnitude: vei, notable: vei >= NOTABLE_VEI, manual: false, label: `Erupção IEV ${vei} · dorsal`, radius: up.radius * world.grid.cellAngle });
  }

  private count(kind: DisasterKind): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  private quake(cell: number, m: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const point = cellPoint(world, cell);
    // O que o tremor faz no chão (R5): fenda, deslizamentos (relevo para sempre) e vegetação.
    const damage = quakeDamage(world, this.ground, cell, m, tick, this.rng);
    if (damage.terrainCells.length) out.terrain.push({ cells: damage.terrainCells, deltas: damage.terrainDeltas });
    this.count(DisasterKind.Quake);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Quake,
      tick,
      point,
      magnitude: m,
      notable: m >= NOTABLE_MAGNITUDE,
      manual,
      label: `Terremoto M ${decimal(m)}`,
      radius: feltRadius(m),
    });
    if (m < TSUNAMI_MIN_MAGNITUDE || !world.isWater(cell)) return;
    // Tsunami (R6): anda passo a passo nas células (recuo, espuma, água em terra, lama, costa raspada).
    const plan = planTsunami(world, cell, m);
    this.start(new TsunamiProcess(this.ground, plan, m, tick, this.rng));
    this.count(DisasterKind.Tsunami);
    const coast = new Set(plan.land.filter((_, k) => plan.landSteps[k] === 0)).size;
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Tsunami,
      tick,
      point,
      magnitude: m,
      notable: true,
      manual,
      label: coast ? `Tsunami M ${decimal(m)} · ${coast} células de costa` : `Tsunami M ${decimal(m)}`,
      radius: tsunamiReach(m),
    });
  }
}

export function cellPoint(world: WorldState, c: number): Vec3 {
  const p = world.grid.positions;
  return [p[c * 3] as number, p[c * 3 + 1] as number, p[c * 3 + 2] as number];
}

/** Célula de mar mais perto de `from` (até `steps` passos), ou −1. */
export function nearestWater(world: WorldState, from: number, steps: number): number {
  return nearest(world, from, steps, (c) => world.isWater(c));
}

/** Célula mais perto de `from` (até `steps` passos) que cumpre `ok`, ou −1. */
export function nearest(world: WorldState, from: number, steps: number, ok: (c: number) => boolean): number {
  if (ok(from)) return from;
  const { neighbors } = world.grid;
  const seen = new Set([from]);
  let frontier = [from];
  for (let s = 0; s < steps && frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (seen.has(j)) continue;
        if (ok(j)) return j;
        seen.add(j);
        next.push(j);
      }
    }
    frontier = next;
  }
  return -1;
}

/** Distância em células entre duas células. */
export function cellDistance(world: WorldState, a: number, b: number): number {
  const p = world.grid.positions;
  const dot = (p[a * 3] as number) * (p[b * 3] as number) + (p[a * 3 + 1] as number) * (p[b * 3 + 1] as number) + (p[a * 3 + 2] as number) * (p[b * 3 + 2] as number);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / world.grid.cellAngle;
}
