import { quatConjugate, quatFromBasis, quatIdentity, quatNormalize, quatRotate, quatToMat3, type Quat, type V3 } from '../core/quat';

/**
 * Câmera do globo em projeção ortográfica.
 * - `orientation` leva coordenadas de visão (x direita, y cima, z para o observador) para o mundo.
 * - `zoom` multiplica o raio aparente; com zoom alto o globo transborda e preenche a tela.
 * Coordenadas de tela: pixels do canvas (dispositivo), origem no canto superior esquerdo.
 */
export class Camera {
  orientation: Quat = quatIdentity();
  zoom = 1;
  width = 1;
  height = 1;
  minZoom = 0.6;
  maxZoom = 64;

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Raio do globo em pixels com zoom 1: o globo inteiro cabe com folga. */
  baseRadius(): number {
    return 0.42 * Math.min(this.width, this.height);
  }

  radius(): number {
    return this.baseRadius() * this.zoom;
  }

  centerX(): number {
    return this.width / 2;
  }

  centerY(): number {
    return this.height / 2;
  }

  /** Ponto de tela → vetor de visão na esfera, ou null se cair no espaço. */
  screenToView(sx: number, sy: number): V3 | null {
    const r = this.radius();
    const dx = (sx - this.centerX()) / r;
    const dy = -(sy - this.centerY()) / r;
    const d2 = dx * dx + dy * dy;
    if (d2 > 1) return null;
    return [dx, dy, Math.sqrt(1 - d2)];
  }

  /** Como screenToView, mas pontos no espaço são presos à borda do globo (bom para arrastar). */
  screenToViewClamped(sx: number, sy: number): V3 {
    const r = this.radius();
    let dx = (sx - this.centerX()) / r;
    let dy = -(sy - this.centerY()) / r;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
      return [dx, dy, 0];
    }
    return [dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy))];
  }

  viewToWorld(v: V3): V3 {
    return quatRotate(this.orientation, v);
  }

  worldToView(p: V3): V3 {
    return quatRotate(quatConjugate(this.orientation), p);
  }

  /** Ponto do planeta sob o pixel, ou null. */
  pick(sx: number, sy: number): V3 | null {
    const v = this.screenToView(sx, sy);
    return v ? this.viewToWorld(v) : null;
  }

  /** Ponto do planeta → pixel na tela (e se está no lado visível). */
  worldToScreen(p: V3): { x: number; y: number; visible: boolean } {
    const v = this.worldToView(p);
    const r = this.radius();
    return { x: this.centerX() + v[0] * r, y: this.centerY() - v[1] * r, visible: v[2] >= 0 };
  }

  /** Centraliza o ponto do planeta com o norte para cima. */
  lookAt(p: V3): void {
    const len = Math.hypot(p[0], p[1], p[2]);
    const z: V3 = [p[0] / len, p[1] / len, p[2] / len];
    let east: V3 = [z[2], 0, -z[0]];
    const elen = Math.hypot(east[0], east[2]);
    // Exatamente num polo não existe "leste": escolhe um qualquer.
    east = elen < 1e-6 ? [1, 0, 0] : [east[0] / elen, 0, east[2] / elen];
    const north: V3 = [
      z[1] * east[2] - z[2] * east[1],
      z[2] * east[0] - z[0] * east[2],
      z[0] * east[1] - z[1] * east[0],
    ];
    this.orientation = quatFromBasis(east, north, z);
  }

  /** Ponto do planeta no centro da tela. */
  centerPoint(): V3 {
    return this.viewToWorld([0, 0, 1]);
  }

  setOrientation(q: Quat): void {
    this.orientation = quatNormalize(q);
  }

  /** Matriz visão → mundo para o shader. */
  rotationMatrix(out?: Float32Array): Float32Array {
    return quatToMat3(this.orientation, out);
  }
}
