/**
 * Relógio da GPU para o "Medir desempenho". O Chrome o oferece sempre. O Firefox só com a preferência
 * `webgl.enable-privileged-extensions` ligada em about:config, e com outro nome de extensão.
 * Sem relógio, o tempo é medido esperando a GPU (ler 1 pixel), o que no Firefox dá 2 a 3 ms a mais que o real
 * (comparado no notebook com o relógio, 2026-11-06: 4,9 contra 2,5 ms; 7,3 contra 5,3 ms).
 */
export interface GpuClock {
  begin(): WebGLQuery;
  end(): void;
  ready(q: WebGLQuery): boolean;
  /** Milissegundos. */
  read(q: WebGLQuery): number;
  disjoint(): boolean;
  free(q: WebGLQuery): void;
}

export const CLOCK_METHOD = 'relógio da GPU: preciso';
export const WAIT_METHOD = 'espera da GPU: no Firefox dá 2 a 3 ms acima do real; para o relógio, ligue webgl.enable-privileged-extensions em about:config';

interface Webgl2Ext { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface FirefoxExt extends Webgl2Ext {
  QUERY_RESULT_EXT: number;
  QUERY_RESULT_AVAILABLE_EXT: number;
  createQueryEXT(): WebGLQuery;
  deleteQueryEXT(q: WebGLQuery): void;
  beginQueryEXT(target: number, q: WebGLQuery): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(q: WebGLQuery, name: number): number | boolean;
}

export function gpuClock(gl: WebGL2RenderingContext): GpuClock | null {
  const a = gl.getExtension('EXT_disjoint_timer_query_webgl2') as Webgl2Ext | null;
  if (a) {
    return {
      begin: () => { const q = gl.createQuery() as WebGLQuery; gl.beginQuery(a.TIME_ELAPSED_EXT, q); return q; },
      end: () => gl.endQuery(a.TIME_ELAPSED_EXT),
      ready: (q) => !!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE),
      read: (q) => (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6,
      disjoint: () => !!gl.getParameter(a.GPU_DISJOINT_EXT),
      free: (q) => gl.deleteQuery(q),
    };
  }
  const f = gl.getExtension('EXT_disjoint_timer_query') as FirefoxExt | null;
  if (f) {
    return {
      begin: () => { const q = f.createQueryEXT(); f.beginQueryEXT(f.TIME_ELAPSED_EXT, q); return q; },
      end: () => f.endQueryEXT(f.TIME_ELAPSED_EXT),
      ready: (q) => !!f.getQueryObjectEXT(q, f.QUERY_RESULT_AVAILABLE_EXT),
      read: (q) => (f.getQueryObjectEXT(q, f.QUERY_RESULT_EXT) as number) / 1e6,
      disjoint: () => !!gl.getParameter(f.GPU_DISJOINT_EXT),
      free: (q) => f.deleteQueryEXT(q),
    };
  }
  return null;
}

/** Mede `frames` desenhos, um por quadro, pelo relógio ou esperando a GPU. */
export async function measureFrames(gl: WebGL2RenderingContext, frames: number, draw: () => void): Promise<{ ms: number[]; method: string }> {
  const clock = gpuClock(gl), px = new Uint8Array(4);
  const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  if (clock) {
    const queries: WebGLQuery[] = [];
    for (let k = 0; k < frames; k++) {
      const q = clock.begin();
      draw();
      clock.end();
      queries.push(q);
      await nextFrame();
    }
    const last = queries[queries.length - 1] as WebGLQuery;
    for (let tries = 0; tries < 40 && !clock.ready(last); tries++) await nextFrame();
    const bad = clock.disjoint(), ms: number[] = [];
    for (const q of queries) {
      if (!bad && clock.ready(q)) ms.push(clock.read(q));
      clock.free(q);
    }
    if (ms.length >= frames / 2) return { ms, method: CLOCK_METHOD };
  }
  const sync: number[] = [];
  for (let k = 0; k < frames; k++) {
    const t0 = performance.now();
    draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    sync.push(performance.now() - t0);
  }
  return { ms: sync, method: WAIT_METHOD };
}
