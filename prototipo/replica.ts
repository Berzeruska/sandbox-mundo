import { buildReplica, REPLICA_SIZE } from '../src/maquete/replica-scene';
import { MaqueteRenderer, type MaqueteCamera } from '../src/render/maquete-renderer';

/** T1: a cena da folha-mestra no motor da maquete. Arrastar gira, roda aproxima (para olhar de perto). */
const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }) as WebGL2RenderingContext;
const renderer = new MaqueteRenderer(gl);
renderer.sunDir = [-0.3, 0.77, -0.56];
renderer.shadowRadius = 62;
renderer.shadowCenter = [REPLICA_SIZE / 2, 2, REPLICA_SIZE / 2];
renderer.background = [0.459, 0.459, 0.463];
const t0 = performance.now();
const chunks = buildReplica();
const buildMs = performance.now() - t0;
for (const [k, c] of chunks.entries()) {
  const edge = [c.ox + 32 >= REPLICA_SIZE, c.ox === 0, c.oz + 32 >= REPLICA_SIZE, c.oz === 0];
  renderer.setChunk(k, c, [0, 0, 1, 0], edge);
}
const view: MaqueteCamera = { x: 23.85, y: 2, z: 41.25, yaw: -0.7646, pitch: 0.4365, distance: 255.8, fov: 11.1 };
const q = new URLSearchParams(location.search);
for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'distance', 'fov'] as const) if (q.has(k)) view[k] = Number(q.get(k));
function fit(): void {
  const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(t: number): void {
  fit();
  renderer.draw(view, canvas.width, canvas.height, t / 1000);
  requestAnimationFrame(frame);
}
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e: PointerEvent) => {
  if (!drag) return;
  view.yaw -= (e.clientX - drag.x) * 0.005;
  view.pitch = Math.max(0.1, Math.min(1.4, view.pitch + (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.distance *= Math.exp(e.deltaY * 0.001); }, { passive: false });
requestAnimationFrame(frame);
(window as unknown as { replica: unknown }).replica = { view, renderer, buildMs };
