import { seedFrom } from '../src/core/rng';
import { Camera } from '../src/render/camera';
import { buildColors, DECOR_BIT } from '../src/render/colors';
import { GlobeRenderer } from '../src/render/globe-renderer';
import { emptyWork, FrameRecorder, formatReport, powerLabel, scenarioInvalid, type GpuSample, type ScenarioResult } from '../src/ui/benchmark';
import { Biome } from '../src/world/biomes';
import { createWorld } from '../src/world/create';
import { depositType } from '../src/world/resources';
import type { WorldState } from '../src/world/state';
import { FinalPass, type AaMode } from './aa';
import { ChunkWorld, type Camera3D } from './chunks';
import { CHUNK, RELIEFS, type City, type Relief, type WorldData } from './detail';
import { bakePlanet, FAR_MODES, patchGlobeShader, uploadAtlas, type FarMode } from './far-style';
import { drawOccupation, occupy, type Occupation } from './occupation';
import { NOON, paletteMetrics, paletteOf, PALETTES } from './palettes';
import { pickRegion, REGION } from './scene';

/**
 * Protótipo do portão do M3: de longe o globo, de perto a maquete em pedaços, sem os dois juntos na tela (itens 1.5 e 1.6). Nada aqui entra no jogo sem aprovação.
 * URL: ?paleta=0..5 &longe=jogo|chapado|procedural|atlas|prerender|misto &relevo=degrau|rampa|escada|baixo|lisa|terraco &aa=fxaa|msaa4|msaa2|off &detalhe=1|4 &carga=1 &n=256 &semente=terra
 */
const q = new URLSearchParams(location.search);
const options = {
  palette: Math.max(0, Math.min(PALETTES.length - 1, Number(q.get('paleta') ?? 4))),
  far: (FAR_MODES.find((m) => m === q.get('longe')) ?? 'atlas') as FarMode,
  relief: (RELIEFS.find((m) => m === q.get('relevo')) ?? 'terraco') as Relief,
  aa: (q.get('aa') ?? 'fxaa') as AaMode,
  D: Number(q.get('detalhe') ?? 4),
  load: Number(q.get('carga') ?? 1),
  n: Number(q.get('n') ?? 256),
  seed: q.get('semente') ?? 'terra',
};

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const version = document.getElementById('version') as HTMLElement;
const bench = document.getElementById('bench') as HTMLButtonElement;
canvas.width = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
canvas.height = Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2));
const pageStart = performance.now();

// Com MSAA 2× o quadro é copiado para a tela, e a cópia exige o mesmo formato nos dois lados (com alfa).
const gl = canvas.getContext('webgl2', { antialias: options.aa === 'msaa4', alpha: options.aa === 'msaa2', powerPreference: 'high-performance', preserveDrawingBuffer: q.has('fotos') }) as WebGL2RenderingContext;
const shaderSource = gl.shaderSource.bind(gl), linkProgram = gl.linkProgram.bind(gl);
const ATLAS_UNIT = 12, BAKE_UNIT = 13;
gl.shaderSource = (s, src) => shaderSource(s, patchGlobeShader(src, options.far));
gl.linkProgram = (p) => {
  linkProgram(p);
  const a = gl.getUniformLocation(p, 'uFarAtlas'), b = gl.getUniformLocation(p, 'uFarBake');
  if (a || b) {
    const was = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    gl.useProgram(p);
    if (a) gl.uniform1i(a, ATLAS_UNIT);
    if (b) gl.uniform1i(b, BAKE_UNIT);
    gl.useProgram(was);
  }
};

const worldStart = performance.now();
const world: WorldState = createWorld({ seedText: options.seed, seed: seedFrom(options.seed), n: options.n, seaLevel: 0, landFraction: 0.3 });
const worldMs = performance.now() - worldStart;
const g = world.grid, n = g.n;
const paletteOption = PALETTES[options.palette] as (typeof PALETTES)[number];
const palette = paletteOf(paletteOption);

const colors = new Uint8Array(world.cellCount * 4);
buildColors(world, colors);
if (q.get('paleta') !== 'jogo') {
  for (let c = 0; c < world.cellCount; c++) {
    const o = c * 4, b = (colors[o + 3] as number) & 15, rgb = palette.biome[b] as readonly [number, number, number];
    const decor = (colors[o + 2] as number) & DECOR_BIT;
    colors[o] = rgb[0] * 255;
    colors[o + 1] = rgb[1] * 255;
    colors[o + 2] = ((rgb[2] * 255) & ~DECOR_BIT) | decor;
  }
}
const globe = new GlobeRenderer(canvas, n, colors);
globe.clouds = q.get('nuvens') === '1' ? 1 : 0;
globe.setPlates(new Uint8Array(world.cellCount));
globe.setDeposits(world.deposit);
if (options.far === 'atlas' || options.far === 'misto') uploadAtlas(gl, palette.biome, ATLAS_UNIT);
const faceUp = (face: number): [number, number] => {
  const c = g.cellToPoint(face, n >> 1, n >> 1), a = g.cellToPoint(face, (n >> 1) + 1, n >> 1), b = g.cellToPoint(face, n >> 1, (n >> 1) + 1);
  const north = [0 - (c[0] as number) * (c[1] as number), 1 - (c[1] as number) * (c[1] as number), 0 - (c[2] as number) * (c[1] as number)];
  const dot = (p: readonly number[]) => (north[0] as number) * ((p[0] as number) - (c[0] as number)) + (north[1] as number) * ((p[1] as number) - (c[1] as number)) + (north[2] as number) * ((p[2] as number) - (c[2] as number));
  const ux = dot(a), uy = dot(b);
  return Math.abs(ux) > Math.abs(uy) ? [Math.sign(ux), 0] : [0, Math.sign(uy) || 1];
};
const bakeInfo = options.far === 'prerender'
  ? bakePlanet(gl, n, (f, x, y) => (colors[g.index(f, x, y) * 4 + 3] as number) & 15, faceUp, palette.biome, BAKE_UNIT)
  : null;

const start = pickRegion(world);
const camera = new Camera();
camera.setCellAngle(g.cellAngle);
camera.setViewport(canvas.width, canvas.height);
{
  const c = g.cellToPoint(start.face, start.x0 + REGION / 2, start.y0 + REGION / 2);
  camera.lookAt([c[0] as number, c[1] as number, c[2] as number]);
}
const pxPerCell = () => camera.cellPixels();
const setPx = (px: number) => { camera.zoom = Math.max(camera.minZoom, px / (camera.baseRadius() * g.cellAngle)); };

/** Passagem (item 1.5): aproximando além de CUT px por célula grande, a vista crava na maquete; afastando além de MAX_DIST, volta ao globo. */
const CUT = 32, PRELOAD = 18, MAX_DIST = 150, MIN_DIST = 22, ENTRY_DIST = 130;
const view: Camera3D = { x: 0, z: 0, yaw: 0, pitch: 0.9, distance: ENTRY_DIST, fov: 28 };
const faceFlip = (face: number): boolean => {
  const c = g.cellToPoint(face, n >> 1, n >> 1), a = g.cellToPoint(face, (n >> 1) + 1, n >> 1), b = g.cellToPoint(face, n >> 1, (n >> 1) + 1);
  const ux = (a[0] as number) - (c[0] as number), uy = (a[1] as number) - (c[1] as number), uz = (a[2] as number) - (c[2] as number);
  const vx = (c[0] as number) - (b[0] as number), vy = (c[1] as number) - (b[1] as number), vz = (c[2] as number) - (b[2] as number);
  return (uy * vz - uz * vy) * (c[0] as number) + (uz * vx - ux * vz) * (c[1] as number) + (ux * vy - uy * vx) * (c[2] as number) < 0;
};

function faceData(face: number, flip: boolean, jitter = 0): WorldData {
  const D = options.D;
  const height = new Float32Array(n * n), biome = new Uint8Array(n * n), water = new Uint8Array(n * n), deposit = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = g.index(face, flip ? n - 1 - x : x, y), i = y * n + x;
    height[i] = Math.max(0, world.heightAboveSea(c)) + (jitter ? (((Math.imul(x, 73) ^ Math.imul(y, 37)) >>> 0) % 40) * jitter : 0);
    biome[i] = world.biome[c] as number;
    water[i] = world.isWater(c) ? 1 : 0;
    deposit[i] = depositType(world.deposit[c] as number);
  }
  // Cidades: uma por bloco, no melhor chão do bloco.
  const cities: City[] = [];
  const BLOCK = 24;
  for (let by = 0; by + BLOCK <= n; by += BLOCK) for (let bx = 0; bx + BLOCK <= n; bx += BLOCK) {
    let best = -1, score = -1;
    for (let y = by + 3; y < by + BLOCK - 3; y += 2) for (let x = bx + 3; x < bx + BLOCK - 3; x += 2) {
      const i = y * n + x, b = biome[i] as number;
      if (water[i] || b === Biome.Mountain || b === Biome.SnowyPeak || b === Biome.Ice) continue;
      const s = (b === Biome.Grassland || b === Biome.Savanna || b === Biome.Steppe ? 2 : 1) - (height[i] as number) / 2000 + ((Math.imul(x, 31) ^ Math.imul(y, 17)) & 7) / 16;
      if (s > score) { score = s; best = i; }
    }
    if (best < 0) continue;
    const big = ((Math.imul(bx, 13) ^ by) & 7) === 0;
    cities.push({ x: ((best % n) + 0.5) * D, z: (Math.floor(best / n) + 0.5) * D, r: big ? 9 * Math.min(D, 2) : 4 * Math.min(D, 2) });
  }
  // Rios: do ponto alto de cada bloco, sempre pelo vizinho mais baixo, até o mar.
  const rivers: Float32Array[] = [];
  const RB = 40;
  for (let by = 0; by + RB <= n; by += RB) for (let bx = 0; bx + RB <= n; bx += RB) {
    let top = -1, h = 500;
    for (let y = by; y < by + RB; y++) for (let x = bx; x < bx + RB; x++) if ((height[y * n + x] as number) > h) { h = height[y * n + x] as number; top = y * n + x; }
    if (top < 0) continue;
    const path: number[] = [];
    let at = top, ok = false;
    for (let s = 0; s < 240; s++) {
      path.push(((at % n) + 0.5) * D, (Math.floor(at / n) + 0.5) * D);
      if (water[at]) { ok = true; break; }
      const x = at % n, y = Math.floor(at / n);
      let next = -1, low = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ax = x + dx, ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
        // Um pouco de sorteio pela posição: rio serpenteia em vez de descer em linha reta.
        const v = (height[ay * n + ax] as number) + (water[ay * n + ax] ? -1000 : 0) + ((Math.imul(ax, 2654435761) ^ Math.imul(ay, 40503)) >>> 24) * 1.2;
        if (v < low && !path.includes((ax + 0.5) * D)) { low = v; next = ay * n + ax; }
      }
      if (next < 0) break;
      at = next;
    }
    if (ok && path.length > 16) rivers.push(new Float32Array(path));
  }
  return { n, D, height, biome, water, deposit, palette, relief: options.relief, cities, rivers, density: options.load };
}

let mode: 'globo' | 'maquete' = 'globo';
let currentFace = -1, currentFlip = false;
let chunks: ChunkWorld | null = null;
const figureCount = Math.round(240 * options.load);

/** Põe a maquete no ponto do planeta sob o centro da tela. */
function aimAtCenter(): void {
  const p = camera.centerPoint();
  const c = g.pointToCell(p[0], p[1], p[2]);
  const face = Math.floor(c / (n * n)), rest = c - face * n * n;
  const gx = rest % n, gy = Math.floor(rest / n);
  if (face !== currentFace) {
    currentFace = face;
    currentFlip = faceFlip(face);
    const data = faceData(face, currentFlip);
    if (chunks) chunks.setWorld(data);
    else chunks = new ChunkWorld(gl, data, NOON, figureCount);
  }
  view.x = ((currentFlip ? n - 1 - gx : gx) + 0.5) * options.D;
  view.z = (gy + 0.5) * options.D;
}

const finalPass = new FinalPass(gl, options.aa);
const stats = { cutWait: [] as number[], cutAskedAt: 0, cuts: 0 };

function goDiorama(): void {
  mode = 'maquete';
  view.distance = ENTRY_DIST;
  // O norte continua para cima, como estava no globo.
  const [ux, uy] = faceUp(currentFace);
  view.yaw = Math.atan2(currentFlip ? ux : -ux, -uy);
  stats.cuts++;
  if (stats.cutAskedAt) stats.cutWait.push(performance.now() - stats.cutAskedAt);
  stats.cutAskedAt = 0;
}
function goGlobe(): void {
  mode = 'globo';
  const x = Math.max(0, Math.min(n - 1, Math.floor(view.x / options.D))), y = Math.max(0, Math.min(n - 1, Math.floor(view.z / options.D)));
  const p = g.cellToPoint(currentFace, currentFlip ? n - 1 - x : x, y);
  camera.lookAt([p[0] as number, p[1] as number, p[2] as number]);
  setPx(CUT * 0.7);
}

const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const pendingQ: WebGLQuery[] = [];
let gpuOut: number[] | null = null;
let forceResolve = false;
const pixel = new Uint8Array(4);
let recorder: FrameRecorder | null = null;
let last = performance.now();
let script: ((elapsedMs: number, dt: number) => void) | null = null;
let scriptStart = 0;
let frames = 0, fpsAt = last, fps = 0;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function restoreForGlobe(): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.activeTexture(gl.TEXTURE0);
  for (const l of [4, 5, 6, 7]) { gl.vertexAttribDivisor(l, 0); gl.disableVertexAttribArray(l); }
  gl.bindVertexArray(null);
}

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (script) script(now - scriptStart, dt);
  const work = performance.now();
  // Perto do corte, os pedaços já vão carregando, para a maquete estar pronta quando a vista cravar.
  if (mode === 'globo' && pxPerCell() >= PRELOAD) aimAtCenter();
  // No globo a GPU está folgada e a maquete não está na tela: sobe mais de um pedaço por quadro.
  if (chunks && (mode === 'maquete' || pxPerCell() >= PRELOAD)) chunks.update(view, mode === 'maquete' ? 1 : 3);
  if (mode === 'globo' && pxPerCell() >= CUT && chunks) {
    if (!stats.cutAskedAt) stats.cutAskedAt = now;
    // Basta o que aparece no primeiro quadro (raio de 2 pedaços); o resto chega logo depois, ainda fora da vista.
    if (chunks.pending(view, 8) === 0) goDiorama();
  } else if (mode === 'globo') stats.cutAskedAt = 0;
  let query: WebGLQuery | null = null;
  if (timer && gpuOut && pendingQ.length < 6) {
    query = gl.createQuery();
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  }
  if (mode === 'maquete' && chunks) {
    chunks.stepFigures(view, dt);
    chunks.draw(view, canvas.width / canvas.height, now / 1000, finalPass.target(canvas.width, canvas.height), canvas.width, canvas.height);
    finalPass.finish();
    gl.bindVertexArray(null);
  } else {
    restoreForGlobe();
    globe.draw(camera);
  }
  if (forceResolve) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (query && timer) { gl.endQuery(timer.TIME_ELAPSED_EXT); pendingQ.push(query); }
  while (pendingQ.length && gl.getQueryParameter(pendingQ[0] as WebGLQuery, gl.QUERY_RESULT_AVAILABLE)) {
    const done = pendingQ.shift() as WebGLQuery;
    const ns = gl.getQueryParameter(done, gl.QUERY_RESULT) as number;
    gl.deleteQuery(done);
    if (gpuOut && !(timer && gl.getParameter(timer.GPU_DISJOINT_EXT))) gpuOut.push(ns / 1e6);
  }
  if (recorder) recorder.frame(now, performance.now() - work);
  frames++;
  if (now - fpsAt > 500) {
    fps = (frames * 1000) / (now - fpsAt);
    frames = 0;
    fpsAt = now;
    if (mode === 'maquete' && chunks) hud.textContent = `Maquete · ${fps.toFixed(0)} fps · ${chunks.loadedCount} pedaços · ${Math.round(chunks.triangles / 1000)} mil triângulos · arraste para andar, roda para aproximar`;
    else hud.textContent = `Globo · ${fps.toFixed(0)} fps · ${pxPerCell().toFixed(1)} px por célula · aproxime até ${CUT} para entrar na maquete`;
  }
  requestAnimationFrame(loop);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (a: readonly number[]) => a.reduce((m, x) => m + x, 0) / Math.max(1, a.length);
const sorted = (a: readonly number[]) => [...a].sort((x, y) => x - y);
const p95 = (a: readonly number[]) => sorted(a)[Math.floor(a.length * 0.95)] ?? 0;

/** Sobe até a maquete de um golpe e espera os pedaços. */
async function enterDiorama(): Promise<void> {
  const inside = () => mode === 'maquete';
  if (inside()) return;
  setPx(CUT + 1);
  for (let k = 0; k < 400 && !inside(); k++) await wait(16);
}
async function leaveDiorama(px = 3): Promise<void> {
  if (mode === 'maquete') goGlobe();
  setPx(px);
  await wait(50);
}

type Script = (elapsedMs: number, dt: number) => void;
interface ScenarioDef { name: string; gpuLabel: string; prepare: () => Promise<void>; run: Script }

const rotateGlobe: Script = (_e, dt) => { const cx = camera.centerX(), cy = camera.centerY(); camera.drag(cx, cy, cx + dt * 60, cy); };

const SCENARIOS: readonly ScenarioDef[] = [
  { name: 'globo inteiro, girando', gpuLabel: 'globo inteiro', prepare: async () => { await leaveDiorama(3); }, run: rotateGlobe },
  { name: 'globo de perto, girando', gpuLabel: 'globo de perto', prepare: async () => { await leaveDiorama(14); }, run: rotateGlobe },
  { name: 'globo perto do corte', gpuLabel: 'globo perto do corte', prepare: async () => { await leaveDiorama(30); }, run: rotateGlobe },
  { name: 'ida e volta no corte', gpuLabel: 'ida e volta no corte', prepare: async () => { await leaveDiorama(CUT * 0.7); }, run: (e) => {
    // A cada 2 s atravessa o corte: entra aproximando no globo e sai afastando na maquete.
    const phase = Math.floor(e / 2000) % 2;
    if (phase === 0 && mode === 'globo') setPx(CUT + 1);
    if (phase === 1 && mode === 'maquete') goGlobe();
  } },
  { name: 'maquete parada', gpuLabel: 'maquete', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: ENTRY_DIST, pitch: 0.9 }); }, run: () => undefined },
  { name: 'maquete girando', gpuLabel: 'maquete girando', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: 100, pitch: 0.9 }); }, run: (_e, dt) => { view.yaw += dt * 0.5; } },
  { name: 'maquete de perto', gpuLabel: 'maquete de perto', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: 40, pitch: 0.7 }); }, run: (_e, dt) => { view.yaw += dt * 0.5; } },
  { name: 'rente ao chão', gpuLabel: 'rente ao chão', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: MIN_DIST, pitch: 0.42 }); }, run: (_e, dt) => { view.yaw += dt * 0.5; } },
  { name: 'andando, pedaços carregando', gpuLabel: 'andando', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: 110, pitch: 0.9 }); }, run: (e, dt) => { walk(e, dt, 26); } },
  { name: 'correndo, pedaços carregando', gpuLabel: 'correndo', prepare: async () => { await enterDiorama(); Object.assign(view, { distance: ENTRY_DIST, pitch: 0.9 }); }, run: (e, dt) => { walk(e, dt, 70); } },
];

/** Anda em quadrado grande dentro da face, carregando pedaços novos e soltando os antigos. */
function walk(e: number, dt: number, speed: number): void {
  const a = Math.floor(e / 5000) % 4;
  const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][a] as number[];
  const size = n * options.D;
  view.x = clamp(view.x + (dir[0] as number) * speed * dt, 64, size - 64);
  view.z = clamp(view.z + (dir[1] as number) * speed * dt, 64, size - 64);
}

/** Um cenário: fps sem interferir na GPU, depois tempo da GPU incluindo a suavização. */
async function runScenario(s: ScenarioDef, ms: number, gpuMs: number): Promise<{ result: ScenarioResult; gpu: GpuSample; chunksLoaded: number }> {
  await s.prepare();
  const before = chunks?.uploadMs.length ?? 0;
  script = s.run;
  scriptStart = performance.now();
  await wait(300);
  recorder = new FrameRecorder();
  const t0 = performance.now();
  let hidden = 0;
  const onHide = () => { if (document.hidden) hidden = 1; };
  document.addEventListener('visibilitychange', onHide);
  await wait(ms);
  document.removeEventListener('visibilitychange', onHide);
  const summary = recorder.summary();
  recorder = null;
  const samples: number[] = [];
  gpuOut = samples;
  forceResolve = true;
  await wait(gpuMs);
  gpuOut = null;
  forceResolve = false;
  script = null;
  return {
    result: { name: s.name, frames: summary, invalid: scenarioInvalid(summary.frames, performance.now() - t0 - gpuMs, hidden), work: emptyWork(), receiveAvgMs: 0, receiveMaxMs: 0 },
    gpu: { label: s.gpuLabel, ms: samples, method: 'consulta de tempo da GPU' },
    chunksLoaded: (chunks?.uploadMs.length ?? 0) - before,
  };
}

/** O que uma recomposição custaria com o detalhe: refaz todos os pedaços à vista a partir da grade grande alterada. */
async function recomposition(): Promise<{ ms: number; frames: number; worst: number; chunks: number; sendMs: number }> {
  await enterDiorama();
  const c = chunks as ChunkWorld;
  while (c.pending(view) > 0) await wait(30);
  const t0 = performance.now();
  const data = faceData(currentFace, currentFlip, 1);
  const sendMs = performance.now() - t0;
  const rec = new FrameRecorder();
  recorder = rec;
  c.setWorld(data);
  await wait(30);
  while (c.pending(view) > 0) await wait(10);
  const ms = performance.now() - t0;
  const s = rec.summary();
  recorder = null;
  return { ms, frames: s.frames, worst: s.worstFrameMs, chunks: c.loadedCount, sendMs };
}

function gpuName(): string {
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : 'não informado';
}

async function runReport(ms = 8000, gpuMs = 2500, names?: readonly string[]): Promise<string> {
  const results: ScenarioResult[] = [], gpu: GpuSample[] = [];
  const extras: string[] = [];
  for (const s of SCENARIOS) {
    if (names && !names.includes(s.name)) continue;
    hud.textContent = `Medindo: ${s.name}…`;
    const r = await runScenario(s, ms, gpuMs);
    results.push(r.result);
    gpu.push(r.gpu);
    if (r.chunksLoaded) extras.push(`${s.name}: ${r.chunksLoaded} pedaços novos durante o cenário`);
  }
  hud.textContent = 'Medindo: recomposição…';
  const rec = await recomposition();
  const c = chunks as ChunkWorld;
  const battery = await (navigator as unknown as { getBattery?: () => Promise<{ charging: boolean; level: number }> }).getBattery?.().catch(() => null);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const dataBytes = world.cellCount * 8 + colors.length + c.gpuBytes + (bakeInfo?.bytes ?? 0);
  const report = formatReport(
    { version: __BUILD_ID__, date: new Date().toLocaleString('pt-BR'), gpu: gpuName(), drawing: `protótipo: ${paletteOption.name} · longe ${options.far} · relevo ${options.relief} · suavização ${options.aa} · detalhe ${options.D}× · carga ${options.load}×`, cores: navigator.hardwareConcurrency, sharedMemory: typeof SharedArrayBuffer === 'undefined' ? 'não' : 'sim', screen: `tela ${screen.width}×${screen.height} · desenho ${canvas.width}×${canvas.height}`, userAgent: navigator.userAgent, power: powerLabel(battery ?? null) },
    results,
    null,
    null,
    [],
    gpu,
    { dataMb: dataBytes / 1048576, pageMb: mem ? mem.usedJSHeapSize / 1048576 : null, pageHow: mem ? 'só a parte JavaScript da tela, sem os dados da GPU' : 'o navegador não informa' },
  );
  return [
    'PROTÓTIPO do portão do M3 (não é o jogo)',
    report.replace(/\n\n[^\n]*worker parado[\s\S]*$/, '').replace(/\n\("tela ms"[\s\S]*?células quadradas\.\)/, '\n("tela ms" = trabalho da tela por quadro: média/pior. Se a GPU der perto de 15 ms com 60 fps, é o relógio da GPU em baixa, não o peso da cena: repita.)').replaceAll('GPU do globo', 'GPU do quadro'),
    '',
    `mundo: gerado em ${worldMs.toFixed(0)} ms · n=${n} · detalhe ${options.D}× · abertura ${pageLoadMs.toFixed(0)} ms${bakeInfo ? ` · pré-render ${bakeInfo.ms.toFixed(0)} ms, ${(bakeInfo.bytes / 1048576).toFixed(0)} MB` : ''}`,
    `pedaços (${CHUNK}×${CHUNK} células finas): ${c.buildMs.length} montados no worker, média ${mean(c.buildMs).toFixed(1)} ms, pior ${Math.max(0, ...c.buildMs).toFixed(0)} ms · subir para a GPU, média ${mean(c.uploadMs).toFixed(2)} ms, p95 ${p95(c.uploadMs).toFixed(2)}, pior ${Math.max(0, ...c.uploadMs).toFixed(1)} ms`,
    `na tela agora: ${c.loadedCount} pedaços · ${(c.gpuBytes / 1048576).toFixed(0)} MB na GPU · ${Math.round(c.triangles / 1000)} mil triângulos · ${c.drawCalls} desenhos`,
    `corte para a maquete: ${stats.cuts} vezes · espera média ${mean(stats.cutWait).toFixed(0)} ms, pior ${Math.max(0, ...stats.cutWait).toFixed(0)} ms`,
    `recomposição (refazer tudo à vista): ${rec.ms.toFixed(0)} ms em segundo plano, ${rec.chunks} pedaços · pior quadro ${rec.worst.toFixed(0)} ms · preparar a grade na tela ${rec.sendMs.toFixed(0)} ms`,
    ...extras,
  ].join('\n');
}

const pageLoadMs = performance.now() - pageStart;
version.textContent = `versão ${__BUILD_ID__} · ${paletteOption.name} · longe: ${options.far} · relevo: ${options.relief} · suavização: ${options.aa} · detalhe ${options.D}×`;

const reportBox = document.getElementById('report') as HTMLElement, reportText = document.getElementById('report-text') as HTMLTextAreaElement;
bench.addEventListener('click', () => {
  bench.disabled = true;
  void runReport().then((text) => {
    reportText.value = text;
    reportBox.style.display = 'flex';
    bench.disabled = false;
  });
});
(document.getElementById('report-copy') as HTMLElement).addEventListener('click', () => { reportText.select(); void navigator.clipboard?.writeText(reportText.value); });
(document.getElementById('report-close') as HTMLElement).addEventListener('click', () => { reportBox.style.display = 'none'; });

// Mover: arrastar anda (maquete) ou gira (globo); roda e pinça aproximam; Shift + arrastar gira a maquete.
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
const zoomBy = (factor: number, sx: number, sy: number) => {
  if (mode === 'maquete') {
    view.distance = clamp(view.distance / factor, MIN_DIST, MAX_DIST + 1);
    if (view.distance > MAX_DIST) goGlobe();
  } else camera.zoomAt(sx, sy, factor);
};
canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; });
addEventListener('pointerup', (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; });
addEventListener('pointermove', (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomBy(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = d;
    return;
  }
  const scale = devicePixelRatio;
  if (mode === 'globo') camera.drag(e.clientX * scale, e.clientY * scale, (e.clientX + dx) * scale, (e.clientY + dy) * scale);
  else if (e.shiftKey) {
    view.yaw -= dx * 0.005;
    view.pitch = clamp(view.pitch + dy * 0.004, 0.35, 1.3);
  } else {
    const k = view.distance / 500, c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    const size = n * options.D;
    view.x = clamp(view.x - (dx * c + dy * s) * k, 8, size - 8);
    view.z = clamp(view.z - (-dx * s + dy * c) * k, 8, size - 8);
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.001), e.clientX * devicePixelRatio, e.clientY * devicePixelRatio);
}, { passive: false });

const overlay = document.createElement('canvas');
let occupation: Occupation | null = null;

/** Comandos para as medições e imagens. */
const proto = {
  options,
  view,
  camera,
  metrics: () => PALETTES.map((p) => ({ id: p.id, name: p.name, ...paletteMetrics(p.hex) })),
  mode: () => mode,
  enterDiorama,
  leaveDiorama,
  setPx,
  hideUi() { for (const el of [hud, version, bench]) el.style.display = 'none'; },
  runReport,
  scenarioNames: () => SCENARIOS.map((s) => s.name),
  async measure(name: string, ms: number, gpuMs = 2500) {
    const s = SCENARIOS.find((a) => a.name === name);
    if (!s) throw new Error(name);
    const r = await runScenario(s, ms, gpuMs);
    const g2 = r.gpu.ms.slice(1);
    return { name, fps: +r.result.frames.fpsAvg.toFixed(1), min: +r.result.frames.fpsMin.toFixed(1), worst: +r.result.frames.worstFrameMs.toFixed(1), over50: r.result.frames.slowFrames, cpu: +r.result.frames.workAvgMs.toFixed(2), cpuMax: +r.result.frames.workMaxMs.toFixed(1), gpu: +mean(g2).toFixed(2), gpuP95: +p95(g2).toFixed(2), gpuWorst: +Math.max(0, ...g2).toFixed(1), samples: g2.length, chunks: r.chunksLoaded, triangles: Math.round(chunks?.triangles ?? 0), bytes: chunks?.gpuBytes ?? 0 };
  },
  recomposition,
  chunkStats: () => ({ builds: chunks?.buildMs.length ?? 0, buildMean: +mean(chunks?.buildMs ?? []).toFixed(2), buildWorst: +Math.max(0, ...(chunks?.buildMs ?? [])).toFixed(1), uploadMean: +mean(chunks?.uploadMs ?? []).toFixed(2), uploadWorst: +Math.max(0, ...(chunks?.uploadMs ?? [])).toFixed(1), cutWait: stats.cutWait, gpuMb: (chunks?.gpuBytes ?? 0) / 1048576, loaded: chunks?.loadedCount ?? 0, triangles: Math.round(chunks?.triangles ?? 0), drawCalls: chunks?.drawCalls ?? 0, worldMs, bake: bakeInfo }),
  /** Leva a câmera a uma célula: `biome` (código) ou `deposit` (tipo de jazida), a mais no meio do lugar. */
  async go(what: { biome?: number; deposit?: number; skip?: number }, px = CUT + 1) {
    if (mode === 'maquete') goGlobe();
    let found = -1, best = -1, seen = 0;
    const r = 6;
    for (let f = 0; f < 6; f++) for (let y = r; y < n - r; y += 3) for (let x = r; x < n - r; x += 3) {
      const same = (c: number) => (what.biome !== undefined ? world.biome[c] === what.biome : depositType(world.deposit[c] as number) === what.deposit);
      if (!same(g.index(f, x, y))) continue;
      let score = 0;
      for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (same(g.index(f, x + dx, y + dy))) score++;
      if (score > best || (score === best && seen < (what.skip ?? 0))) { best = score; found = g.index(f, x, y); seen++; }
    }
    if (found < 0) return false;
    const f = Math.floor(found / (n * n)), rest = found - f * n * n;
    const p = g.cellToPoint(f, rest % n, Math.floor(rest / n));
    camera.lookAt([p[0] as number, p[1] as number, p[2] as number]);
    setPx(px);
    await wait(60);
    return true;
  },
  /** Item 1.8: quanto da terra à vista se alcança a pé. */
  walkReach: () => chunks?.walkReach(view) ?? null,
  async ready() { while (chunks && chunks.pending(view) > 0) await wait(30); await wait(200); },
  /** Item 1.4: cidades, países e rotas por cima do globo. */
  occupy(cities: number, countries: number, symbol: number) {
    const t0 = performance.now();
    occupation = occupy(world, cities, countries);
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
    document.body.appendChild(overlay);
    drawOccupation(overlay.getContext('2d') as CanvasRenderingContext2D, world, camera, occupation, symbol);
    return { cities: occupation.cities.length, capitals: occupation.capitals.length, landCells: occupation.landCells, roads: occupation.roads.length, sea: occupation.sea.length, air: occupation.air.length, ms: Math.round(performance.now() - t0) };
  },
  redrawOccupation(symbol: number) { if (occupation) drawOccupation(overlay.getContext('2d') as CanvasRenderingContext2D, world, camera, occupation, symbol); },
  /* tempo de GPU do quadro atual, para medir o 2D de longe */
  gpuBusy: async () => { const a: number[] = []; gpuOut = a; forceResolve = true; await wait(2000); gpuOut = null; forceResolve = false; return +mean(a.slice(1)).toFixed(2); },
};
(window as unknown as { proto: typeof proto }).proto = proto;
requestAnimationFrame(loop);
