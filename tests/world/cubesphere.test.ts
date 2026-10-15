import { describe, expect, it } from 'vitest';
import {
  CubeSphere,
  FACES,
  faceCoordToPoint,
  latLonToPoint,
  pointToFaceCoord,
  pointToLatLon,
} from '../../src/world/cubesphere';

const sizes = [2, 3, 8, 33];

describe('cubesphere: conversões', () => {
  it('faces formam bases ortonormais', () => {
    for (const { n, u, v } of FACES) {
      const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] as number), 0);
      expect(dot(n, u)).toBe(0);
      expect(dot(n, v)).toBe(0);
      expect(dot(u, v)).toBe(0);
    }
  });

  it('coordenada de face → ponto → coordenada de face (ida e volta)', () => {
    for (let face = 0; face < 6; face++) {
      for (const a of [-0.99, -0.5, 0, 0.3, 0.97]) {
        for (const b of [-0.95, -0.1, 0, 0.6, 0.99]) {
          const p = faceCoordToPoint(face, a, b);
          expect(Math.hypot(...p)).toBeCloseTo(1, 12);
          const back = pointToFaceCoord(p[0], p[1], p[2]);
          expect(back.face).toBe(face);
          expect(back.a).toBeCloseTo(a, 10);
          expect(back.b).toBeCloseTo(b, 10);
        }
      }
    }
  });

  it('latitude/longitude → ponto → latitude/longitude (ida e volta)', () => {
    for (const lat of [-1.5, -0.7, 0, 0.4, 1.2]) {
      for (const lon of [-3, -1, 0, 1.5, 3]) {
        const p = latLonToPoint(lat, lon);
        const back = pointToLatLon(p[0], p[1], p[2]);
        expect(back.lat).toBeCloseTo(lat, 10);
        expect(back.lon).toBeCloseTo(lon, 10);
      }
    }
  });

  it('polos ficam no centro das faces +Y e -Y', () => {
    expect(pointToFaceCoord(0, 1, 0)).toMatchObject({ face: 2, a: 0, b: 0 });
    expect(pointToFaceCoord(0, -1, 0)).toMatchObject({ face: 3, a: 0, b: 0 });
  });
});

describe('cubesphere: grade', () => {
  it.each(sizes)('N=%i: célula → ponto → célula (ida e volta) para todas as células', (n) => {
    const g = new CubeSphere(n);
    for (let i = 0; i < g.cellCount; i++) {
      const p = g.cellToPoint(g.faceOf(i), g.xOf(i), g.yOf(i));
      expect(g.pointToCell(p[0], p[1], p[2])).toBe(i);
      expect(g.index(g.faceOf(i), g.xOf(i), g.yOf(i))).toBe(i);
    }
  });

  it.each(sizes)('N=%i: toda célula tem exatamente 4 vizinhos ortogonais distintos', (n) => {
    const g = new CubeSphere(n);
    for (let i = 0; i < g.cellCount; i++) {
      const nb = new Set([0, 1, 2, 3].map((d) => g.neighbor(i, d)));
      expect(nb.size).toBe(4);
      expect(nb.has(i)).toBe(false);
      for (const j of nb) {
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThan(g.cellCount);
      }
    }
  });

  it.each(sizes)('N=%i: vizinhança é simétrica (se A vê B, B vê A)', (n) => {
    const g = new CubeSphere(n);
    for (let i = 0; i < g.cellCount; i++) {
      for (let d = 0; d < 4; d++) {
        const j = g.neighbor(i, d);
        const back = [0, 1, 2, 3].map((e) => g.neighbor(j, e));
        expect(back).toContain(i);
      }
    }
  });

  it('vizinhos são próximos de verdade, inclusive nas bordas entre faces', () => {
    const g = new CubeSphere(32);
    let maxAngle = 0;
    for (let i = 0; i < g.cellCount; i++) {
      for (let d = 0; d < 4; d++) {
        const j = g.neighbor(i, d);
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += (g.positions[i * 3 + k] as number) * (g.positions[j * 3 + k] as number);
        maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, dot)));
      }
    }
    expect(maxAngle).toBeLessThan(g.cellAngle * 1.6);
  });

  it('células têm tamanho parecido (equiangular): maior/menor < 1.5', () => {
    const g = new CubeSphere(32);
    const spacing = (i: number) => {
      const j = g.neighbor(i, 0);
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += (g.positions[i * 3 + k] as number) * (g.positions[j * 3 + k] as number);
      return Math.acos(Math.min(1, dot));
    };
    const all = Array.from({ length: g.cellCount }, (_, i) => spacing(i));
    expect(Math.max(...all) / Math.min(...all)).toBeLessThan(1.5);
  });

  it('cellsInCap pega as células do círculo e só elas', () => {
    const g = new CubeSphere(32);
    // Ponto perto de um canto do cubo, onde três faces se encontram.
    const p = faceCoordToPoint(0, 0.98, 0.98);
    const angle = g.cellAngle * 5;
    const got = new Set(g.cellsInCap(p[0], p[1], p[2], angle));
    let expected = 0;
    for (let i = 0; i < g.cellCount; i++) {
      const dot =
        (g.positions[i * 3] as number) * p[0] +
        (g.positions[i * 3 + 1] as number) * p[1] +
        (g.positions[i * 3 + 2] as number) * p[2];
      if (dot >= Math.cos(angle)) {
        expected++;
        expect(got.has(i)).toBe(true);
      }
    }
    expect(got.size).toBe(expected);
    expect(new Set([...got].map((i) => g.faceOf(i))).size).toBe(3);
  });
});
