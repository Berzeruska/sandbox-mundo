import type { Vec3 } from '../world/cubesphere';

/**
 * Movimento suave das placas entre recomposições (a mesma regra roda no shader do globo).
 *
 * A textura do globo mostra o mundo composto com as placas nos ângulos "base" (última
 * recomposição). Como cada placa é rígida, o conteúdo de um ponto p agora é o que estava, na
 * textura, no ponto p desgirado pela rotação que aquela placa fez desde então (delta).
 */

/**
 * Valor da textura de placas: bits 0–3 = placa; bit 4 = crosta continental; bit 5 = perto de uma
 * fronteira (até NEAR_BOUNDARY_CELLS células). Longe da fronteira só pode estar a própria placa,
 * e o shader pula a busca completa (é a maior parte do planeta).
 */
export const CONTINENTAL_BIT = 16;
export const NEAR_BOUNDARY_BIT = 32;
export const NEAR_BOUNDARY_CELLS = 3;
export const PLATE_MASK = 15;
/** Máximo de placas que o shader aceita (o jogo usa até 14). */
export const MAX_SHADER_PLATES = 16;

export function packPlateCell(plate: number, continental: boolean, nearBoundary = false): number {
  return (plate & PLATE_MASK) | (continental ? CONTINENTAL_BIT : 0) | (nearBoundary ? NEAR_BOUNDARY_BIT : 0);
}

/** Gira v pelo ângulo a em torno do eixo unitário k (Rodrigues). */
export function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d * (1 - c),
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d * (1 - c),
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d * (1 - c),
  ];
}

export interface PlateMotionInput {
  /** Valor da textura de placas no ponto (já empacotado). */
  plateAt(p: Vec3): number;
  axis: readonly Vec3[];
  /** Rotação de cada placa desde a composição da textura. */
  delta: readonly number[];
  /** Maior rotação entre as placas (raio de busca de placas vizinhas que podem ter chegado em p). */
  maxDelta: number;
  /**
   * As placas a e b, em p, estão se aproximando (> 0) ou se afastando (< 0)? Usado para decidir uma
   * fenda: afastando = fundo oceânico novo; senão é só arredondamento e fica com a placa de antes.
   */
  closing?(a: number, b: number, p: Vec3): number;
}

/** Ponto a `dist` radianos de p, nas 4 direções do plano tangente (para achar placas vizinhas). */
export function probePoints(p: Vec3, dist: number): Vec3[] {
  let ex = p[2];
  let ey = 0;
  let ez = -p[0];
  let len = Math.hypot(ex, ey, ez);
  if (len < 1e-6) [ex, ey, ez, len] = [1, 0, 0, 1];
  ex /= len;
  ey /= len;
  ez /= len;
  const nx = p[1] * ez - p[2] * ey;
  const ny = p[2] * ex - p[0] * ez;
  const nz = p[0] * ey - p[1] * ex;
  const out: Vec3[] = [];
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    out.push([p[0] + dist * (a * ex + b * nx), p[1] + dist * (a * ey + b * ny), p[2] + dist * (a * ez + b * nz)]);
  }
  return out;
}

/**
 * Onde buscar na textura o conteúdo que agora está em p, ou null se é uma fenda nova
 * (as placas se afastaram e ainda não há crosta: o shader pinta fundo oceânico novo).
 * Candidatas: a placa que estava em p e as placas em volta (até a distância que andaram). Uma
 * candidata serve se, desgirando p pela rotação dela, cai em território dela. Se várias servem
 * (sobreposição), a continental fica por cima, como na recomposição; empate fica com a de p.
 */
export function sourcePoint(p: Vec3, m: PlateMotionInput): { point: Vec3; plate: number } | null {
  const candidates: number[] = [m.plateAt(p) & PLATE_MASK];
  if (m.maxDelta > 0) {
    for (const q of probePoints(p, m.maxDelta * 1.5)) {
      const pl = m.plateAt(q) & PLATE_MASK;
      if (!candidates.includes(pl)) candidates.push(pl);
    }
  }
  let best: { point: Vec3; plate: number; continental: boolean } | null = null;
  for (const pl of candidates) {
    const s = rotate(p, m.axis[pl] as Vec3, -(m.delta[pl] as number));
    const v = m.plateAt(s);
    if ((v & PLATE_MASK) !== pl) continue;
    const continental = (v & CONTINENTAL_BIT) !== 0;
    if (!best || (continental && !best.continental)) best = { point: s, plate: pl, continental };
  }
  if (best) return { point: best.point, plate: best.plate };
  const owner = candidates[0] as number;
  if (!m.closing) return null;
  for (const other of candidates.slice(1)) if (m.closing(owner, other, p) < 0) return null;
  return { point: rotate(p, m.axis[owner] as Vec3, -(m.delta[owner] as number)), plate: owner };
}

/**
 * Ângulo a mostrar agora, adiantando o último ângulo recebido do worker pelo tempo desde então
 * (o worker manda o relógio ~60×/s, mas pode atrasar durante uma recomposição). Nunca volta para
 * trás e nunca adianta mais que `maxAhead` segundos.
 */
export function extrapolateAngle(
  received: number,
  ratePerSecond: number,
  secondsSince: number,
  previousShown: number,
  maxAhead = 0.3,
): number {
  const estimate = received + ratePerSecond * Math.min(Math.max(0, secondsSince), maxAhead);
  return Math.max(previousShown, estimate);
}
