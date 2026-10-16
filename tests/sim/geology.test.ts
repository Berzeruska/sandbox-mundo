import { describe, expect, it } from 'vitest';
import { Tool } from '../../src/input/tools';
import { SimulationCore, type GeologyPort } from '../../src/sim/core';
import { APPLY_DELAY_TICKS, GeologyEngine, type GeologyCommand, type GeologyEvent, type GeologyInit } from '../../src/sim/geology';
import type { FromWorker } from '../../src/sim/protocol';
import type { CubeSphere } from '../../src/world/cubesphere';
import { latLonToPoint } from '../../src/world/cubesphere';

/**
 * Motor da geologia "no ajudante" de mentira: calcula na hora, mas as respostas só chegam ao relógio
 * quando o teste manda (`deliver`). Imita o ajudante 2 atrasado sem depender do relógio real.
 */
class DeferredGeology implements GeologyPort {
  readonly perTick = false;
  readonly bytes = 0;
  engine: GeologyEngine | null = null;
  private outbox: GeologyEvent[] = [];
  results: { index: number; tick: number }[] = [];

  constructor(private core: SimulationCore) {}

  start(init: GeologyInit, grid: CubeSphere): void {
    this.outbox = [];
    this.engine = new GeologyEngine(init, grid, (event) => {
      if (event.type === 'result') this.results.push({ index: event.result.index, tick: event.result.tick });
      this.outbox.push(event);
    }, () => 0);
    this.core.onGeologyBuffers(this.engine.buffers);
  }

  send(cmd: GeologyCommand): void {
    this.engine?.receive(cmd);
  }

  /** Entrega ao relógio as respostas guardadas (todas, ou as `count` mais antigas). */
  deliver(count = Infinity): void {
    const now = this.outbox.splice(0, count);
    for (const e of now) this.core.onGeologyEvent(e);
  }
}

const N = 32;
const SEED = 'ajudante';

/**
 * Comandos do jogador em passos fixos. Com esta semente a 1ª recomposição é no passo 6.467 e aparece
 * no 6.947: as pinceladas de 6.600 e 6.700 caem na janela de espera; a de 12.100 cai na janela da
 * ruptura forçada (12.000 → 12.480).
 */
const SCRIPT: Record<number, (core: SimulationCore) => void> = {
  1: (c) => c.handle({ type: 'plateRate', rate: 1 }),
  900: (c) => c.handle({ type: 'brush', tool: Tool.Raise, point: latLonToPoint(0.1, 0.2), radius: 4, dt: 1.5 }),
  4000: (c) => c.handle({ type: 'brush', tool: Tool.Ice, point: latLonToPoint(0.5, -1), radius: 3, dt: 0.2 }),
  6600: (c) => c.handle({ type: 'brush', tool: Tool.Raise, point: latLonToPoint(-0.3, 1.1), radius: 5, dt: 2 }),
  6700: (c) => c.handle({ type: 'brush', tool: Tool.Lower, point: latLonToPoint(-0.3, 1.1), radius: 3, dt: 0.5 }),
  6750: (c) => c.handle({ type: 'brush', tool: Tool.EraseIce, point: latLonToPoint(0.5, -1), radius: 2, dt: 0.2 }),
  9000: (c) => c.handle({ type: 'plateRate', rate: 0.6 }),
  12_000: (c) => c.handle({ type: 'forceRupture' }),
  12_100: (c) => c.handle({ type: 'brush', tool: Tool.Water, point: latLonToPoint(0.2, 2.5), radius: 4, dt: 0.2 }),
};
const END = 26_000;

function makeCore(port?: (core: SimulationCore) => GeologyPort) {
  const inbox: FromWorker[] = [];
  const core = new SimulationCore((msg) => inbox.push(msg), () => 0, port);
  core.handle({ type: 'newWorld', seedText: SEED, n: N });
  core.handle({ type: 'speed', speed: 20 });
  return { core, inbox };
}

/**
 * Roda o roteiro até END. `deliverEvery`: de quantas em quantas chamadas o motor "responde"; se o
 * relógio parar de andar (esperando o motor), entrega tudo.
 */
function run(port: ((core: SimulationCore) => GeologyPort) | undefined, deliverEvery = 1) {
  const { core, inbox } = makeCore(port);
  const deferred = core.geology instanceof DeferredGeology ? core.geology : null;
  let calls = 0;
  let maxLead = 0;
  let stalls = 0;
  const done = new Set<number>();
  while (core.clock.tick < END) {
    const action = SCRIPT[core.clock.tick];
    // Cada comando uma vez só (o relógio pode ficar parado no mesmo passo esperando o motor).
    if (action && !done.has(core.clock.tick)) {
      done.add(core.clock.tick);
      action(core);
    }
    // Avança no máximo até o próximo comando do roteiro (para cada um acontecer no passo exato).
    const next = Math.min(END, ...Object.keys(SCRIPT).map(Number).filter((t) => t > core.clock.tick));
    const want = Math.min(60, next - core.clock.tick) - core.clock.backlog;
    const before = core.clock.tick;
    core.advance(Math.max(0, want) / 240 + 1e-12);
    calls++;
    if (deferred) {
      maxLead = Math.max(maxLead, core.clock.tick - deferred.engine!.tick);
      if (core.clock.tick === before) {
        stalls++;
        deferred.deliver();
      } else if (calls % deliverEvery === 0) deferred.deliver();
    }
  }
  return { core, inbox, maxLead, stalls, deferred };
}

describe('ajudante 2 "Terra" (correção 2)', () => {
  it('a recomposição aparece exatamente APPLY_DELAY_TICKS passos depois de feita', () => {
    const { core, inbox } = makeCore((c) => new DeferredGeology(c));
    const port = core.geology as DeferredGeology;
    core.handle({ type: 'plateRate', rate: 1 });
    const shownAt: number[] = [];
    let seen = 0;
    while (port.results.length < 3) {
      core.advance(1 / 240 + 1e-12); // um passo por chamada
      port.deliver();
      const count = inbox.filter((m) => m.type === 'recomposed').length;
      if (count > seen) {
        seen = count;
        shownAt.push(core.clock.tick);
      }
    }
    for (let k = 0; k < 2; k++) expect(shownAt[k]).toBe((port.results[k] as { tick: number }).tick + APPLY_DELAY_TICKS);
  });

  it('o mundo é o mesmo com o motor no relógio ou num ajudante atrasado (determinístico)', () => {
    const local = run(undefined);
    const late = run((c) => new DeferredGeology(c), 5);
    const veryLate = run((c) => new DeferredGeology(c), 1_000_000);
    for (const other of [late, veryLate]) {
      expect(other.core.clock.tick).toBe(END);
      expect(other.core.world!.elevation).toEqual(local.core.world!.elevation);
      expect(other.core.world!.plate).toEqual(local.core.world!.plate);
      expect(other.core.world!.iceMode).toEqual(local.core.world!.iceMode);
      expect(other.core.colors).toEqual(local.core.colors);
    }
    expect(local.core.tectonics!.recompositions).toBeGreaterThanOrEqual(3);
    // O ajudante "muito atrasado" fez o relógio esperar, mas nunca mais que APPLY_DELAY_TICKS à frente.
    expect(veryLate.stalls).toBeGreaterThan(0);
    expect(veryLate.maxLead).toBeLessThanOrEqual(APPLY_DELAY_TICKS);
  });

  it('pincelada feita enquanto a recomposição está no ajudante não some quando ela aparece', () => {
    const { core } = makeCore((c) => new DeferredGeology(c));
    const port = core.geology as DeferredGeology;
    core.handle({ type: 'plateRate', rate: 1 });
    // Anda até haver uma recomposição pronta e ainda não mostrada.
    while (port.results.length === 0) {
      core.advance(1 / 240 + 1e-12);
      port.deliver();
    }
    const p = latLonToPoint(0.05, 0.3);
    const cell = core.world!.grid.pointToCell(p[0], p[1], p[2]);
    core.handle({ type: 'brush', tool: Tool.Raise, point: p, radius: 3, dt: 3 });
    const painted = core.world!.elevation[cell]!;
    const shown = (port.results[0] as { tick: number }).tick + APPLY_DELAY_TICKS;
    while (core.clock.tick <= shown) {
      core.advance(1 / 240 + 1e-12);
      port.deliver();
    }
    // A placa andou até ~3 células: o morro está perto de onde foi pintado, com a mesma altura.
    const near = core.world!.grid.cellsInCap(p[0], p[1], p[2], 4 * core.world!.grid.cellAngle);
    expect(Math.max(...near.map((c) => core.world!.elevation[c]!))).toBeCloseTo(painted, 0);
  });
});

describe('relógio esperando o ajudante', () => {
  it('conta o tempo parado esperando o motor (para o "Medir desempenho")', () => {
    let now = 0;
    const core = new SimulationCore(() => undefined, () => now, (c) => new DeferredGeology(c));
    core.handle({ type: 'newWorld', seedText: SEED, n: N });
    core.handle({ type: 'speed', speed: 20 });
    // Sem respostas do motor, o relógio anda APPLY_DELAY_TICKS passos e para.
    for (let i = 0; i < 40; i++) {
      now += 250;
      core.advance(0.25);
    }
    expect(core.clock.tick).toBe(APPLY_DELAY_TICKS);
    (core.geology as DeferredGeology).deliver();
    now += 250;
    core.advance(0.25);
    expect(core.clock.tick).toBeGreaterThan(APPLY_DELAY_TICKS);
    expect(core.work.waitMs).toBeGreaterThan(0);
  });
});
