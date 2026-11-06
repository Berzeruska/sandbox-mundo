import { bakeProps, type Placement } from '../src/maquete/chunk-build';
import { PLANT_STATES, plant, SPECIES } from '../src/maquete/plants';
import { eyeOf, lookAt, MaqueteRenderer, multiply, perspective, type MaqueteCamera } from '../src/render/maquete-renderer';

/** Folhas de conferência: cada modelo no motor, para comparar com as referências. `?folha=plantas`. */
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext;
const renderer = new MaqueteRenderer(gl);
const q = new URLSearchParams(location.search);
const list: Placement[] = [];
const labels: { x: number; z: number; text: string }[] = [];
const white: readonly [number, number, number] = [1, 1, 1];
const stateGap = 2.55, colGap = stateGap * 4 + 1.2, rowGap = 7.6;
SPECIES.forEach((s, i) => {
  const row = Math.floor(i / 5), col = i % 5;
  PLANT_STATES.forEach((st, k) => {
    list.push({ model: plant(s, st, 0), x: col * colGap + k * stateGap, y: 0, z: row * rowGap, scale: 1, stretch: 1, yaw: 0.5, tint: white });
  });
  labels.push({ x: col * colGap + stateGap * 1.5, z: row * rowGap + 1.3, text: s });
});
void q;
renderer.setChunk(1, { terrain: new ArrayBuffer(0), water: new ArrayBuffer(0), props: bakeProps(list), skirts: new ArrayBuffer(0), skirtRanges: [[0, 0], [0, 0], [0, 0], [0, 0]] }, [0, 0, 1, 0], [false, false, false, false]);
renderer.sunDir = [-0.42, 0.76, 0.5];
renderer.shadowCenter = [28, 0, 12]; renderer.shadowRadius = 44;
const view: MaqueteCamera = { x: 27.5, y: 1, z: 11.4, yaw: 0, pitch: 0.62, distance: 76, fov: 26 };
const vp = multiply(perspective(view.fov, canvas.width / canvas.height, 1, 400), lookAt(eyeOf(view), [view.x, view.y, view.z], [0, 1, 0]));
const box = document.getElementById('labels') as HTMLElement;
for (const l of labels) {
  const m = vp, cw = (m[3] as number) * l.x + (m[11] as number) * l.z + (m[15] as number);
  const cx = (m[0] as number) * l.x + (m[8] as number) * l.z + (m[12] as number), cy = (m[1] as number) * l.x + (m[9] as number) * l.z + (m[13] as number);
  const e = document.createElement('span');
  e.textContent = l.text;
  e.style.left = `${((cx / cw) * 0.5 + 0.5) * canvas.clientWidth}px`;
  e.style.top = `${(0.5 - (cy / cw) * 0.5) * canvas.clientHeight}px`;
  box.append(e);
}
(function frame(t: number) { renderer.draw(view, canvas.width, canvas.height, t / 1000); requestAnimationFrame(frame); })(0);
