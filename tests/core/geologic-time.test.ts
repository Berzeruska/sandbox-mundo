import { describe, expect, it } from 'vitest';
import { formatJumpDate, geologicJump, JUMP_YEARS_20X, JUMP_YEARS_MAX, MAX_SPEED_LEAD, maxSpeedQuota } from '../../src/core/geologic-time';
import { APPLY_DELAY_TICKS } from '../../src/sim/geology';
import { Clock, TICKS_PER_YEAR } from '../../src/core/time';
import { Camera } from '../../src/render/camera';

describe('modo de tempo geológico', () => {
  it('liga só em 20× ou Máx com as placas andando, com o salto de cada velocidade', () => {
    expect(geologicJump(20, 0.25)).toBe(JUMP_YEARS_20X);
    expect(geologicJump('max', 1)).toBe(JUMP_YEARS_MAX);
    for (const speed of [0, 1, 2, 5] as const) expect(geologicJump(speed, 1)).toBe(0);
    expect(geologicJump(20, 0)).toBe(0);
    expect(geologicJump('max', 0)).toBe(0);
  });

  it('a data só muda em múltiplos do salto', () => {
    const clock = new Clock();
    const at = (year: number) => {
      clock.tick = (year - 1) * TICKS_PER_YEAR;
      return formatJumpDate(clock, 500);
    };
    expect(at(1)).toBe('Ano 1');
    expect(at(499)).toBe('Ano 1');
    expect(at(500)).toBe('Ano 500');
    expect(at(999)).toBe('Ano 500');
    expect(at(12_750)).toBe('Ano 12.500');
  });

  it('o zoom travado ignora o jogador', () => {
    const camera = new Camera();
    camera.setViewport(1000, 1000);
    camera.zoomLocked = true;
    camera.zoomAt(500, 500, 4);
    expect(camera.zoom).toBe(1);
    camera.zoomLocked = false;
    camera.zoomAt(500, 500, 4);
    expect(camera.zoom).toBe(4);
  });
});

describe('ritmo do relógio no Máx', () => {
  /** O relógio com o motor ocupado por `ms`: quão à frente chega, começando em dia com ele. */
  function leadAfterBusy(ms: number): number {
    let lead = 0;
    let carry = 0;
    for (let t = 0; t < ms; t += 16) {
      const q = maxSpeedQuota(lead, 0.016, carry);
      carry = q.carry;
      lead += q.quota;
    }
    return lead;
  }

  it('nunca chega ao limite do motor, nem com uma recomposição demorada', () => {
    for (const ms of [500, 750, 2000, 10_000]) expect(leadAfterBusy(ms)).toBeLessThan(APPLY_DELAY_TICKS);
  });

  it('continua andando durante uma recomposição normal: não para antes de ~550 ms', () => {
    const q = (lead: number) => maxSpeedQuota(lead, 0.5, 0).quota;
    expect(q(0)).toBeGreaterThan(q(MAX_SPEED_LEAD / 2));
    expect(leadAfterBusy(550) - leadAfterBusy(500)).toBeGreaterThan(0);
  });

  it('um passo por volta não se perde: a fração fica para a próxima', () => {
    let carry = 0;
    let total = 0;
    for (let k = 0; k < 100; k++) {
      const q = maxSpeedQuota(MAX_SPEED_LEAD - 1, 0.016, carry);
      carry = q.carry;
      total += q.quota;
    }
    // 100 voltas a (1 passo / 0,2 s) × 16 ms = 8 passos (a soma de frações pode ficar um centésimo abaixo).
    expect(Math.abs(total - (100 * 0.016) / 0.2)).toBeLessThanOrEqual(1);
  });
});
