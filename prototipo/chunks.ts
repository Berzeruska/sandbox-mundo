import { CHUNK, figureMesh, INSTANCE_FLOATS, KINDS, kindMesh, kindMeshFar, VERTEX_FLOATS, WALK_STEP, type ChunkData, type Kind, type WorldData } from './detail';

/** A maquete em pedaços: carrega conforme a câmera anda, no máximo um pedaço por quadro enviado à GPU (item 1.6). */

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aLeg;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iScale;
layout(location=6) in vec2 iRotPhase;
layout(location=7) in vec3 iColor;
uniform mat4 uVP, uSun;
uniform float uTime, uBirth;
out vec3 vColor, vNormal, vShadow, vWorld;
void main(){
  vec3 p = aPos;
  if (aLeg != 0.0) p.z += aLeg * sin(uTime * 9.0 + iRotPhase.y) * 0.32 * (0.36 - p.y) / 0.36;
  float c = cos(iRotPhase.x), s = sin(iRotPhase.x);
  vec3 q = p * iScale;
  vec3 world = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + iPos;
  vShadow = (uSun * vec4(world, 1.0)).xyz * 0.5 + 0.5;
  world.y -= uBirth;
  vColor = aColor * iColor;
  vNormal = vec3(c * aNormal.x + s * aNormal.z, aNormal.y, -s * aNormal.x + c * aNormal.z);
  vWorld = world;
  gl_Position = uVP * vec4(world, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vColor, vNormal, vShadow, vWorld;
uniform sampler2DShadow uShadowMap;
uniform vec3 uSunDir, uSunColor, uSky, uGround;
uniform float uFlat, uAlpha, uWater, uTime;
out vec4 frag;
void main(){
  if (uFlat > 0.5) { frag = vec4(vColor, uAlpha); return; }
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, uSunDir), 0.0);
  float lit = 1.0;
  if (sun > 0.0 && all(greaterThan(vShadow, vec3(0.0))) && all(lessThan(vShadow, vec3(1.0)))) {
    float t = 1.0 / 2048.0;
    lit = 0.25 * (texture(uShadowMap, vShadow + vec3(-t, -t, -0.0012)) + texture(uShadowMap, vShadow + vec3(t, -t, -0.0012))
      + texture(uShadowMap, vShadow + vec3(-t, t, -0.0012)) + texture(uShadowMap, vShadow + vec3(t, t, -0.0012)));
  }
  vec3 color = vColor * (mix(uGround, uSky, n.y * 0.5 + 0.5) + uSunColor * sun * lit);
  if (uWater > 0.5) color *= 1.0 + 0.05 * sin(vWorld.x * 3.1 + uTime * 1.3) * sin(vWorld.z * 2.7 - uTime * 1.1);
  frag = vec4(color, 1.0);
}`;
const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iScale;
layout(location=6) in vec2 iRotPhase;
uniform mat4 uSun;
void main(){
  float c = cos(iRotPhase.x), s = sin(iRotPhase.x);
  vec3 q = aPos * iScale;
  gl_Position = uSun * vec4(vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + iPos, 1.0);
}`;
const SHADOW_FS = `#version 300 es
precision lowp float; void main(){}`;

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram() as WebGLProgram;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

interface GpuChunk {
  key: number;
  cx: number;
  cz: number;
  data: ChunkData;
  terrain: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number } | null;
  sea: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number } | null;
  parts: { kind: Kind; vao: WebGLVertexArrayObject; vaoFar: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number }[];
  bytes: number;
  triangles: number;
}

export interface LightStyle {
  sun: readonly [number, number, number];
  sunColor: readonly [number, number, number];
  sky: readonly [number, number, number];
  ground: readonly [number, number, number];
  background: readonly [number, number, number];
}

export interface Camera3D {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

/** A partir desta distância da câmera, modelos de longe. */
const FAR_MODEL = 95;
/** Pedaços desenhados no mapa de sombra por quadro. */
const BAKE_PER_FRAME = 5;
const keyOf = (cx: number, cz: number) => (cz + 4096) * 8192 + cx + 4096;

export function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}
export function lookAt(eye: readonly number[], at: readonly number[], up: readonly number[]): Float32Array {
  const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const z = norm([(eye[0] as number) - (at[0] as number), (eye[1] as number) - (at[1] as number), (eye[2] as number) - (at[2] as number)]) as [number, number, number];
  const x = norm([(up[1] as number) * z[2] - (up[2] as number) * z[1], (up[2] as number) * z[0] - (up[0] as number) * z[2], (up[0] as number) * z[1] - (up[1] as number) * z[0]]) as [number, number, number];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]] as [number, number, number];
  const dot = (a: readonly number[], b: readonly number[]) => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
    o[c * 4 + r] = s;
  }
  return o;
}
export function eyeOf(v: Camera3D): [number, number, number] {
  const cp = Math.cos(v.pitch);
  return [v.x + Math.sin(v.yaw) * cp * v.distance, Math.sin(v.pitch) * v.distance, v.z + Math.cos(v.yaw) * cp * v.distance];
}

export class ChunkWorld {
  private worker: Worker;
  private main: WebGLProgram;
  private shadowProgram: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private loaded = new Map<number, GpuChunk>();
  private arrived: ChunkData[] = [];
  private asked = new Set<number>();
  /** Pedaços carregados da grade anterior: continuam na tela até o novo chegar. */
  private stale = new Set<number>();
  private generation = 1;
  private kindVbo = new Map<Kind, { buffer: WebGLBuffer; vertices: number }>();
  private kindFar = new Map<Kind, { buffer: WebGLBuffer; vertices: number }>();
  private figureVbo: WebGLBuffer;
  private figureVertices: number;
  private figures: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; data: Float32Array; walk: Float32Array; count: number };
  private shadowTextures: WebGLTexture[] = [];
  private shadowFbos: WebGLFramebuffer[] = [];
  private shadowIndex = 0;
  private hasShadow = false;
  private bakeJob: { sun: Float32Array; center: number[]; left: number[]; started: boolean } | null = null;
  private sun: Float32Array = new Float32Array(16);
  private shadowDirty = true;
  private shadowCenter = [0, 0];
  /** Medições: tempo de cada pedaço no worker, uploads, tamanhos. */
  buildMs: number[] = [];
  uploadMs: number[] = [];
  drawCalls = 0;
  triangles = 0;
  drawnChunks = 0;
  radius = 3;

  constructor(private gl: WebGL2RenderingContext, private world: WorldData, private light: LightStyle, figureCount: number) {
    this.main = program(gl, VS, FS);
    for (const n of ['uVP', 'uSun', 'uTime', 'uBirth', 'uShadowMap', 'uSunDir', 'uSunColor', 'uSky', 'uGround', 'uFlat', 'uAlpha', 'uWater']) this.u[n] = gl.getUniformLocation(this.main, n);
    this.shadowProgram = program(gl, SHADOW_VS, SHADOW_FS);
    for (const k of KINDS) {
      const data = kindMesh(k);
      const buffer = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.kindVbo.set(k, { buffer, vertices: data.length / VERTEX_FLOATS });
      const far = kindMeshFar(k);
      const farBuffer = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, farBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, far, gl.STATIC_DRAW);
      this.kindFar.set(k, { buffer: farBuffer, vertices: far.length / VERTEX_FLOATS });
    }
    const fig = figureMesh();
    this.figureVbo = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.figureVbo);
    gl.bufferData(gl.ARRAY_BUFFER, fig, gl.STATIC_DRAW);
    this.figureVertices = fig.length / VERTEX_FLOATS;
    // Bonecos.
    const count = figureCount;
    const data = new Float32Array(count * INSTANCE_FLOATS);
    const walk = new Float32Array(count * 3);
    const colors = [[0.8, 0.25, 0.2], [0.2, 0.4, 0.75], [0.85, 0.7, 0.25], [0.3, 0.6, 0.35], [0.6, 0.35, 0.6]] as const;
    for (let k = 0; k < count; k++) {
      const o = k * INSTANCE_FLOATS, c = colors[k % colors.length] as readonly number[];
      data[o + 3] = 0.34; data[o + 4] = 0.34; data[o + 5] = 0.34;
      data[o + 7] = k * 1.7;
      data[o + 8] = c[0] as number; data[o + 9] = c[1] as number; data[o + 10] = c[2] as number;
      walk[k * 3 + 2] = k * 2.399;
    }
    const buffer = gl.createBuffer() as WebGLBuffer;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    this.vertexAttributes(this.figureVbo);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.instanceAttributes();
    gl.bindVertexArray(null);
    this.figures = { vao, buffer, data, walk, count };
    // Sombra.
    for (let k = 0; k < 2; k++) {
      const texture = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 2048, 2048);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.shadowTextures.push(texture);
      this.shadowFbos.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.worker = new Worker(new URL('./detail-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { generation: number; chunk: ChunkData };
      if (m.generation === this.generation) {
        this.arrived.push(m.chunk);
        this.buildMs.push(m.chunk.ms);
      }
    };
    this.worker.postMessage({ type: 'world', world, generation: this.generation });
  }

  /** Troca a grade grande (o que uma recomposição faria) ou o modo: refaz os pedaços. */
  setWorld(world: WorldData): void {
    this.world = world;
    this.generation++;
    this.arrived = [];
    this.asked.clear();
    this.stale = new Set(this.loaded.keys());
    this.worker.postMessage({ type: 'world', world, generation: this.generation });
  }

  private vertexAttributes(vbo: WebGLBuffer): void {
    const gl = this.gl, stride = VERTEX_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
  }
  private instanceAttributes(): void {
    const gl = this.gl, s = INSTANCE_FLOATS * 4;
    for (const [loc, size, offset] of [[4, 3, 0], [5, 3, 12], [6, 2, 24], [7, 3, 32]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, s, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
  }

  private mesh(data: Float32Array): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number } | null {
    if (!data.length) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    const buffer = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.vertexAttributes(buffer);
    gl.bindVertexArray(null);
    return { vao, buffer, vertices: data.length / VERTEX_FLOATS };
  }

  private upload(c: ChunkData): void {
    const gl = this.gl;
    const started = performance.now();
    const terrain = this.mesh(c.terrain), sea = this.mesh(c.sea);
    const parts: GpuChunk['parts'] = [];
    let bytes = c.terrain.byteLength + c.sea.byteLength, triangles = (c.terrain.length + c.sea.length) / VERTEX_FLOATS / 3;
    for (const kind of KINDS) {
      const a = c.instances[kind];
      if (!a.length) continue;
      const m = this.kindVbo.get(kind) as { buffer: WebGLBuffer; vertices: number };
      const vao = gl.createVertexArray() as WebGLVertexArrayObject;
      const buffer = gl.createBuffer() as WebGLBuffer;
      gl.bindVertexArray(vao);
      this.vertexAttributes(m.buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
      this.instanceAttributes();
      const vaoFar = gl.createVertexArray() as WebGLVertexArrayObject;
      gl.bindVertexArray(vaoFar);
      this.vertexAttributes((this.kindFar.get(kind) as { buffer: WebGLBuffer }).buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      this.instanceAttributes();
      gl.bindVertexArray(null);
      const count = a.length / INSTANCE_FLOATS;
      parts.push({ kind, vao, vaoFar, buffer, count });
      bytes += a.byteLength;
      triangles += (count * m.vertices) / 3;
    }
    const key = keyOf(c.cx, c.cz);
    this.stale.delete(key);
    const old = this.loaded.get(key);
    if (old) this.release(old);
    this.loaded.set(key, { key, cx: c.cx, cz: c.cz, data: c, terrain, sea, parts, bytes, triangles });
    this.shadowDirty = true;
    this.uploadMs.push(performance.now() - started);
  }

  private release(c: GpuChunk): void {
    const gl = this.gl;
    for (const m of [c.terrain, c.sea]) if (m) { gl.deleteBuffer(m.buffer); gl.deleteVertexArray(m.vao); }
    for (const p of c.parts) { gl.deleteBuffer(p.buffer); gl.deleteVertexArray(p.vao); gl.deleteVertexArray(p.vaoFar); }
  }

  get gpuBytes(): number {
    let b = 0;
    for (const c of this.loaded.values()) b += c.bytes;
    return b;
  }
  get loadedCount(): number { return this.loaded.size; }
  /** Pedaços ainda por chegar do worker ou esperando subir para a GPU. */
  pending(v: Camera3D, within = Infinity): number {
    let want = 0;
    this.eachWanted(v, (cx, cz, d) => { const k = keyOf(cx, cz); if (d <= within && (!this.loaded.has(k) || this.stale.has(k))) want++; });
    return want;
  }

  private eachWanted(v: Camera3D, fn: (cx: number, cz: number, d: number) => void): void {
    const cx = Math.floor(v.x / CHUNK), cz = Math.floor(v.z / CHUNK), r = this.radius;
    const max = (this.world.n * this.world.D) / CHUNK;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= max || z >= max) continue;
      fn(x, z, dx * dx + dz * dz);
    }
  }

  /** Por quadro: pede o que falta, sobe no máximo 1 pedaço para a GPU, solta o que ficou longe. */
  update(v: Camera3D, uploads = 1): void {
    const list: { cx: number; cz: number; d: number }[] = [];
    this.eachWanted(v, (cx, cz, d) => {
      const key = keyOf(cx, cz);
      if ((!this.loaded.has(key) || this.stale.has(key)) && !this.asked.has(key)) list.push({ cx, cz, d });
    });
    if (list.length) {
      list.sort((a, b) => a.d - b.d);
      for (const j of list) this.asked.add(keyOf(j.cx, j.cz));
      this.worker.postMessage({ type: 'want', list: list.map((j) => ({ cx: j.cx, cz: j.cz })), generation: this.generation });
    }
    const cx = Math.floor(v.x / CHUNK), cz = Math.floor(v.z / CHUNK), keep = this.radius + 1;
    // Um por quadro; o que ficou longe enquanto vinha do worker nem sobe para a GPU.
    for (let k = 0; k < uploads; k++) {
      let c = this.arrived.shift();
      while (c && (Math.abs(c.cx - cx) > keep || Math.abs(c.cz - cz) > keep)) { this.asked.delete(keyOf(c.cx, c.cz)); c = this.arrived.shift(); }
      if (c) this.upload(c);
    }
    for (const [key, g] of this.loaded) {
      if (Math.abs(g.cx - cx) > keep || Math.abs(g.cz - cz) > keep) {
        this.release(g);
        this.loaded.delete(key);
        this.asked.delete(key);
        this.shadowDirty = true;
      }
    }
    for (const key of this.asked) {
      const z = Math.floor(key / 8192) - 4096, x = key % 8192 - 4096;
      if (Math.abs(x - cx) > keep || Math.abs(z - cz) > keep) this.asked.delete(key);
    }
  }

  /** Altura do chão num ponto: o boneco fica em cima da superfície, nunca desnivelado (item 1.8). */
  surface(x: number, z: number): number | null {
    const g = this.loaded.get(keyOf(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!g) return null;
    const fx = x - Math.floor(x), fz = z - Math.floor(z);
    const cx = Math.floor(x) - g.cx * CHUNK, cz = Math.floor(z) - g.cz * CHUNK;
    const o = (cz * CHUNK + cx) * 4, c = g.data.corners;
    const a = c[o] as number, b = c[o + 1] as number, cc = c[o + 2] as number, d = c[o + 3] as number;
    return (a * (1 - fx) + b * fx) * (1 - fz) + (d * (1 - fx) + cc * fx) * fz;
  }
  private walkable(x: number, z: number): boolean {
    const g = this.loaded.get(keyOf(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!g) return false;
    return g.data.walk[(Math.floor(z) - g.cz * CHUNK) * CHUNK + Math.floor(x) - g.cx * CHUNK] === 1;
  }

  /** Anda os bonecos em volta da câmera: só passam se a diferença de altura der para subir. */
  stepFigures(v: Camera3D, dt: number): void {
    const { walk, count, data } = this.figures;
    const speed = 0.55;
    const R = 70;
    for (let k = 0; k < count; k++) {
      let x = walk[k * 3] as number, z = walk[k * 3 + 1] as number, d = walk[k * 3 + 2] as number;
      if (Math.abs(x - v.x) > R || Math.abs(z - v.z) > R || !this.walkable(x, z)) {
        // Renasce num lugar andável perto da câmera (sorteio fixo por boneco).
        const a = k * 2.399963, r = 6 + ((k * 7) % 60);
        const nx = v.x + Math.cos(a + v.x * 0.01) * r, nz = v.z + Math.sin(a + v.z * 0.01) * r;
        if (this.walkable(nx, nz)) { x = nx; z = nz; }
        else { walk[k * 3] = nx; walk[k * 3 + 1] = nz; data[k * INSTANCE_FLOATS + 1] = -50; continue; }
      }
      const nx = x + Math.cos(d) * speed * dt, nz = z + Math.sin(d) * speed * dt;
      const h0 = this.surface(x, z), h1 = this.surface(nx, nz);
      if (h0 === null || h1 === null || !this.walkable(nx, nz) || Math.abs(h1 - h0) > WALK_STEP * 0.5) d += 1.9 + (k % 5) * 0.2;
      else { x = nx; z = nz; }
      walk[k * 3] = x; walk[k * 3 + 1] = z; walk[k * 3 + 2] = d;
      const o = k * INSTANCE_FLOATS;
      data[o] = x; data[o + 1] = (this.surface(x, z) ?? -50) + 0.005; data[o + 2] = z; data[o + 6] = -d + Math.PI / 2;
    }
  }

  /**
   * Sombra em partes (item 1.6): o mapa novo é desenhado aos poucos, alguns pedaços por quadro, num segundo mapa fora de uso, e só
   * entra quando está pronto. Assim, nenhum quadro paga o desenho inteiro enquanto os pedaços carregam.
   */
  private startBake(v: Camera3D): void {
    const sun = this.light.sun;
    const span = (this.radius + 1) * CHUNK;
    // Sombra presa à grade dos pedaços: não treme com a câmera andando.
    const c = [Math.floor(v.x / CHUNK) * CHUNK + CHUNK / 2, Math.floor(v.z / CHUNK) * CHUNK + CHUNK / 2] as const;
    const l = Math.hypot(sun[0], sun[1], sun[2]);
    const eye = [c[0] + (sun[0] / l) * 200, (sun[1] / l) * 200, c[1] + (sun[2] / l) * 200];
    const view = lookAt(eye, [c[0], 0, c[1]], [0, 1, 0]);
    const r = span * 1.05, near = 10, far = 420;
    const ortho = new Float32Array([1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
    this.bakeJob = { sun: multiply(ortho, view), center: [c[0], c[1]], left: [...this.loaded.keys()], started: false };
    this.shadowDirty = false;
  }

  private stepBake(maxChunks: number): void {
    const gl = this.gl, job = this.bakeJob;
    if (!job) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbos[1 - this.shadowIndex] as WebGLFramebuffer);
    gl.viewport(0, 0, 2048, 2048);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    if (!job.started) { gl.clear(gl.DEPTH_BUFFER_BIT); job.started = true; }
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram, 'uSun'), false, job.sun);
    this.constants();
    for (let k = 0; k < maxChunks && job.left.length; k++) {
      const g = this.loaded.get(job.left.pop() as number);
      if (!g) continue;
      if (g.terrain) { gl.bindVertexArray(g.terrain.vao); gl.drawArrays(gl.TRIANGLES, 0, g.terrain.vertices); }
      for (const p of g.parts) {
        if (p.kind === 'tronco' || p.kind === 'arbusto' || p.kind === 'pedra' || p.kind === 'rocha') continue;
        gl.bindVertexArray(p.vaoFar);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, (this.kindFar.get(p.kind) as { vertices: number }).vertices, p.count);
      }
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!job.left.length) {
      this.shadowIndex = 1 - this.shadowIndex;
      this.sun = job.sun;
      this.shadowCenter = job.center;
      this.bakeJob = null;
      this.hasShadow = true;
    }
  }

  private constants(): void {
    const gl = this.gl;
    gl.vertexAttrib3f(4, 0, 0, 0);
    gl.vertexAttrib3f(5, 1, 1, 1);
    gl.vertexAttrib2f(6, 0, 0);
    gl.vertexAttrib3f(7, 1, 1, 1);
  }

  /** Testa o pedaço contra o que a câmera vê, pelos 8 cantos, sem tocar na GPU. */
  private visible(vp: Float32Array, g: GpuChunk): boolean {
    const x0 = g.cx * CHUNK, x1 = x0 + CHUNK, z0 = g.cz * CHUNK, z1 = z0 + CHUNK;
    let outL = 0, outR = 0, outB = 0, outT = 0;
    for (const x of [x0, x1]) for (const y of [-4, 14]) for (const z of [z0, z1]) {
      const cw = (vp[3] as number) * x + (vp[7] as number) * y + (vp[11] as number) * z + (vp[15] as number);
      const cx = (vp[0] as number) * x + (vp[4] as number) * y + (vp[8] as number) * z + (vp[12] as number);
      const cy = (vp[1] as number) * x + (vp[5] as number) * y + (vp[9] as number) * z + (vp[13] as number);
      if (cx < -cw) outL++;
      if (cx > cw) outR++;
      if (cy < -cw) outB++;
      if (cy > cw) outT++;
    }
    return outL < 8 && outR < 8 && outB < 8 && outT < 8;
  }

  /** `target`: quadro fora da tela (suavização no quadro final); null = a própria tela. */
  draw(v: Camera3D, aspect: number, time: number, target: WebGLFramebuffer | null, width: number, height: number): void {
    const gl = this.gl, u = this.u as Record<string, WebGLUniformLocation>, st = this.light;
    const cxNow = Math.floor(v.x / CHUNK) * CHUNK + CHUNK / 2, czNow = Math.floor(v.z / CHUNK) * CHUNK + CHUNK / 2;
    if (!this.bakeJob && (this.shadowDirty || cxNow !== this.shadowCenter[0] || czNow !== this.shadowCenter[1])) this.startBake(v);
    // A primeira sombra sai inteira, antes do primeiro quadro; as outras, em partes.
    this.stepBake(this.hasShadow ? BAKE_PER_FRAME : Infinity);
    const eye = eyeOf(v);
    const vp = multiply(perspective(v.fov, aspect, 2, 1200), lookAt(eye, [v.x, 0, v.z], [0, 1, 0]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(st.background[0], st.background[1], st.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    gl.uniformMatrix4fv(u['uVP'] as WebGLUniformLocation, false, vp);
    gl.uniformMatrix4fv(u['uSun'] as WebGLUniformLocation, false, this.sun);
    gl.uniform1f(u['uTime'] as WebGLUniformLocation, time);
    gl.uniform1f(u['uBirth'] as WebGLUniformLocation, 0);
    gl.uniform1f(u['uFlat'] as WebGLUniformLocation, 0);
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 0);
    const l = Math.hypot(st.sun[0], st.sun[1], st.sun[2]);
    gl.uniform3f(u['uSunDir'] as WebGLUniformLocation, st.sun[0] / l, st.sun[1] / l, st.sun[2] / l);
    gl.uniform3fv(u['uSunColor'] as WebGLUniformLocation, st.sunColor);
    gl.uniform3fv(u['uSky'] as WebGLUniformLocation, st.sky);
    gl.uniform3fv(u['uGround'] as WebGLUniformLocation, st.ground);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTextures[this.shadowIndex] as WebGLTexture);
    gl.uniform1i(u['uShadowMap'] as WebGLUniformLocation, 0);
    this.constants();
    let calls = 0, tris = 0, shown = 0;
    const visible: GpuChunk[] = [];
    for (const g of this.loaded.values()) if (this.visible(vp, g)) { visible.push(g); shown++; }
    for (const g of visible) {
      if (g.terrain) { gl.bindVertexArray(g.terrain.vao); gl.drawArrays(gl.TRIANGLES, 0, g.terrain.vertices); calls++; tris += g.terrain.vertices / 3; }
      // A distância em que uma árvore tem menos de ~10 pixels na tela: o modelo de longe é igual a olho nu.
      const far = Math.hypot(g.cx * CHUNK + CHUNK / 2 - eye[0], eye[1], g.cz * CHUNK + CHUNK / 2 - eye[2]) > FAR_MODEL;
      for (const p of g.parts) {
        const vertices = ((far ? this.kindFar : this.kindVbo).get(p.kind) as { vertices: number }).vertices;
        if (!vertices) continue;
        gl.bindVertexArray(far ? p.vaoFar : p.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, vertices, p.count);
        calls++;
        tris += (vertices * p.count) / 3;
      }
    }
    const f = this.figures;
    gl.bindBuffer(gl.ARRAY_BUFFER, f.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.data);
    gl.bindVertexArray(f.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.figureVertices, f.count);
    calls++;
    tris += (this.figureVertices * f.count) / 3;
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 1);
    for (const g of visible) if (g.sea) { gl.bindVertexArray(g.sea.vao); gl.drawArrays(gl.TRIANGLES, 0, g.sea.vertices); calls++; tris += g.sea.vertices / 3; }
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.drawCalls = calls;
    this.triangles = tris;
    this.drawnChunks = shown;
  }

  /** Item 1.8: quanto da terra carregada um boneco alcança a pé a partir do centro. */
  walkReach(v: Camera3D): { reach: number; land: number } {
    const seen = new Set<number>();
    const startX = Math.floor(v.x), startZ = Math.floor(v.z);
    let land = 0;
    const r = this.radius * CHUNK;
    for (let z = startZ - r; z < startZ + r; z++) for (let x = startX - r; x < startX + r; x++) if (this.walkable(x, z)) land++;
    const key = (x: number, z: number) => (z + 4096) * 8192 + x + 4096;
    let best = 0;
    // Maior região andável (o ponto de partida pode cair em água).
    const edgeHeight = (x: number, z: number, dx: number, dz: number): number[] | null => {
      const g = this.loaded.get(keyOf(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
      if (!g) return null;
      const o = ((z - g.cz * CHUNK) * CHUNK + (x - g.cx * CHUNK)) * 4, c = g.data.corners;
      const a = c[o] as number, b = c[o + 1] as number, cc = c[o + 2] as number, d = c[o + 3] as number;
      if (dx === 1) return [b, cc];
      if (dx === -1) return [a, d];
      if (dz === 1) return [d, cc];
      return [a, b];
    };
    for (let z = startZ - r; z < startZ + r; z += 3) for (let x = startX - r; x < startX + r; x += 3) {
      if (!this.walkable(x, z) || seen.has(key(x, z))) continue;
      const stack = [x, z];
      seen.add(key(x, z));
      let size = 0;
      while (stack.length) {
        const qz = stack.pop() as number, qx = stack.pop() as number;
        size++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = qx + dx, nz = qz + dz;
          if (Math.abs(nx - startX) > r || Math.abs(nz - startZ) > r || seen.has(key(nx, nz)) || !this.walkable(nx, nz)) continue;
          const here = edgeHeight(qx, qz, dx, dz), there = edgeHeight(nx, nz, -dx, -dz);
          if (!here || !there) continue;
          // Quina a quina: dá para passar se a diferença for de um passo.
          const gap = Math.min(Math.abs((here[0] as number) - (there[0] as number)), Math.abs((here[1] as number) - (there[1] as number)));
          if (gap > WALK_STEP) continue;
          seen.add(key(nx, nz));
          stack.push(nx, nz);
        }
      }
      best = Math.max(best, size);
    }
    return { reach: best, land };
  }
}
