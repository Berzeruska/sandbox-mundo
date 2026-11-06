import { quatFromBasis, quatIdentity, type Quat, type V3 } from '../core/quat';
import { chartChunk, chartPointToSphere, CHUNK_CELLS, DETAIL, FACE_LINKS, fineToChart, pointToFine, resolveFine, type ChartChunk, type Place } from '../maquete/chart';
import { Camera } from './camera';
import { eyeOf, lookAt, multiply, perspective, type MaqueteCamera } from './maquete-renderer';

/** O corte: de quantos pixels por célula o globo vira maquete. Antes, os pedaços já vão carregando. */
export const CUT_PIXELS = 32;
export const PRELOAD_PIXELS = 18;
const FOV = 25;
const PITCH_FAR = 0.82, PITCH_NEAR = 0.5;
/** Zoom máximo: a mesma ideia do globo (48 px por célula grande é pouco para a maquete), aqui em px por célula fina. */
const MAX_FINE_PIXELS = 46;
const EXIT_FACTOR = 1.12;

/**
 * A câmera única do jogo. No globo, é a câmera de sempre. Na maquete, os mesmos comandos (arrastar, pinça, setas, tocar, pincel, animações)
 * valem no plano: arrastar anda, ←/→ gira, ↑/↓ e a pinça aproximam, e tocar devolve o ponto do planeta. Assim o menu, os poderes e os efeitos funcionam nas duas vistas.
 */
export class ViewCamera extends Camera {
  /** Maquete na tela. */
  inMaquete = false;
  view: MaqueteCamera = { x: 0, y: 1, z: 0, yaw: 0, pitch: PITCH_FAR, distance: 300, fov: FOV };
  /** Face do cubo no centro do plano. */
  chart = 0;
  /** Giro acumulado do plano desde a entrada (o sol acompanha). */
  chartTurn = 0;
  /** Afastou além do limite: a tela volta ao globo. */
  wantsExit = false;
  private vp: Float32Array = new Float32Array(16);

  private fineSize(): number { return Math.round((Math.PI / 2 / this.cellAngle)) * DETAIL; }

  /** Pixels por célula do globo, sem a maquete. */
  globePixels(): number { return this.radius() * this.cellAngle; }

  private entryDistance(): number { return this.height / (2 * (CUT_PIXELS / DETAIL) * Math.tan((FOV * Math.PI) / 360)); }
  private minDistance(): number { return this.height / (2 * MAX_FINE_PIXELS * Math.tan((FOV * Math.PI) / 360)); }

  /** Inclinação segue o zoom: de perto, mais baixa, como na folha-mestra. */
  private applyPitch(): void {
    const t = Math.max(0, Math.min(1, (this.view.distance - this.minDistance()) / (this.entryDistance() - this.minDistance())));
    this.view.pitch = PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * t;
  }

  /** Aponta a maquete para o ponto no centro do globo, com o "para cima" da tela. */
  aimAtGlobeCenter(): void {
    const size = this.fineSize();
    const c = super.centerPoint();
    const q = pointToFine(c, size);
    this.chart = q.face;
    this.chartTurn = 0;
    this.view.x = q.x;
    this.view.z = size - q.y;
    this.view.distance = this.entryDistance();
    this.applyPitch();
    // A direção "para cima" da tela vista no plano.
    const up = this.viewToWorld([0, 1, 0]);
    const a = chartPointToSphere(this.chart, this.view.x, this.view.z, size);
    const step = 2;
    const b = chartPointToSphere(this.chart, this.view.x + step, this.view.z, size), d = chartPointToSphere(this.chart, this.view.x, this.view.z + step, size);
    const dotUp = (p: V3) => (p[0] - a[0]) * up[0] + (p[1] - a[1]) * up[1] + (p[2] - a[2]) * up[2];
    this.view.yaw = Math.atan2(-dotUp(b), -dotUp(d));
  }

  enter(): void {
    this.inMaquete = true;
    this.wantsExit = false;
    this.stopSpin();
    this.refresh();
  }

  /** Volta ao globo olhando o mesmo lugar, com o mesmo "para cima". */
  exit(): void {
    const size = this.fineSize();
    const z = chartPointToSphere(this.chart, this.view.x, this.view.z, size) as V3;
    const step = 2, cy = Math.cos(this.view.yaw), sy = Math.sin(this.view.yaw);
    const ahead = chartPointToSphere(this.chart, this.view.x - sy * step, this.view.z - cy * step, size);
    const uRaw: V3 = [ahead[0] - z[0], ahead[1] - z[1], ahead[2] - z[2]];
    const k = uRaw[0] * z[0] + uRaw[1] * z[1] + uRaw[2] * z[2];
    const u0: V3 = [uRaw[0] - z[0] * k, uRaw[1] - z[1] * k, uRaw[2] - z[2] * k];
    const l = Math.hypot(u0[0], u0[1], u0[2]) || 1;
    const u: V3 = [u0[0] / l, u0[1] / l, u0[2] / l];
    const r: V3 = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]];
    this.inMaquete = false;
    this.wantsExit = false;
    this.setOrientation(quatFromBasis(r, u, z));
    this.zoom = Math.max(this.minZoom, (CUT_PIXELS * 0.86) / (this.baseRadius() * this.cellAngle));
  }

  /** Matriz de agora; recalcular depois de mudar a vista. */
  refresh(): void {
    const v = this.view;
    const near = Math.max(1, v.distance * 0.1), far = v.distance * 4 + 200;
    this.vp = multiply(perspective(v.fov, this.width / this.height, near, far), lookAt(eyeOf(v), [v.x, v.y, v.z], [0, 1, 0]));
  }

  /** Passou da aresta: a face vizinha vira o centro do plano e nenhum pedaço muda. */
  rechart(): boolean {
    const size = this.fineSize(), v = this.view;
    let dir = -1;
    if (v.x < 0) dir = 1; else if (v.x > size) dir = 0; else if (v.z < 0) dir = 2; else if (v.z > size) dir = 3;
    if (dir < 0) return false;
    const p = resolveFine(this.chart, v.x, size - v.z, size);
    const l = (FACE_LINKS[this.chart] as readonly (typeof FACE_LINKS)[number][number][])[dir] as (typeof FACE_LINKS)[number][number];
    v.x = p.x;
    v.z = size - p.y;
    // O plano gira do ângulo em que a vizinha estava aberta.
    const turn = Math.atan2(l.uy, l.ux);
    v.yaw += turn;
    this.chartTurn += turn;
    this.chart = l.to;
    return true;
  }

  /** Pedaço na posição do plano atual. */
  chunkAt(pcx: number, pcz: number): ChartChunk {
    return chartChunk(this.chart, pcx, pcz, Math.round(Math.PI / 2 / this.cellAngle));
  }

  /** Ponto do chão no pixel, no plano. */
  private rayToGround(sx: number, sy: number, groundY = 1): { x: number; z: number } | null {
    const v = this.view, eye = eyeOf(v);
    const fx = v.x - eye[0], fy = v.y - eye[1], fz = v.z - eye[2];
    const fl = Math.hypot(fx, fy, fz);
    const f: V3 = [fx / fl, fy / fl, fz / fl];
    const rl = Math.hypot(f[2], f[0]) || 1;
    const r: V3 = [-f[2] / rl, 0, f[0] / rl];
    const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const t = Math.tan((v.fov * Math.PI) / 360);
    const nx = ((sx - this.width / 2) / (this.height / 2)) * t, ny = ((this.height / 2 - sy) / (this.height / 2)) * t;
    const dx = f[0] + r[0] * nx + u[0] * ny, dy = f[1] + r[1] * nx + u[1] * ny, dz = f[2] + r[2] * nx + u[2] * ny;
    if (dy >= -0.02) return null;
    const k = (groundY - eye[1]) / dy;
    return { x: eye[0] + dx * k, z: eye[2] + dz * k };
  }

  /** Cantos do que se vê no chão (no plano). */
  footprint(): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    for (const [sx, sy] of [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]] as const) {
      const p = this.rayToGround(sx, sy, 0);
      if (p) pts.push(p);
    }
    return pts;
  }

  private projectPlane(X: number, Y: number, Z: number): { x: number; y: number; visible: boolean } {
    const m = this.vp;
    const cw = (m[3] as number) * X + (m[7] as number) * Y + (m[11] as number) * Z + (m[15] as number);
    const cx = (m[0] as number) * X + (m[4] as number) * Y + (m[8] as number) * Z + (m[12] as number);
    const cy = (m[1] as number) * X + (m[5] as number) * Y + (m[9] as number) * Z + (m[13] as number);
    return { x: ((cx / cw) * 0.5 + 0.5) * this.width + this.shakeX, y: (0.5 - (cy / cw) * 0.5) * this.height + this.shakeY, visible: cw > 0 };
  }

  // ---- Os mesmos comandos do globo, valendo na maquete ----

  override cellPixels(): number {
    if (!this.inMaquete) return super.cellPixels();
    return ((this.height / (2 * this.view.distance * Math.tan((this.view.fov * Math.PI) / 360))) * DETAIL);
  }

  override drag(fromX: number, fromY: number, toX: number, toY: number): Quat {
    if (!this.inMaquete) return super.drag(fromX, fromY, toX, toY);
    const a = this.rayToGround(fromX, fromY), b = this.rayToGround(toX, toY);
    if (a && b) {
      this.view.x += a.x - b.x;
      this.view.z += a.z - b.z;
      this.refresh();
    }
    return quatIdentity();
  }

  override zoomAt(sx: number, sy: number, factor: number): void {
    if (!this.inMaquete) { super.zoomAt(sx, sy, factor); return; }
    const before = this.rayToGround(sx, sy);
    const min = this.minDistance(), limit = this.entryDistance() * EXIT_FACTOR;
    const next = this.view.distance / factor;
    if (next > limit) { this.wantsExit = true; return; }
    this.view.distance = Math.max(min, next);
    this.applyPitch();
    this.refresh();
    const after = this.rayToGround(sx, sy);
    if (before && after) {
      this.view.x += before.x - after.x;
      this.view.z += before.z - after.z;
      this.refresh();
    }
  }

  override turnView(amount: number): boolean {
    if (!this.inMaquete) return false;
    this.view.yaw -= amount * 1.3;
    this.refresh();
    return true;
  }

  override screenToView(sx: number, sy: number): V3 | null {
    return this.inMaquete ? [0, 0, 1] : super.screenToView(sx, sy);
  }

  override pick(sx: number, sy: number): V3 | null {
    if (!this.inMaquete) return super.pick(sx, sy);
    const p = this.rayToGround(sx, sy);
    return p ? (chartPointToSphere(this.chart, p.x, p.z, this.fineSize()) as V3) : null;
  }

  override worldToScreen(p: V3): { x: number; y: number; visible: boolean } {
    if (!this.inMaquete) return super.worldToScreen(p);
    const size = this.fineSize(), q = pointToFine(p, size), c = fineToChart(this.chart, q.face, q.x, q.y, size);
    if (!c) return { x: -1e4, y: -1e4, visible: false };
    return this.projectPlane(c.X, 1, c.Z);
  }

  override centerPoint(): V3 {
    if (!this.inMaquete) return super.centerPoint();
    return chartPointToSphere(this.chart, this.view.x, this.view.z, this.fineSize()) as V3;
  }

  override update(dt: number): boolean {
    return this.inMaquete ? false : super.update(dt);
  }
}

export type { ChartChunk, Place };
export const CHUNK_SIZE = CHUNK_CELLS;
