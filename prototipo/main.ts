import { seedFrom } from '../src/core/rng';
import { quatFromBasis } from '../src/core/quat';
import { Camera } from '../src/render/camera';
import { buildColors } from '../src/render/colors';
import { GlobeRenderer } from '../src/render/globe-renderer';
import { createWorld } from '../src/world/create';
import type { WorldState } from '../src/world/state';
import { RawRenderer } from './raw-renderer';
import { buildScene, eyeOf, lookAt, pickRegion, REGION, stepFigures, viewProjection, type Scene, type View } from './scene';
import { STYLES } from './styles';
import { drawFar } from './far2d';

/**
 * Protótipo do portão do M3 (não é o jogo; nada aqui entra no M3 sem a aprovação do usuário).
 * URL: ?motor=webgl2|three|sprites &estilo=0..4 &carga=1 &aa=1 &passagem=1 &semente=terra
 */
const q = new URLSearchParams(location.search);
const motor = q.get('motor') ?? 'webgl2';
const styleIndex = Math.max(0, Math.min(STYLES.length - 1, Number(q.get('estilo') ?? 0)));
const load = Number(q.get('carga') ?? 1);
const aa = q.get('aa') !== '0';
const passage = q.get('passagem') === '1';
const seedText = q.get('semente') ?? 'terra';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

function resize(): void {
  canvas.width = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
  canvas.height = Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2));
}
resize();

const t0 = performance.now();
const world: WorldState = createWorld({ seedText, seed: seedFrom(seedText), n: 256, seaLevel: 0, landFraction: 0.3 });
const worldMs = performance.now() - t0;
const at = pickRegion(world);
const scene: Scene = buildScene(world, at, STYLES[styleIndex] as (typeof STYLES)[number], { load });

const view: View = { x: REGION / 2, z: REGION / 2, yaw: -0.65, pitch: 0.9, distance: 112, fov: 28 };
const aspect = () => canvas.width / canvas.height;

interface Backend {
  gl: WebGL2RenderingContext;
  drawCalls(): number;
  frame(time: number): void;
}

async function makeBackend(): Promise<Backend> {
  if (motor === 'three') {
    // Carregado só nesta opção, para o tamanho do Three.js ficar à parte e ser medido.
    const { ThreeRenderer } = await import('./three-renderer');
    const r = new ThreeRenderer(canvas, scene);
    return {
      gl: r.renderer.getContext() as WebGL2RenderingContext,
      drawCalls: () => r.drawCalls,
      frame: (time) => {
        r.updateFigures();
        r.draw(view, aspect(), time);
      },
    };
  }
  const gl = canvas.getContext('webgl2', { antialias: aa, powerPreference: 'high-performance', alpha: false }) as WebGL2RenderingContext;
  const r = new RawRenderer(gl, scene, motor === 'sprites');
  const basis = () => {
    const e = eyeOf(view);
    const v = lookAt(e, [view.x, 0, view.z], [0, 1, 0]);
    return { right: [v[0] as number, v[4] as number, v[8] as number], up: [v[1] as number, v[5] as number, v[9] as number] };
  };
  if (!passage) {
    return {
      gl,
      drawCalls: () => r.drawCalls,
      frame: (time) => {
        r.updateFigures();
        const b = basis();
        r.draw(viewProjection(view, aspect()), b.right, b.up, time, { clear: true, fade: 1, relief: 1, grow: 1 });
      },
    };
  }
  return makePassage(gl, r, basis);
}

/** (b) Do globo em 2D ao diorama, ao aproximar: mesmo canvas, mesmo contexto do globo do jogo. */
function makePassage(gl: WebGL2RenderingContext, r: RawRenderer, basis: () => { right: number[]; up: number[] }): Backend {
  // Para as imagens do item (f) do portão: o mesmo mundo sem as manchas das jazidas.
  if (q.get('jazidas') === '0') world.deposit.fill(0);
  const colors = new Uint8Array(world.cellCount * 4);
  buildColors(world, colors);
  const globe = new GlobeRenderer(canvas, world.grid.n, colors);
  globe.clouds = 0;
  globe.setPlates(new Uint8Array(world.cellCount));
  globe.setDeposits(world.deposit);
  const camera = new Camera();
  camera.setCellAngle(world.grid.cellAngle);
  camera.setViewport(canvas.width, canvas.height);
  // Câmera do globo alinhada à região: x da região para a direita, y da região para baixo.
  const g = world.grid;
  const point = (x: number, y: number): [number, number, number] => g.cellToPoint(at.face, at.x0 + (at.flip ? REGION - 1 - x : x), at.y0 + y) as [number, number, number];
  const c = point(REGION / 2, REGION / 2), px = point(REGION / 2 + 1, REGION / 2), py = point(REGION / 2, REGION / 2 + 1);
  const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((a) => a / l) as [number, number, number]; };
  const ex = unit(px.map((a, i) => a - (c[i] as number)));
  const ey = unit(py.map((a, i) => a - (c[i] as number)));
  const down: [number, number, number] = [-ey[0], -ey[1], -ey[2]];
  camera.setOrientation(quatFromBasis(ex, down, c));
  const s = { zoomPx: 2 };
  const overlay = darken(gl);
  (window as unknown as { passage: unknown }).passage = {
    set(cellPx: number) { s.zoomPx = cellPx; },
    get: () => s.zoomPx,
    t: 0,
  };
  const START = 8, END = 24;
  return {
    gl,
    drawCalls: () => r.drawCalls,
    frame: (time) => {
      camera.zoom = s.zoomPx / (camera.baseRadius() * camera.cellAngle);
      const u = Math.max(0, Math.min(1, (s.zoomPx - START) / (END - START)));
      const t = u * u * (3 - 2 * u);
      r.resetState();
      // Com a maquete pronta, o globo não é mais desenhado (ele custa tanto quanto ela).
      if (t < 1) globe.draw(camera);
      if (t <= 0) return;
      if (t < 1) overlay(t);
      r.updateFigures();
      // De cima, exatamente onde a região está no globo (ortográfica), até a vista inclinada de maquete.
      const px2 = s.zoomPx * 2;
      const top = new Float32Array([px2 / canvas.width, 0, 0, 0, 0, 0, -0.002, 0, 0, -px2 / canvas.height, 0, 0, (-REGION / 2 * px2) / canvas.width, 0, 0, 0]);
      top[13] = (REGION / 2 * px2) / canvas.height;
      top[15] = 1;
      top[14] = -0.5;
      const distance = (view.distance * END) / Math.max(s.zoomPx, END);
      const final = viewProjection({ ...view, yaw: 0, distance }, aspect());
      const vp = new Float32Array(16);
      for (let k = 0; k < 16; k++) vp[k] = (top[k] as number) * (1 - t) + (final[k] as number) * t;
      const b = basis();
      r.draw(vp, b.right, b.up, time, { clear: t >= 1, fade: Math.min(1, u * 5), relief: t, grow: Math.max(0.0001, Math.min(1, t * 1.05)) });
    },
  };
}

/** Escurece o globo em volta da maquete, conforme ela sobe. */
function darken(gl: WebGL2RenderingContext): (alpha: number) => void {
  const p = gl.createProgram() as WebGLProgram;
  const vs = gl.createShader(gl.VERTEX_SHADER) as WebGLShader, fs = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
  gl.shaderSource(vs, '#version 300 es\nvoid main(){ vec2 q = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(q, 0.0, 1.0); }');
  gl.shaderSource(fs, '#version 300 es\nprecision lowp float; uniform vec4 uColor; out vec4 f; void main(){ f = uColor; }');
  gl.compileShader(vs); gl.compileShader(fs);
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  const u = gl.getUniformLocation(p, 'uColor');
  const bg = scene.style.background;
  return (alpha) => {
    gl.useProgram(p);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(u, bg[0], bg[1], bg[2], alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  };
}

interface Sample { frameMs: number[]; cpuMs: number[]; gpuMs: number[] }

const backend = await makeBackend();
const gl = backend.gl;
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const pending: WebGLQuery[] = [];
let sample: Sample | null = null;
let forceResolve = false;
const px = new Uint8Array(4);
let last = performance.now();
let path: ((elapsed: number) => void) | null = null;
let pathStart = 0;
let frames = 0, fpsAt = last, fps = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  const frameMs = now - last;
  last = now;
  if (path) path(now - pathStart);
  stepFigures(scene, dt);
  const cpu = performance.now();
  let query: WebGLQuery | null = null;
  if (timer && sample && pending.length < 6) {
    query = gl.createQuery();
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  }
  backend.frame(now / 1000);
  // Com serrilhado suavizado, a resolução dele só conta se acontecer dentro da consulta.
  if (forceResolve) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  if (query && timer) {
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    pending.push(query);
  }
  const cpuMs = performance.now() - cpu;
  while (pending.length && gl.getQueryParameter(pending[0] as WebGLQuery, gl.QUERY_RESULT_AVAILABLE)) {
    const done = pending.shift() as WebGLQuery;
    const ns = gl.getQueryParameter(done, gl.QUERY_RESULT) as number;
    gl.deleteQuery(done);
    if (sample && !(timer && gl.getParameter(timer.GPU_DISJOINT_EXT))) sample.gpuMs.push(ns / 1e6);
  }
  if (sample) {
    sample.frameMs.push(frameMs);
    sample.cpuMs.push(cpuMs);
  }
  frames++;
  if (now - fpsAt > 500) {
    fps = (frames * 1000) / (now - fpsAt);
    frames = 0;
    fpsAt = now;
    hud.textContent = `${motor} · ${fps.toFixed(0)} fps · ${Math.round(scene.triangles / 1000)} mil triângulos · ${backend.drawCalls()} desenhos`;
  }
  requestAnimationFrame(loop);
}

const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { mean: +(a.reduce((m, x) => m + x, 0) / Math.max(1, a.length)).toFixed(2), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2), worst: +(s[s.length - 1] ?? 0).toFixed(1) };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const api = {
  info: () => ({ motor, style: STYLES[styleIndex]?.name, load, aa, worldMs: Math.round(worldMs), buildMs: Math.round(scene.buildMs), triangles: Math.round(scene.triangles), counts: scene.counts, region: at, drawCalls: backend.drawCalls(), gpu: (() => { const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; })() }),
  view,
  hideHud() { hud.style.display = 'none'; },
  goto(name: 'cidade' | 'vila' | 'montanha' | 'floresta', distance: number) { const s = scene.spots[name]; Object.assign(view, { x: s.x, z: s.z, distance, pitch: 0.72 }); },
  far2d() { return drawFar(world, at, scene).toDataURL('image/png'); },
  /** (e) O mundo de hoje projetado em mapa plano, só para as imagens de comparação. */
  flatMap(kind: 'semLigar' | 'cilindro' | 'toro') {
    const W = 960, H = 480;
    const colors = new Uint8Array(world.cellCount * 4);
    buildColors(world, colors);
    const c = document.createElement('canvas');
    c.width = kind === 'semLigar' ? W : W * 2;
    c.height = kind === 'toro' ? H * 2 : H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // Sem ligar: só a faixa sem os polos e com mar nas bordas. Ligando em cima e embaixo: o espelho do mundo fecha a costura.
      const lon = (x / W) * Math.PI * 2 - Math.PI;
      const v = kind === 'cilindro' ? y / H : y / H;
      const lat = kind === 'cilindro' ? (0.5 - v) * Math.PI : (0.5 - v) * (Math.PI / 1.6);
      const cell = world.grid.pointToCell(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      let r = colors[cell * 4] as number, g = colors[cell * 4 + 1] as number, b = colors[cell * 4 + 2] as number;
      if (kind === 'semLigar') {
        const edge = Math.min(x, W - x, y, H - y) / 46;
        if (edge < 1) { const k = Math.max(0, edge); r = r * k + 22 * (1 - k); g = g * k + 52 * (1 - k); b = b * k + 110 * (1 - k); }
      }
      const o = (y * W + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (kind !== 'semLigar') ctx.drawImage(c, 0, 0, W, H, W, 0, W, H);
    if (kind === 'toro') { ctx.save(); ctx.translate(0, H * 2); ctx.scale(1, -1); ctx.drawImage(c, 0, 0, W * 2, H, 0, 0, W * 2, H); ctx.restore(); }
    return c.toDataURL('image/png');
  },
  /** Mede `ms` com o caminho de câmera dado (fps), depois a GPU com a suavização incluída. */
  async measure(name: 'orbita' | 'perto' | 'chao', ms: number) {
    const base = { ...view };
    const paths = {
      orbita: (e: number) => { view.yaw = base.yaw + (e / 1000) * 0.5; },
      perto: (e: number) => { view.distance = 34; view.yaw = base.yaw + (e / 1000) * 0.5; },
      chao: (e: number) => { view.distance = 22; view.pitch = 0.45; view.yaw = base.yaw + (e / 1000) * 0.5; },
    };
    path = paths[name];
    pathStart = performance.now();
    await wait(500);
    sample = { frameMs: [], cpuMs: [], gpuMs: [] };
    await wait(ms);
    const a = sample;
    sample = { frameMs: [], cpuMs: [], gpuMs: [] };
    forceResolve = true;
    await wait(2500);
    forceResolve = false;
    const g = sample;
    sample = null;
    path = null;
    Object.assign(view, base);
    const over = a.frameMs.filter((x) => x > 50).length;
    return { name, frames: a.frameMs.length, fps: +(1000 / (stats(a.frameMs).mean || 1)).toFixed(1), frame: stats(a.frameMs), over50: over, cpu: stats(a.cpuMs), gpu: stats(g.gpuMs) };
  },
  /** Mede quadros e GPU enquanto `set(p)` varre de 0 a 1. */
  async sweep(set: (p: number) => void, ms: number) {
    path = (e) => set(Math.min(1, e / ms));
    pathStart = performance.now();
    forceResolve = true;
    sample = { frameMs: [], cpuMs: [], gpuMs: [] };
    await wait(ms);
    const a = sample;
    sample = null;
    forceResolve = false;
    path = null;
    return { frames: a.frameMs.length, fps: +(1000 / (stats(a.frameMs).mean || 1)).toFixed(1), frame: stats(a.frameMs), cpu: stats(a.cpuMs), gpu: stats(a.gpuMs) };
  },
};
(window as unknown as { proto: typeof api }).proto = api;
requestAnimationFrame(loop);

// Girar com o dedo ou o mouse, aproximar com a roda ou a pinça.
let dragging: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { dragging = null; });
addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging) return;
  view.yaw -= (e.clientX - dragging.x) * 0.005;
  view.pitch = Math.max(0.35, Math.min(1.45, view.pitch + (e.clientY - dragging.y) * 0.004));
  dragging = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pass = (window as unknown as { passage?: { set(v: number): void; get(): number } }).passage;
  if (pass) pass.set(Math.max(0.5, Math.min(48, pass.get() * Math.exp(-e.deltaY * 0.001))));
  else view.distance = Math.max(14, Math.min(200, view.distance * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
