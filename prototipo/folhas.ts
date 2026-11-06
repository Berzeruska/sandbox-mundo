import { bakeProps, type Placement } from '../src/maquete/chunk-build';
import { ANIMALS, animalModel } from '../src/maquete/animals';
import { depositModel } from '../src/maquete/deposits';
import { Resource } from '../src/world/resources';
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
const folha = q.get('folha') ?? 'plantas';
if (folha === 'jazidas') {
  const names = Object.entries(Resource).filter(([, v]) => v !== 0);
  names.forEach(([name, type], i) => {
    const col = i % 7, row = Math.floor(i / 7);
    list.push({ model: depositModel(type, 0), x: col * 4.6 + (row === 1 ? 0 : 0), y: 0, z: row * 5, scale: 1.6, stretch: 1, yaw: 0.6, tint: white });
    labels.push({ x: col * 4.6, z: row * 5 + 2.2, text: name });
  });
} else if (folha.startsWith('animais')) {
  const page = Number(folha.slice(7) || 1) - 1, perPage = 9;
  ANIMALS.slice(page * perPage, (page + 1) * perPage).forEach((a, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    (['idle', 'dead'] as const).forEach((pose, k) => {
      list.push({ model: animalModel(a, pose), x: col * 19 + k * 7, y: 0, z: row * 7, scale: 1, stretch: 1, yaw: -0.45, tint: white });
    });
    labels.push({ x: col * 19 + 7, z: row * 7 + 2, text: a });
  });
} else {
const stateGap = 2.55, colGap = stateGap * 4 + 1.2, rowGap = 7.6;
SPECIES.forEach((s, i) => {
  const row = Math.floor(i / 5), col = i % 5;
  PLANT_STATES.forEach((st, k) => {
    list.push({ model: plant(s, st, 0), x: col * colGap + k * stateGap, y: 0, z: row * rowGap, scale: 1, stretch: 1, yaw: 0.5, tint: white });
  });
  labels.push({ x: col * colGap + stateGap * 1.5, z: row * rowGap + 1.3, text: s });
});
}
renderer.setChunk(1, { terrain: new ArrayBuffer(0), water: new ArrayBuffer(0), props: new ArrayBuffer(0), propsFar: bakeProps(list), skirts: new ArrayBuffer(0), skirtRanges: [[0, 0], [0, 0], [0, 0], [0, 0]] }, [0, 0, 1, 0], [false, false, false, false]);
renderer.sunDir = [-0.42, 0.76, 0.5];
renderer.shadowCenter = [28, 0, 12]; renderer.shadowRadius = 44;
const view: MaqueteCamera = folha === 'jazidas' ? { x: 13.8, y: 0.5, z: 5, yaw: 0, pitch: 0.6, distance: 40, fov: 26 } : folha.startsWith('animais') ? { x: 26, y: 0.5, z: 7, yaw: 0, pitch: 0.55, distance: 80, fov: 26 } : { x: 27.5, y: 1, z: 11.4, yaw: 0, pitch: 0.62, distance: 76, fov: 26 };
for (const k of ['x', 'z', 'distance', 'pitch'] as const) if (q.has(k)) view[k] = Number(q.get(k));
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
