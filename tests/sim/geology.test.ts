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
      // Só as recomposições (as entregas só de clima, T7, também passam pelo outbox).
      if (event.type === 'result' && event.result.kind === 'recompose') this.results.push({ index: event.result.index, tick: event.result.tick });
      this.outbox.push(event);
    }, () => 0);
    this.core.onGeologyBuffers(this.engine.buffers);
  }

  send(cmd: GeologyCommand): void {
    this.engine?.receive(cmd);
  }

  stop(): void {
    this.engine = null;
    this.outbox = [];
    this.stops++;
  }

  stops = 0;

  /** Entrega ao relógio as respostas guardadas (todas, ou as `count` mais antigas). */
  deliver(count = Infinity): void {
    const now = this.outbox.splice(0, count);
    for (const e of now) this.core.onGeologyEvent(e);
  }
}

const N = 32;
const SEED = 'ajudante';

const RATE_CHANGE = 9000;
const RUPTURE = 12_000;

/** Passo das primeiras recomposições com este roteiro de placas (o pincel não muda quando elas vêm). */
function recompositionTicks(): number[] {
  const inbox: FromWorker[] = [];
  const core = new SimulationCore((msg) => inbox.push(msg), () => 0, (c) => new DeferredGeology(c));
  const port = core.geology as DeferredGeology;
  core.handle({ type: 'newWorld', seedText: SEED, n: N });
  core.handle({ type: 'speed', speed: 20 });
  core.handle({ type: 'plateRate', rate: 1 });
  while (core.clock.tick < RATE_CHANGE) {
    core.advance(Math.min(60, RATE_CHANGE - core.clock.tick) / 240 + 1e-12);
    port.deliver();
  }
  return port.results.map((r) => r.tick);
}

/**
 * Comandos do jogador em passos fixos. As pinceladas caem dentro da janela de espera da 1ª
 * recomposição (entre ela e o mundo novo aparecer, APPLY_DELAY_TICKS passos depois) e na da ruptura
 * forçada; outras caem fora das janelas.
 */
function script(first: number): Record<number, (core: SimulationCore) => void> {
  return {
    1: (c) => c.handle({ type: 'plateRate', rate: 1 }),
    900: (c) => c.handle({ type: 'brush', tool: Tool.Raise, point: latLonToPoint(0.1, 0.2), radius: 4, dt: 1.5 }),
    4000: (c) => c.handle({ type: 'brush', tool: Tool.Ice, point: latLonToPoint(0.5, -1), radius: 3, dt: 0.2 }),
    [first + 130]: (c) => c.handle({ type: 'brush', tool: Tool.Raise, point: latLonToPoint(-0.3, 1.1), radius: 5, dt: 2 }),
    [first + 230]: (c) => c.handle({ type: 'brush', tool: Tool.Lower, point: latLonToPoint(-0.3, 1.1), radius: 3, dt: 0.5 }),
    [first + 280]: (c) => c.handle({ type: 'brush', tool: Tool.EraseIce, point: latLonToPoint(0.5, -1), radius: 2, dt: 0.2 }),
    [RATE_CHANGE]: (c) => c.handle({ type: 'plateRate', rate: 0.6 }),
    [RUPTURE]: (c) => c.handle({ type: 'forceRupture' }),
    [RUPTURE + 100]: (c) => c.handle({ type: 'brush', tool: Tool.Water, point: latLonToPoint(0.2, 2.5), radius: 4, dt: 0.2 }),
  };
}
const END = 30_000;

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
function run(SCRIPT: Record<number, (core: SimulationCore) => void>, port: ((core: SimulationCore) => GeologyPort) | undefined, deliverEvery = 1) {
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
    const first = recompositionTicks()[0] as number;
    expect(first).toBeGreaterThan(1000);
    expect(first + 300).toBeLessThan(RATE_CHANGE);
    const SCRIPT = script(first);
    const local = run(SCRIPT, undefined);
    const late = run(SCRIPT, (c) => new DeferredGeology(c), 5);
    const veryLate = run(SCRIPT, (c) => new DeferredGeology(c), 1_000_000);
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

describe('mundo novo com o ajudante ocupado', () => {
  it('o motor velho é largado antes da geração, e respostas atrasadas dele não chegam ao mundo novo', () => {
    const core = new SimulationCore(() => undefined, () => 0, (c) => new DeferredGeology(c));
    const port = core.geology as DeferredGeology;
    core.handle({ type: 'newWorld', seedText: SEED, n: N });
    core.handle({ type: 'speed', speed: 20 });
    core.handle({ type: 'plateRate', rate: 1 });
    // O motor anda e faz uma recomposição, que ainda espera a vez de aparecer no relógio.
    while (port.results.length === 0) {
      core.advance(60 / 240);
      port.deliver();
    }
    const old = port.engine;
    core.handle({ type: 'newWorld', seedText: 'outro', n: N });
    expect(port.stops).toBe(2);
    expect(port.engine).not.toBe(old);
    port.results.length = 0;
    // Mundo novo começa limpo: nenhuma recomposição do velho aparece nele. Sem desastres (os pontos
    // quentes erguem o terreno com as placas andando, de propósito; aqui só interessa o vazamento).
    core.handle({ type: 'disasterFrequency', level: 0 });
    core.disasters!.hotspots = [];
    core.handle({ type: 'speed', speed: 20 });
    const fresh = Array.from(core.world!.elevation);
    for (let i = 0; i < 4; i++) {
      core.advance(APPLY_DELAY_TICKS / 240);
      port.deliver();
    }
    expect(core.world!.params.seedText).toBe('outro');
    // Nenhuma recomposição apareceu ainda (o motor novo não entregou nenhuma), nada mudou no relevo.
    expect(port.results).toHaveLength(0);
    expect(Array.from(core.world!.elevation)).toEqual(fresh);
  });
});
