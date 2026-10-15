import { describe, expect, it } from 'vitest';
import { latLonToPoint } from '../../src/world/cubesphere';
import { Camera } from '../../src/render/camera';

const make = () => {
  const c = new Camera();
  c.setViewport(800, 600);
  return c;
};

describe('câmera', () => {
  it('centro da tela enxerga o ponto escolhido em lookAt', () => {
    const c = make();
    const p = latLonToPoint(0.5, 2);
    c.lookAt(p);
    const got = c.pick(400, 300);
    expect(got).not.toBeNull();
    got!.forEach((v, i) => expect(v).toBeCloseTo(p[i] as number, 6));
  });

  it('lookAt deixa o norte para cima', () => {
    const c = make();
    c.lookAt(latLonToPoint(0.3, 1));
    const up = c.pick(400, 250)!;
    const down = c.pick(400, 350)!;
    expect(up[1]).toBeGreaterThan(down[1]);
  });

  it('funciona exatamente em cima do polo', () => {
    const c = make();
    c.lookAt([0, 1, 0]);
    expect(c.pick(400, 300)![1]).toBeCloseTo(1, 6);
  });

  it('pixel fora do globo é espaço; com zoom alto a tela toda é globo', () => {
    const c = make();
    expect(c.pick(2, 2)).toBeNull();
    c.zoom = 4;
    expect(c.pick(2, 2)).not.toBeNull();
  });

  it('worldToScreen é o inverso de pick', () => {
    const c = make();
    c.lookAt(latLonToPoint(-0.4, -1));
    const p = c.pick(470, 220)!;
    const s = c.worldToScreen(p);
    expect(s.x).toBeCloseTo(470, 6);
    expect(s.y).toBeCloseTo(220, 6);
    expect(s.visible).toBe(true);
  });
});
