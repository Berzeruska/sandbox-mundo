import { createRng, type Rng } from '../../core/rng';
import { TICKS_PER_YEAR } from '../../core/time';
import type { Vec3 } from '../cubesphere';
import type { WorldState } from '../state';
import { Disturbance, Mark, MARK_YEARS } from './disturbance';
import { buildFaults, type Fault, feltRadius, MAX_MAGNITUDE, NOTABLE_MAGNITUDE, sampleMagnitude, stressDrop, yearlyStress } from './quakes';
import { propagateTsunami, TSUNAMI_MIN_MAGNITUDE, tsunamiReach, wavePoints } from './tsunami';
import { decimal, DEFAULT_FREQUENCY, DisasterKind, FREQUENCIES, type DisasterEvent } from './types';

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
  private nextId = 1;
  /** Contagem por tipo (para testes e o painel). */
  readonly counts = new Array<number>(7).fill(0);

  constructor(private world: WorldState) {
    this.rng = createRng((world.params.seed ^ 0x6d15a57e) >>> 0);
    this.disturbance = new Disturbance(world.cellCount);
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
    if (factor > 0 && plateRate > 0) {
      for (const f of this.faults.values()) {
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
    return out.events.length || out.marked.length ? out : null;
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
  if (world.isWater(from)) return from;
  const { neighbors } = world.grid;
  const seen = new Set([from]);
  let frontier = [from];
  for (let s = 0; s < steps && frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const j = neighbors[c * 4 + d] as number;
        if (seen.has(j)) continue;
        if (world.isWater(j)) return j;
        seen.add(j);
        next.push(j);
      }
    }
    frontier = next;
  }
  return -1;
}
