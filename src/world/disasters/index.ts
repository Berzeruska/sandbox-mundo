import { createRng, type Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { Disturbance, Mark, MARK_YEARS } from './disturbance';
import { buildFaults, type Fault, feltRadius, MAX_MAGNITUDE, NOTABLE_MAGNITUDE, sampleMagnitude, stressDrop, yearlyStress } from './quakes';
import { propagateTsunami, TSUNAMI_MIN_MAGNITUDE, tsunamiReach, wavePoints } from './tsunami';
import { areaLabel, decimal, DEFAULT_FREQUENCY, DisasterKind, FREQUENCIES, type DisasterEvent } from './types';
import {
  DROUGHT_CHANCE,
  FIRE_CHANCE,
  FLOOD_CHANCE,
  FOREST_BIOMES,
  HURRICANE_CHANCE,
  HURRICANE_LAT,
  HURRICANE_MIN_TEMP,
  hurricaneTrack,
  landAround,
  latitudeOf,
  pickCell,
  sampleCategory,
  spreadFire,
} from './weather';
import {
  ashRadius,
  ERUPTIONS_PER_YEAR,
  eruptionUplift,
  HOTSPOT_ERUPTION_CHANCE,
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
export { Mark } from './disturbance';

/** Relevo erguido por um desastre (erupção): o relógio aplica como um pincel de Elevar. */
export interface Uplift {
  point: Vec3;
  /** Raio (células) e altura no centro (m). */
  radius: number;
  meters: number;
}

/** O que os desastres de um passo fizeram: o relógio aplica e avisa a tela. */
export interface DisasterOutcome {
  events: DisasterEvent[];
  /** Células cuja marca mudou (repintar). */
  marked: number[];
  uplifts: Uplift[];
}

/**
 * Desastres do mundo (T8–T12): vivem no relógio e andam com o passo do jogo; sorteios próprios, na ordem
 * dos passos (mesma semente + mesmos comandos = mesmos desastres). Os naturais são sorteados uma vez
 * por ano de jogo; os do jogador acontecem no passo em que chegam.
 */
export class Disasters {
  readonly disturbance: Disturbance;
  /** Nível de frequência (índice de FREQUENCIES). */
  frequency = DEFAULT_FREQUENCY;
  private rng: Rng;
  private faults = new Map<number, Fault>();
  /** Pontos quentes (fixos no manto: direções no mundo) e quanto (células) a placa já andou por cima. */
  hotspots: Vec3[];
  private hotspotTravel: number[] = [];
  /** Secas em curso: as células de floresta dentro delas (onde pode pegar fogo) e até quando. */
  private droughts: { forest: number[]; since: number; until: number }[] = [];
  private nextId = 1;
  /** Contagem por tipo (para testes e o painel). */
  readonly counts = new Array<number>(7).fill(0);

  constructor(private world: WorldState) {
    this.rng = createRng((world.params.seed ^ 0x6d15a57e) >>> 0);
    this.disturbance = new Disturbance(world.cellCount);
    this.hotspots = makeHotspots(createRng((world.params.seed ^ 0x40750f07) >>> 0));
    this.onRecompose();
  }

  /** Fronteiras novas (depois de cada recomposição): refaz os trechos, a tensão continua. */
  onRecompose(): void {
    this.faults = buildFaults(this.world, this.faults, this.rng);
  }

  /**
   * Um passo do jogo. Os desastres naturais só correm com as placas andando (`plateRate` > 0: "em 0 a
   * geologia congela").
   */
  step(tick: number, plateRate: number): DisasterOutcome | null {
    if (tick % TICKS_PER_YEAR !== 0) return null;
    const out: DisasterOutcome = { events: [], marked: this.disturbance.expire(tick), uplifts: [] };
    const factor = FREQUENCIES[this.frequency]?.factor ?? 0;
    if (plateRate > 0) this.hotspotGrowth(tick, plateRate, factor, out);
    // Clima: continua com as placas paradas.
    if (factor > 0) this.weather(tick, factor, out);
    if (factor > 0 && plateRate > 0) {
      for (const f of this.faults.values()) {
        // Erupção num arco (forte) ou numa dorsal (fraca).
        const rate = ERUPTIONS_PER_YEAR[f.type];
        if (rate && this.rng.next() < rate * f.length * f.speed * factor) {
          const cell = ventCell(this.world, f.cells[this.rng.int(0, f.cells.length - 1)] as number, f.type, this.rng);
          const vei = f.type === Boundary.Convergent ? sampleVei(this.rng.next(), 2, MAX_VEI) : sampleVei(this.rng.next(), 0, 2);
          this.eruption(cell, vei, tick, false, f.type === Boundary.Convergent ? 'arco vulcânico' : 'dorsal', out);
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
    return out.events.length || out.marked.length || out.uplifts.length ? out : null;
  }

  /** Desastre provocado pelo jogador no ponto `point` (funciona com qualquer frequência). */
  trigger(kind: DisasterKind, point: Vec3, tick: number): DisasterOutcome {
    const out: DisasterOutcome = { events: [], marked: [], uplifts: [] };
    const world = this.world;
    const cell = world.grid.pointToCell(point[0], point[1], point[2]);
    if (kind === DisasterKind.Quake) {
      // Do jogador: sempre forte (7 a 9), do tamanho que a fronteira mais perto permite.
      const max = Math.max(8, MAX_MAGNITUDE[world.boundary[cell] as number] ?? 8.5);
      this.quake(cell, 7 + (max - 7) * this.rng.next(), tick, true, out);
    } else if (kind === DisasterKind.Volcano) {
      // Do jogador: sempre forte (IEV 4 a 6) e ergue mais (no mar raso já vira ilha).
      this.eruption(cell, 4 + this.rng.int(0, 2), tick, true, '', out, 900);
    } else if (kind === DisasterKind.Drought) {
      if (!world.isWater(cell)) this.drought(cell, tick, true, out);
    } else if (kind === DisasterKind.Flood) {
      if (!world.isWater(cell)) this.flood(cell, tick, true, out);
    } else if (kind === DisasterKind.Hurricane) {
      const sea = nearestWater(world, cell, 12);
      if (sea >= 0) this.hurricane(sea, 3 + this.rng.int(0, 2), tick, true, out);
    } else if (kind === DisasterKind.Fire) {
      const forest = nearest(world, cell, 6, (c) => FOREST_BIOMES.has(world.biome[c] as number) && !world.ice[c]);
      if (forest >= 0) this.fire(forest, 40 + this.rng.int(0, 110), tick, true, () => true, out);
    } else if (kind === DisasterKind.Tsunami) {
      const sea = nearestWater(world, cell, 12);
      if (sea >= 0) this.quake(sea, 8.3 + 0.9 * this.rng.next(), tick, true, out);
    }
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
  private hotspotGrowth(tick: number, plateRate: number, factor: number, out: DisasterOutcome): void {
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
      // Debaixo de continente a erupção é rara (o magma junta por muito tempo) e explosiva.
      if (factor > 0 && this.rng.next() < HOTSPOT_ERUPTION_CHANCE * factor * (continental ? 0.15 : 1)) {
        // No oceano, lava mansa (IEV 0–2); debaixo de continente, rara e explosiva (IEV 3–7).
        const vei = continental ? sampleVei(this.rng.next(), 3, MAX_VEI) : sampleVei(this.rng.next(), 0, 2);
        this.eruption(cell, vei, tick, false, 'ponto quente', out);
      }
    }
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
    this.droughts = this.droughts.filter((d) => d.until > tick && d.forest.length);
    for (const d of this.droughts) {
      // O fogo vem com a seca já instalada (a partir do ano seguinte).
      if (d.since >= tick || rng.next() >= FIRE_CHANCE * factor) continue;
      const dry = (c: number) => this.disturbance.kind[c] === Mark.Dry;
      const start = d.forest[rng.int(0, d.forest.length - 1)] as number;
      if (!dry(start) || !FOREST_BIOMES.has(world.biome[start] as number)) continue;
      // Tamanho log-uniforme: muitos pequenos, poucos enormes.
      this.fire(start, Math.round(Math.exp(rng.next() * Math.log(300))), tick, false, dry, out);
    }
  }

  private drought(center: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    // Raio de 5 a 13 células, os grandes raros (u²); a do jogador sempre grande.
    const radius = manual ? this.rng.int(10, 13) : 5 + Math.floor(9 * this.rng.next() ** 2);
    const years = this.rng.int(5, 15);
    const cells = landAround(world, center, radius);
    if (!cells.length) return;
    for (const c of cells) {
      this.disturbance.mark(c, Mark.Dry, tick, years, TICKS_PER_YEAR);
      out.marked.push(c);
    }
    this.droughts.push({ forest: cells.filter((c) => FOREST_BIOMES.has(world.biome[c] as number)), since: tick, until: tick + years * TICKS_PER_YEAR });
    this.event(DisasterKind.Drought, center, cells.length, radius >= 12, manual, `Seca · ${areaLabel(cells.length, world.cellCount)}, ${years} anos`, radius, tick, out);
  }

  private flood(center: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const radius = manual ? this.rng.int(6, 8) : 3 + Math.floor(6 * this.rng.next() ** 2);
    const cells = landAround(world, center, radius, (c) => world.heightAboveSea(c) < 250);
    if (!cells.length) return;
    const years = this.rng.int(2, 5);
    for (const c of cells) {
      this.disturbance.mark(c, Mark.Flood, tick, years, TICKS_PER_YEAR);
      out.marked.push(c);
    }
    this.event(DisasterKind.Flood, center, cells.length, cells.length >= 110, manual, `Enchente · ${areaLabel(cells.length, world.cellCount)}`, radius, tick, out);
  }

  private hurricane(start: number, category: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const t = hurricaneTrack(world, start, category, this.rng);
    // Chuva forte onde ele passa em terra: terra baixa alaga por uns anos.
    const seen = new Set<number>();
    for (const c of t.landCells) {
      for (const j of landAround(world, c, 2, (i) => world.heightAboveSea(i) < 150)) {
        if (seen.has(j)) continue;
        seen.add(j);
        this.disturbance.mark(j, Mark.Flood, tick, 3, TICKS_PER_YEAR);
        out.marked.push(j);
      }
    }
    const n = t.points.length;
    const path = new Float32Array(n * 3);
    const times = new Float32Array(n);
    const strength = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      path.set(t.points[k] as Vec3, k * 3);
      times[k] = n > 1 ? k / (n - 1) : 0;
      strength[k] = t.strength[k] as number;
    }
    this.count(DisasterKind.Hurricane);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Hurricane,
      tick,
      point: cellPoint(world, start),
      magnitude: t.category,
      notable: t.landfall && t.category >= 4,
      manual,
      label: `Furacão categoria ${t.category}${t.landfall ? ' · tocou terra' : ''}`,
      radius: 0.04 + 0.012 * t.category,
      path,
      times,
      strength,
    });
  }

  private fire(start: number, size: number, tick: number, manual: boolean, dry: (c: number) => boolean, out: DisasterOutcome): void {
    const world = this.world;
    const burned = spreadFire(world, start, size, dry);
    for (const c of burned) {
      this.disturbance.mark(c, Mark.Burned, tick, MARK_YEARS[Mark.Burned], TICKS_PER_YEAR);
      out.marked.push(c);
    }
    const radius = Math.sqrt(burned.length / Math.PI) + 1;
    this.event(DisasterKind.Fire, start, burned.length, burned.length >= 60, manual, `Incêndio · ${areaLabel(burned.length, world.cellCount)} queimados`, radius, tick, out);
  }

  /** Evento simples (centro, área em células, raio em células). */
  private event(kind: DisasterKind, cell: number, area: number, notable: boolean, manual: boolean, label: string, radiusCells: number, tick: number, out: DisasterOutcome): void {
    this.count(kind);
    out.events.push({ id: this.nextId++, kind, tick, point: cellPoint(this.world, cell), magnitude: area, notable, manual, label, radius: radiusCells * this.world.grid.cellAngle });
  }

  /** Erupção: ergue o terreno para sempre e espalha cinzas em terra. */
  private eruption(cell: number, vei: number, tick: number, manual: boolean, source: string, out: DisasterOutcome, extraMeters = 0): void {
    const world = this.world;
    const point = cellPoint(world, cell);
    const up = eruptionUplift(vei);
    out.uplifts.push({ point, radius: up.radius, meters: up.meters + extraMeters });
    const ash = ashRadius(vei);
    for (const c of world.grid.cellsInCap(point[0], point[1], point[2], ash * world.grid.cellAngle)) {
      if (world.isWater(c)) continue;
      this.disturbance.mark(c, Mark.Ash, tick, MARK_YEARS[Mark.Ash], TICKS_PER_YEAR);
      out.marked.push(c);
    }
    this.count(DisasterKind.Volcano);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Volcano,
      tick,
      point,
      magnitude: vei,
      notable: vei >= NOTABLE_VEI,
      manual,
      label: `Erupção IEV ${vei}${source ? ` · ${source}` : ''}`,
      radius: ash * world.grid.cellAngle,
    });
  }

  private count(kind: DisasterKind): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  private quake(cell: number, m: number, tick: number, manual: boolean, out: DisasterOutcome): void {
    const world = this.world;
    const point = cellPoint(world, cell);
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
    const r = propagateTsunami(world, cell, m);
    for (const c of r.flooded) {
      this.disturbance.mark(c, Mark.Flood, tick, MARK_YEARS[Mark.Flood], TICKS_PER_YEAR);
      out.marked.push(c);
    }
    const wave = wavePoints(world, r);
    this.count(DisasterKind.Tsunami);
    out.events.push({
      id: this.nextId++,
      kind: DisasterKind.Tsunami,
      tick,
      point,
      magnitude: m,
      notable: true,
      manual,
      label: r.flooded.length ? `Tsunami · ${r.flooded.length} células de costa alagadas` : 'Tsunami',
      radius: tsunamiReach(m),
      path: wave.path,
      times: wave.times,
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
