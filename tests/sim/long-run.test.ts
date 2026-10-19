import { describe, expect, it } from 'vitest';
import { TICKS_PER_YEAR } from '../../src/core/time';
import { SimulationCore } from '../../src/sim/core';
import type { FromWorker } from '../../src/sim/protocol';
import { Biome } from '../../src/world/biomes';
import { DisasterKind, type DisasterEvent } from '../../src/world/disasters';
import { landComponents } from '../../src/world/generation';

/**
 * T13 — teste longo de estabilidade (`docs/M2-especificacao.md`, Bloco Final). O núcleo inteiro do
 * relógio (placas, clima, gelo, desastres), com tudo no padrão do jogo (placas 25%, desastres "Raro",
 * temperatura 0), partindo da Pangeia, por 12.000 anos de jogo (10 min a 20×, a janela das medições do
 * Bloco G e um ciclo de Wilson inteiro de 8–12 min com as placas no máximo).
 *
 * N = 128 para caber no CI. Em N = 64 a fração de terra sobe ~10 pontos em 12.000 anos: a lava das
 * erupções anda um número fixo de células, que numa grade pequena é muita área (em N = 128 e N = 256,
 * medido, a terra fica estável; `docs/decisoes.md`, 2026-10-19).
 */
const N = 128;
const YEARS = 12_000;
const SAMPLE_YEARS = 500;
/** Continente = componente de terra com ≥ 2% da terra (critério de formas aprovado em 2026-10-15). */
const CONTINENT_SHARE = 0.02;
/** "Raro": um aviso a cada ~1–2 min em 1× (60–120 anos), com folga: 5 a 25 por 1.000 anos (R9). */
const NOTABLE_PER_1000: readonly [number, number] = [5, 25];
/** Desastres naturais que o mundo tem que ter mostrado em 12.000 anos (todos os tipos). */
const NATURAL_KINDS = Object.values(DisasterKind);

function run(seedText: string) {
  const events: DisasterEvent[] = [];
  let now = 0;
  const core = new SimulationCore((m: FromWorker) => {
    if (m.type === 'disasters') events.push(...m.events);
  }, () => now);
  core.handle({ type: 'newWorld', seedText, n: N });
  core.handle({ type: 'speed', speed: 20 });
  const w = core.world!;
  const samples: { year: number; land: number; invalid: string[] }[] = [];
  const sample = () => {
    const invalid: string[] = [];
    const ground = core.disasters!.ground;
    for (let c = 0; c < w.cellCount; c++) {
      const e = w.elevation[c]!;
      if (!Number.isFinite(e) || e < -11_000 || e > 9_000) invalid.push(`elevação ${e} em ${c}`);
      if (!Number.isFinite(w.temperature[c]!)) invalid.push(`temperatura em ${c}`);
      const rain = w.precipitation[c]!;
      if (!Number.isFinite(rain) || rain < 0) invalid.push(`chuva ${rain} em ${c}`);
      const cover = ground.cover[c]!;
      if (!(cover >= 0 && cover <= 1)) invalid.push(`vegetação ${cover} em ${c}`);
      if (invalid.length > 5) break;
    }
    if (!Number.isFinite(w.seaLevel) || !Number.isFinite(w.climateOffset)) invalid.push('nível do mar ou clima');
    samples.push({ year: core.clock.tick / TICKS_PER_YEAR, land: w.landFraction(), invalid });
  };
  while (core.clock.tick < YEARS * TICKS_PER_YEAR) {
    now += 250;
    core.advance(0.25); // 60 passos (20×)
    if (core.clock.tick % (SAMPLE_YEARS * TICKS_PER_YEAR) === 0) sample();
  }
  return { core, w, events, samples };
}

describe('T13: 12.000 anos de jogo no padrão, partindo da Pangeia (N = 128)', () => {
  it.each(['terra', 'mundo', '7'])('semente "%s": continentes, terra, montanhas, valores e desastres', (seedText) => {
    const { core, w, events, samples } = run(seedText);
    expect(samples.length).toBe(YEARS / SAMPLE_YEARS);

    // Nenhum valor inválido em nenhuma amostra.
    expect(samples.flatMap((s) => s.invalid.map((x) => `ano ${s.year}: ${x}`))).toEqual([]);
    // Fração de terra entre 20% e 40% o tempo todo (inclusive no máximo glacial, mar mais baixo).
    for (const s of samples) {
      expect(s.land, `ano ${s.year}`).toBeGreaterThanOrEqual(0.2);
      expect(s.land, `ano ${s.year}`).toBeLessThanOrEqual(0.4);
    }

    // A Pangeia se partiu: ≥ 3 continentes no fim.
    const sizes = landComponents(w);
    const land = sizes.reduce((a, b) => a + b, 0);
    expect(sizes.filter((s) => s >= CONTINENT_SHARE * land).length).toBeGreaterThanOrEqual(3);

    // Há montanhas.
    expect(w.biome.some((b) => b === Biome.Mountain)).toBe(true);

    // Desastres: todos os tipos naturais aconteceram, só naturais, e avisos na frequência do "Raro".
    expect(events.every((e) => !e.manual)).toBe(true);
    for (const kind of NATURAL_KINDS) expect(events.some((e) => e.kind === kind), `tipo ${kind}`).toBe(true);
    const notablePer1000 = (events.filter((e) => e.notable).length * 1000) / YEARS;
    expect(notablePer1000).toBeGreaterThanOrEqual(NOTABLE_PER_1000[0]);
    expect(notablePer1000).toBeLessThanOrEqual(NOTABLE_PER_1000[1]);
    // Desastres terminam: os que andam agora são poucos perto do que aconteceu (nada acumulando).
    expect(core.disasters!.running).toBeLessThan(100);
  }, 180_000);
});
