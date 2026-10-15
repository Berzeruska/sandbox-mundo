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

describe('câmera: controles', () => {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  it('arrastar leva o ponto sob o dedo junto com o dedo', () => {
    const c = make();
    c.lookAt(latLonToPoint(0.2, 0.3));
    const p = c.pick(380, 280)!;
    c.drag(380, 280, 470, 330);
    expect(dist(c.pick(470, 330)!, p)).toBeLessThan(1e-6);
  });

  it('arrastar funciona em cima do polo, em qualquer direção', () => {
    const c = make();
    c.lookAt([0, 1, 0]);
    c.zoom = 5;
    for (const [dx, dy] of [[60, 0], [0, 60], [-40, -40]]) {
      const p = c.pick(400, 300)!;
      c.drag(400, 300, 400 + dx!, 300 + dy!);
      expect(dist(c.pick(400 + dx!, 300 + dy!)!, p)).toBeLessThan(1e-6);
    }
  });

  it('zoom no cursor mantém o ponto sob o cursor parado', () => {
    const c = make();
    c.lookAt(latLonToPoint(-0.5, 1));
    const p = c.pick(520, 210)!;
    c.zoomAt(520, 210, 3);
    expect(c.zoom).toBeCloseTo(3, 9);
    expect(dist(c.pick(520, 210)!, p)).toBeLessThan(1e-6);
  });

  it('zoom respeita os limites e o máximo mostra células grandes', () => {
    const c = make();
    c.setCellAngle(Math.PI / 2 / 256);
    c.zoomAt(400, 300, 1e6);
    expect(c.zoom).toBe(c.maxZoom);
    expect(c.cellPixels()).toBeCloseTo(48, 6);
    c.zoomAt(400, 300, 1e-6);
    expect(c.zoom).toBe(c.minZoom);
  });

  it('inércia continua o giro e depois para sozinha', () => {
    const c = make();
    const r = c.drag(400, 300, 410, 300);
    c.setSpinFrom(r, 1 / 60);
    expect(c.isSpinning()).toBe(true);
    const before = c.centerPoint();
    expect(c.update(1 / 60)).toBe(true);
    expect(dist(c.centerPoint(), before)).toBeGreaterThan(0);
    for (let i = 0; i < 600 && c.isSpinning(); i++) c.update(1 / 60);
    expect(c.isSpinning()).toBe(false);
  });

  it('northUp endireita sem mudar o ponto central', () => {
    const c = make();
    c.lookAt(latLonToPoint(0.4, 0.4));
    c.drag(300, 200, 500, 400);
    c.drag(500, 200, 300, 400);
    const center = c.centerPoint();
    c.northUp();
    expect(dist(c.centerPoint(), center)).toBeLessThan(1e-6);
    expect(c.pick(400, 250)![1]).toBeGreaterThan(c.pick(400, 350)![1]);
  });
});
