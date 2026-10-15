import { describe, expect, it } from 'vitest';
import { quatFromAxisAngle, type Quat } from '../../src/core/quat';
import { inertiaFromHistory, INERTIA_WINDOW } from '../../src/input/pointer';
import { Camera } from '../../src/render/camera';

// Movimento sintético: 0,01 rad por evento, um evento a cada 16 ms (60 Hz). Sem relógio real.
const step: Quat = quatFromAxisAngle([0, 1, 0], 0.01);
const drag = (count: number, start = 0, every = 16) =>
  Array.from({ length: count }, (_, k) => ({ t: start + k * every, r: step }));

describe('inércia (determinística)', () => {
  it('soltar logo após arrastar gera giro com a velocidade do arrasto', () => {
    const history = drag(6); // eventos em 0..80 ms
    const spin = inertiaFromHistory(history, 84)!;
    expect(spin).not.toBeNull();
    // Entram os eventos dos últimos 80 ms (t >= 4): 16, 32, 48, 64, 80 → 5 × 0,01 rad em 68 ms.
    const angle = 2 * Math.acos(spin.rotation[3]);
    expect(angle).toBeCloseTo(0.05, 9);
    expect(spin.seconds).toBeCloseTo(0.068, 9);
    const camera = new Camera();
    camera.setViewport(800, 600);
    camera.setSpinFrom(spin.rotation, spin.seconds);
    expect(camera.isSpinning()).toBe(true);
  });

  it('parar o dedo antes de soltar não gera giro', () => {
    const history = drag(6);
    expect(inertiaFromHistory(history, 80 + INERTIA_WINDOW + 1)).toBeNull();
  });

  it('um único evento recente não basta', () => {
    expect(inertiaFromHistory(drag(1, 100), 110)).toBeNull();
  });

  it('eventos muito juntos não geram velocidade infinita (mínimo de 1/120 s)', () => {
    const spin = inertiaFromHistory(drag(3, 0, 0), 0)!;
    expect(spin.seconds).toBeCloseTo(1 / 120, 9);
  });
});
