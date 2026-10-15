import { describe, expect, it } from 'vitest';
import { seedFrom } from '../../src/core/rng';
import { Tool } from '../../src/input/tools';
import { buildColors } from '../../src/render/colors';
import { SimulationCore } from '../../src/sim/core';
import { applyPatch, type FromWorker } from '../../src/sim/protocol';
import { createWorld } from '../../src/world/create';
import { latLonToPoint } from '../../src/world/cubesphere';

const N = 32;

/** Núcleo com "correio" que guarda as mensagens, e relógio falso (sem tempo real). */
function makeCore() {
  const inbox: FromWorker[] = [];
  let fakeNow = 0;
  const core = new SimulationCore((msg) => inbox.push(msg), () => fakeNow);
  return { core, inbox, tick: (ms: number) => (fakeNow += ms) };
}

const lastOf = <T extends FromWorker['type']>(inbox: FromWorker[], type: T) =>
  [...inbox].reverse().find((m) => m.type === type) as Extract<FromWorker, { type: T }> | undefined;

describe('núcleo da simulação (worker)', () => {
  it('o mundo gerado no worker é idêntico ao gerado na thread principal (mesma semente)', () => {
    const { core, inbox } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'terra', n: N });
    const msg = lastOf(inbox, 'world')!;
    const direct = createWorld({ seedText: 'terra', seed: seedFrom('terra'), n: N, seaLevel: 0, landFraction: 0.3 });
    const expected = new Uint8Array(direct.cellCount * 4);
    buildColors(direct, expected);
    expect(msg.colors).toEqual(expected);
    expect(core.world!.elevation).toEqual(direct.elevation);
    expect(msg.info).toMatchObject({ n: N, cellCount: direct.cellCount, seedText: 'terra', seed: seedFrom('terra') });
  });

  it('a cópia de cores enviada é independente da do worker', () => {
    const { core, inbox } = makeCore();
    core.handle({ type: 'newWorld', seedText: '1', n: N });
    const msg = lastOf(inbox, 'world')!;
    expect(msg.colors.buffer).not.toBe(core.colors.buffer);
  });

  it('pinceladas viram remendos; aplicados na cópia, ela fica igual às cores do worker', () => {
    const { core, inbox } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'pincel', n: N });
    const mirror = lastOf(inbox, 'world')!.colors;
    const p = latLonToPoint(0.2, 0.4);
    for (const tool of [Tool.Raise, Tool.Water, Tool.Ice, Tool.Lower, Tool.EraseIce]) {
      core.handle({ type: 'brush', tool, point: p, radius: 5, dt: 0.3 });
      for (const patch of lastOf(inbox, 'patch')!.patches) applyPatch(mirror, N, patch);
    }
    expect(mirror).toEqual(core.colors);
  });

  it('relógio: avança só com tempo, respeita a velocidade e avisa a data', () => {
    const { core, inbox, tick } = makeCore();
    core.handle({ type: 'newWorld', seedText: '1', n: N });
    core.handle({ type: 'speed', speed: 2 });
    for (let i = 0; i < 60; i++) {
      tick(1000 / 60);
      core.advance(1 / 60);
    }
    expect(core.clock.tick).toBe(24); // 2× = 24 passos por segundo
    expect(lastOf(inbox, 'clock')).toMatchObject({ tick: 24, speed: 2 });
    core.handle({ type: 'speed', speed: 0 });
    core.advance(1);
    expect(core.clock.tick).toBe(24);
  });

  it('novo mundo zera o calendário', () => {
    const { core } = makeCore();
    core.handle({ type: 'newWorld', seedText: '1', n: N });
    core.advance(1);
    expect(core.clock.tick).toBeGreaterThan(0);
    core.handle({ type: 'newWorld', seedText: '2', n: N });
    expect(core.clock.tick).toBe(0);
  });

  it('consulta de célula responde com elevação, bioma e água', () => {
    const { core, inbox } = makeCore();
    core.handle({ type: 'newWorld', seedText: '1', n: N });
    core.handle({ type: 'query', id: 7, point: latLonToPoint(0, 0) });
    const msg = lastOf(inbox, 'query')!;
    expect(msg.id).toBe(7);
    expect(typeof msg.cell.elevation).toBe('number');
    expect(msg.cell.water).toBe(msg.cell.elevation <= 0);
  });
});

describe('progresso da geração', () => {
  it('avisa várias vezes durante o terreno, só para a frente, até ~100%', () => {
    const inbox: FromWorker[] = [];
    const core = new SimulationCore((m) => inbox.push(m), () => 0);
    core.handle({ type: 'newWorld', seedText: 'p', n: 128 });
    const progress = inbox.filter((m) => m.type === 'progress') as Extract<FromWorker, { type: 'progress' }>[];
    expect(progress.filter((p) => p.stage === 'terreno').length).toBeGreaterThan(3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.fraction).toBeGreaterThanOrEqual(progress[i - 1]!.fraction);
    expect(progress.at(-1)!.fraction).toBeGreaterThan(0.85);
    expect(progress.at(-1)!.fraction).toBeLessThanOrEqual(1);
  });

  it('overallProgress soma os pesos das etapas', async () => {
    const { overallProgress, GENERATION_STAGES } = await import('../../src/sim/core');
    expect(GENERATION_STAGES.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 9);
    expect(overallProgress('grade', 0)).toBe(0);
    expect(overallProgress('cores', 1)).toBeCloseTo(1, 9);
  });
});

describe('placas no worker', () => {
  it('com o controle "Placas" ligado, o relógio move as placas e manda o mundo repintado', () => {
    const { core, inbox } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'deriva', n: 32 });
    core.handle({ type: 'plateRate', rate: 1 });
    core.handle({ type: 'speed', speed: 20 });
    const before = Float32Array.from(core.world!.elevation);
    inbox.length = 0;
    for (let i = 0; i < 400; i++) core.advance(0.25); // 400 × 60 passos
    expect(core.tectonics!.recompositions).toBeGreaterThan(0);
    expect(core.world!.elevation).not.toEqual(before);
    const fullPatch = inbox.find((m) => m.type === 'patch' && m.patches.length === 6);
    expect(fullPatch).toBeDefined();
    expect(lastOf(inbox, 'clock')!.recompositions).toBe(core.tectonics!.recompositions);
  });

  it('controle em 0 congela a geologia mesmo com o tempo correndo', () => {
    const { core } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'parado', n: 32 });
    core.handle({ type: 'plateRate', rate: 0 });
    core.handle({ type: 'speed', speed: 20 });
    const before = Float32Array.from(core.world!.elevation);
    for (let i = 0; i < 200; i++) core.advance(0.25);
    expect(core.tectonics?.recompositions ?? 0).toBe(0);
    expect(core.world!.elevation).toEqual(before);
  });

  it.each([
    ['antes de a tectônica existir', false],
    ['depois de a tectônica existir', true],
  ])('pincelada fica gravada na placa %s (sobrevive à recomposição)', (_label, startFirst) => {
    const { core } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'grava', n: 32 });
    if (startFirst) core.advance(1 / 12); // um passo: monta a tectônica
    const p = latLonToPoint(0.1, 0.2);
    core.handle({ type: 'brush', tool: Tool.Raise, point: p, radius: 3, dt: 2 });
    core.advance(1 / 12);
    const w = core.world!;
    const max0 = Math.max(...w.elevation);
    core.tectonics!.recompose();
    expect(Math.max(...w.elevation)).toBe(max0);
  });

  it('a tectônica só é montada no primeiro passo, e não com o controle em 0', () => {
    const { core } = makeCore();
    core.handle({ type: 'newWorld', seedText: 'preguica', n: 32 });
    expect(core.tectonics).toBeNull();
    core.handle({ type: 'plateRate', rate: 0 });
    core.advance(1);
    expect(core.tectonics).toBeNull();
    core.handle({ type: 'plateRate', rate: 0.5 });
    core.advance(1 / 12);
    expect(core.tectonics).not.toBeNull();
  });
});
