import type { DirtyRect } from './globe-renderer';

/**
 * Troca suave das cores que o clima muda (B4, teste da adf001ea: "as mudanças de bioma e de
 * temperatura têm um tranco"). O clima anda em degraus de meio grau; em cada degrau uma faixa de
 * células troca de bioma ou de gelo de uma vez. Aqui cada célula que muda passa da cor antiga para a
 * nova em FADE_MS, no shader: uma textura guarda a cor antiga (rgb) e, no alfa, a hora em que a troca
 * começou (STAMP_MS por unidade, dando a volta em STAMP_WRAP). O alfa NO_FADE diz "sem troca" e o
 * shader nem mistura. Só desenho: a simulação não muda.
 *
 * Esta classe é a parte da CPU (pura, testada): guarda a cópia da textura antiga e diz que pedaços
 * reenviar à GPU.
 */
export const FADE_MS = 600;
export const STAMP_MS = 1000 / 32;
/** Alfa que marca "sem troca" (a hora dá a volta em 0–254). */
export const NO_FADE = 255;
export const STAMP_WRAP = 255;

interface Batch {
  stamp: number;
  at: number;
  rects: DirtyRect[];
}

export interface PatchLike extends DirtyRect {
  data: Uint8Array;
}

export class ClimateFade {
  /** Cópia do que está na textura antiga: rgb da cor antiga e alfa = hora da troca (ou NO_FADE). */
  old: Uint8Array;
  /** Hora exata (ms) da troca de cada célula; −Infinity = nenhuma. */
  private start: Float64Array;
  private batches: Batch[] = [];

  constructor(private n: number) {
    this.old = new Uint8Array(n * n * 6 * 4);
    this.start = new Float64Array(n * n * 6);
    this.reset();
  }

  /** Sem troca nenhuma (mundo novo, recomposição: as cores inteiras foram trocadas). */
  reset(): void {
    for (let k = 3; k < this.old.length; k += 4) this.old[k] = NO_FADE;
    this.start.fill(-Infinity);
    this.batches = [];
  }

  static stamp(now: number): number {
    return Math.floor(now / STAMP_MS) % STAMP_WRAP;
  }

  /** Há troca em andamento (o shader precisa misturar). */
  active(): boolean {
    return this.batches.length > 0;
  }

  /**
   * Chegaram cores novas do clima, ainda não aplicadas em `colors`. Cada célula cuja cor muda começa a
   * troca agora, partindo da cor que está na tela (a antiga, ou a mistura se já estava trocando).
   * Devolve os retângulos da textura antiga a reenviar.
   */
  begin(colors: Uint8Array, patches: readonly PatchLike[], now: number): DirtyRect[] {
    const n = this.n;
    const stamp = ClimateFade.stamp(now);
    const old = this.old;
    const out: DirtyRect[] = [];
    for (const p of patches) {
      const w = p.x1 - p.x0 + 1;
      let changed = false;
      for (let y = p.y0; y <= p.y1; y++) {
        for (let x = p.x0; x <= p.x1; x++) {
          const c = p.face * n * n + y * n + x;
          const o = c * 4;
          const q = ((y - p.y0) * w + (x - p.x0)) * 4;
          const d = p.data;
          if (d[q] === colors[o] && d[q + 1] === colors[o + 1] && d[q + 2] === colors[o + 2]) continue;
          // Cor que está na tela agora: a antiga misturada com a atual pela idade da troca, na mesma
          // conta do shader (hora em degraus de STAMP_MS).
          const f = mixOf(old[o + 3] as number, stamp);
          for (let k = 0; k < 3; k++) {
            const shown = f >= 1 ? (colors[o + k] as number) : (old[o + k] as number) + ((colors[o + k] as number) - (old[o + k] as number)) * f;
            old[o + k] = Math.round(shown);
          }
          old[o + 3] = stamp;
          this.start[c] = now;
          changed = true;
        }
      }
      if (changed) out.push({ face: p.face, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    }
    if (out.length) this.batches.push({ stamp, at: now, rects: out });
    return out;
  }

  /**
   * Trocas que já acabaram: marca NO_FADE (a hora no alfa dá a volta em ~8 s; sem isso uma célula
   * antiga pareceria trocando de novo). Devolve os retângulos a reenviar.
   */
  complete(now: number): DirtyRect[] {
    const out: DirtyRect[] = [];
    const n = this.n;
    while (this.batches.length && now - (this.batches[0] as Batch).at >= FADE_MS + 4 * STAMP_MS) {
      const b = this.batches.shift() as Batch;
      for (const r of b.rects) {
        for (let y = r.y0; y <= r.y1; y++) {
          for (let x = r.x0; x <= r.x1; x++) {
            const c = r.face * n * n + y * n + x;
            if (this.start[c] === b.at) this.old[c * 4 + 3] = NO_FADE;
          }
        }
        out.push(r);
      }
    }
    return out;
  }
}

/** Quanto da cor nova o shader mostra (0–1) para o alfa `stamp` da célula, na hora `now` (em degraus). */
export function mixOf(stamp: number, now: number): number {
  if (stamp === NO_FADE) return 1;
  const age = (now - stamp + STAMP_WRAP) % STAMP_WRAP;
  return Math.min(1, (age * STAMP_MS) / FADE_MS);
}
