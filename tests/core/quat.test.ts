import { describe, expect, it } from 'vitest';
import { quatFromAxisAngle, quatFromBasis, quatFromTo, quatMultiply, quatRotate, quatToMat3, type V3 } from '../../src/core/quat';

const close = (a: number[], b: number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, digits));
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('quatérnios', () => {
  it('rotação de 90° em torno de Y leva +X para -Z', () => {
    close(quatRotate(quatFromAxisAngle([0, 1, 0], Math.PI / 2), [1, 0, 0]), [0, 0, -1]);
  });

  it('quatFromTo leva a até b, inclusive vetores opostos', () => {
    const pairs: [V3, V3][] = [
      [[1, 0, 0], [0, 1, 0]],
      [norm([1, 2, 3]), norm([-3, 0.5, 1])],
      [[0, 0, 1], [0, 0, -1]],
      [[1, 0, 0], [1, 0, 0]],
    ];
    for (const [a, b] of pairs) close(quatRotate(quatFromTo(a, b), a), b);
  });

  it('multiplicação compõe rotações (b depois de a)', () => {
    const a = quatFromAxisAngle([0, 0, 1], 0.7);
    const b = quatFromAxisAngle([1, 0, 0], -1.1);
    const v: V3 = [0.3, -0.4, 0.8];
    close(quatRotate(quatMultiply(b, a), v), quatRotate(b, quatRotate(a, v)));
  });

  it('matriz em ordem de coluna gira igual ao quatérnio', () => {
    const q = quatFromAxisAngle(norm([1, 1, 0.2]), 2.1);
    const m = quatToMat3(q);
    const v: V3 = [0.2, 0.9, -0.4];
    const mv = [0, 1, 2].map((r) => (m[r] as number) * v[0] + (m[3 + r] as number) * v[1] + (m[6 + r] as number) * v[2]);
    close(mv, quatRotate(q, v), 6);
  });

  it('quatFromBasis reconstrói a rotação', () => {
    const q = quatFromAxisAngle(norm([-0.3, 0.8, 0.5]), 2.8);
    const q2 = quatFromBasis(quatRotate(q, [1, 0, 0]), quatRotate(q, [0, 1, 0]), quatRotate(q, [0, 0, 1]));
    close(quatRotate(q2, [0.1, 0.2, 0.3]), quatRotate(q, [0.1, 0.2, 0.3]));
  });
});
