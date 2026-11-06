import { VERTEX_BYTES } from '../maquete/chunk-build';
import { measureFrames } from './gpu-timer';

/** A câmera da maquete: gira em volta de um ponto do chão. */
export interface MaqueteCamera {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

/** Um modelo de animal, desenhado várias vezes: x, y, z, giro e escala por vez. */
export const ANIMAL_FLOATS = 7;
/** `rig`: base do pescoço (x, y), quanto ele desce e o passo da perna. */
export interface InstanceBatch { mesh: number; data: Float32Array; count: number; rig?: readonly [number, number, number, number] }

/** Um pedaço já montado. */
export interface MaqueteChunkData {
  terrain: ArrayBuffer;
  water: ArrayBuffer;
  props: ArrayBuffer;
  /** Mesmas plantas, simplificadas (sem isso, usa `props`). */
  propsFar?: ArrayBuffer;
  skirts: ArrayBuffer;
  skirtRanges: readonly (readonly [number, number])[];
}

interface Buffers { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number }
interface GpuChunk {
  terrain: Buffers | null;
  water: Buffers | null;
  props: Buffers | null;
  propsFar: Buffers | null;
  skirts: Buffers | null;
  ranges: readonly (readonly [number, number])[];
  /** Lados com borda à mostra: +x, -x, +z, -z. */
  open: boolean[];
  place: [number, number, number, number];
  /** Centro do pedaço, nas coordenadas dele. */
  center: [number, number];
  bytes: number;
  nearBytes: number;
}

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
uniform mat4 uVP, uSun;
uniform vec4 uPlace;
uniform vec4 uWind;
out vec3 vColor, vNormal, vShadow, vWorld;
out float vMask, vLight;
void main(){
  vec3 w = vec3(uPlace.z * aPos.x + uPlace.w * aPos.z + uPlace.x, aPos.y, -uPlace.w * aPos.x + uPlace.z * aPos.z + uPlace.y);
  // Vento: só as plantas (máscara = altura); a base não sai do lugar.
  if (uWind.z > 0.0 && aNormal.w > 0.0) { float gust = 0.65 + 0.35 * sin(uWind.w * 3.0 + w.x * 0.6 + w.z * 0.4); w.xz += uWind.xy * aNormal.w * uWind.z * gust; }
  vWorld = w;
  vShadow = (uSun * vec4(w, 1.0)).xyz * 0.5 + 0.5;
  vNormal = vec3(uPlace.z * aNormal.x + uPlace.w * aNormal.z, aNormal.y, -uPlace.w * aNormal.x + uPlace.z * aNormal.z);
  vColor = aColor.rgb;
  vLight = aColor.a;
  vMask = aNormal.w;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vColor, vNormal, vShadow, vWorld;
in float vMask, vLight;
uniform sampler2DShadow uShadow;
uniform vec3 uSunDir, uSunColor, uSky, uGround, uSand;
uniform vec4 uShadowTexel;
uniform int uMode;
uniform float uTime, uDust;
out vec4 frag;
float shadow(){
  if (any(lessThan(vShadow, vec3(0.0))) || any(greaterThan(vShadow, vec3(1.0)))) return 1.0;
  // De longe, uma amostra basta: um texel do mapa já é menor que um pixel da sombra.
  if (uShadowTexel.w > 0.5) return texture(uShadow, vec3(vShadow.xy, vShadow.z - uShadowTexel.z));
  vec2 t = uShadowTexel.xy;
  float b = uShadowTexel.z, s = 0.0;
  const vec2 taps[4] = vec2[4](vec2(-0.7,-1.3), vec2(1.3,-0.7), vec2(-1.3,0.7), vec2(0.7,1.3));
  for (int i = 0; i < 4; i++) s += texture(uShadow, vec3(vShadow.xy + taps[i] * t, vShadow.z - b));
  return s / 4.0;
}
void main(){
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, uSunDir), 0.0);
  float lit = sun > 0.0 ? shadow() : 1.0;
  vec3 albedo = vColor;
  if (uMode == 0 && vMask > 0.0) albedo = mix(vColor, uSand, smoothstep(0.455, 0.505, vMask));
  if (uMode == 1) {
    // Água: variação suave e facetada, em movimento lento.
    float a = sin(vWorld.x * 0.73 + vWorld.z * 0.41 + uTime * 0.5) + sin(vWorld.z * 1.13 - vWorld.x * 0.37 - uTime * 0.4) + sin((vWorld.x + vWorld.z) * 0.29 + uTime * 0.23);
    albedo *= 1.0 + 0.016 * a;
    if (vMask > 0.5) albedo += 0.1 * max(0.0, sin(vWorld.y * 5.0 + uTime * 5.0 + vWorld.x * 3.0));
  }
  vec3 light = mix(uGround, uSky, n.y * 0.5 + 0.5) + uSunColor * sun * lit;
  if (vMask < -0.5) light = mix(light, vec3(1.0), 0.55);
  // Tempestade de areia: a areia cobre o chão e as plantas, mais o que olha para cima.
  if (uDust > 0.0 && uMode != 1) albedo = mix(albedo, vec3(0.78, 0.62, 0.40), uDust * (0.35 + 0.65 * max(n.y, 0.0)));
  frag = vec4(albedo * light * vLight, 1.0);
}`;
const ANIMAL_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 iPos;
layout(location=4) in float iScale;
layout(location=5) in vec2 iAnim;
uniform mat4 uVP, uSun;
uniform vec4 uPlace;
uniform vec4 uRig;
out vec3 vColor, vNormal, vShadow, vWorld;
out float vMask, vLight;
void main(){
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 q = aPos;
  // Andar e comer sem saltos: a perna balança em volta do quadril e o pescoço desce em volta da base.
  // aNormal.w: de -0,5 a 0,5 é a perna; acima de 0,5 é o quanto o ponto segue o pescoço.
  vec3 nn = aNormal.xyz;
  if (aNormal.w > 0.5) {
    float a = -iAnim.y * uRig.z * (aNormal.w - 0.5) * 2.0;
    float ca = cos(a), sa = sin(a);
    vec2 d = q.xy - uRig.xy;
    q.xy = uRig.xy + vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
    nn.xy = vec2(ca * nn.x - sa * nn.y, sa * nn.x + ca * nn.y);
  } else if (aNormal.w != 0.0) {
    q.x += aNormal.w * sin(iAnim.x) * uRig.w;
  }
  q *= iScale;
  vec3 w = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + iPos.xyz;
  vWorld = w;
  vShadow = (uSun * vec4(w, 1.0)).xyz * 0.5 + 0.5;
  vNormal = vec3(c * nn.x + s * nn.z, nn.y, -s * nn.x + c * nn.z);
  vColor = aColor.rgb;
  vLight = aColor.a;
  vMask = iAnim.y < -0.5 ? -1.0 : 0.0;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const BLOB_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 iPos;
layout(location=4) in float iScale;
uniform mat4 uVP;
out float vFade;
void main(){
  vFade = aPos.y;
  gl_Position = uVP * vec4(vec3(aPos.x * iScale, 0.05, aPos.z * iScale) + iPos.xyz, 1.0);
}`;
const BLOB_FS = `#version 300 es
precision mediump float;
in float vFade;
out vec4 frag;
void main(){ frag = vec4(0.04, 0.06, 0.12, 0.3 * vFade); }`;
const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uSun;
uniform vec4 uPlace;
void main(){ gl_Position = uSun * vec4(uPlace.z * aPos.x + uPlace.w * aPos.z + uPlace.x, aPos.y, -uPlace.w * aPos.x + uPlace.z * aPos.z + uPlace.y, 1.0); }`;
/** Distância da câmera em que as plantas passam para o modelo simples. */
const LOD_FAR = 170;
const SHADOW_FS = `#version 300 es
precision lowp float; void main(){}`;
const FXAA_VS = `#version 300 es
out vec2 vUv;
void main(){ vec2 q = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0; vUv = q; gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0); }`;
const FXAA_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uTexel;
uniform float uCopy;
out vec4 frag;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 m = texture(uImage, vUv).rgb;
  if (uCopy > 0.5) { frag = vec4(m, 1.0); return; }
  float lm = luma(m);
  float nw = luma(textureOffset(uImage, vUv, ivec2(-1, 1)).rgb), ne = luma(textureOffset(uImage, vUv, ivec2(1, 1)).rgb);
  float sw = luma(textureOffset(uImage, vUv, ivec2(-1, -1)).rgb), se = luma(textureOffset(uImage, vUv, ivec2(1, -1)).rgb);
  float lo = min(lm, min(min(nw, ne), min(sw, se))), hi = max(lm, max(max(nw, ne), max(sw, se)));
  if (hi - lo < max(0.04, hi * 0.11)) { frag = vec4(m, 1.0); return; }
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * scale, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture(uImage, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uImage, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uImage, vUv - dir * 0.5).rgb + texture(uImage, vUv + dir * 0.5).rgb);
  float lb = luma(b);
  frag = vec4(lb < lo || lb > hi ? a : b, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram() as WebGLProgram;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader da maquete');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader da maquete');
  return p;
}

/** Disco da sombra dos animais: y guarda a força (1 no meio, 0 na borda). */
function blobBytes(): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(12 * 3 * VERTEX_BYTES));
  let o = 0;
  const put = (x: number, y: number, z: number): void => { view.setFloat32(o, x, true); view.setFloat32(o + 4, y, true); view.setFloat32(o + 8, z, true); o += VERTEX_BYTES; };
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 6.283, b = ((k + 1) / 12) * 6.283;
    put(0, 1, 0); put(Math.cos(a), 0, Math.sin(a)); put(Math.cos(b), 0, Math.sin(b));
  }
  return view.buffer as ArrayBuffer;
}

export function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

export function lookAt(eye: readonly number[], at: readonly number[], up: readonly number[]): Float32Array {
  const norm = (v: readonly number[]): [number, number, number] => { const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number) || 1; return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l]; };
  const z = norm([(eye[0] as number) - (at[0] as number), (eye[1] as number) - (at[1] as number), (eye[2] as number) - (at[2] as number)]);
  const x = norm([(up[1] as number) * z[2] - (up[2] as number) * z[1], (up[2] as number) * z[0] - (up[0] as number) * z[2], (up[0] as number) * z[1] - (up[1] as number) * z[0]]);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]] as const;
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

export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

export function eyeOf(v: MaqueteCamera): [number, number, number] {
  const cp = Math.cos(v.pitch);
  return [v.x + Math.sin(v.yaw) * cp * v.distance, v.y + Math.sin(v.pitch) * v.distance, v.z + Math.cos(v.yaw) * cp * v.distance];
}

/** Luz: meio-dia suave, sombra azulada e nada de preto. No chão plano ao sol, luz ≈ 1: a cor fica a do globo. */
export const MAQUETE_LIGHT = {
  sunDir: [-0.52, 0.72, -0.46] as const,
  sunColor: [0.4, 0.39, 0.35] as const,
  sky: [0.72, 0.72, 0.74] as const,
  ground: [0.42, 0.38, 0.36] as const,
};

export class MaqueteRenderer {
  private main: WebGLProgram;
  private shadowProgram: WebGLProgram;
  private fxaa: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private us: Record<string, WebGLUniformLocation | null> = {};
  private fxaaImage: WebGLUniformLocation | null;
  private fxaaTexel: WebGLUniformLocation | null;
  private fxaaOff: WebGLUniformLocation | null;
  private chunks = new Map<number, GpuChunk>();
  private animalProgram: WebGLProgram;
  private blobProgram: WebGLProgram;
  private ua: Record<string, WebGLUniformLocation | null> = {};
  private blobVP: WebGLUniformLocation | null;
  private instanceBuffer: WebGLBuffer;
  private meshes: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number }[] = [];
  private blobMesh = -1;
  /** O que desenhar no próximo quadro. */
  batches: InstanceBatch[] = [];
  blobs: { data: Float32Array; count: number } | null = null;
  /** Dois mapas de sombra: um na tela, outro sendo desenhado aos poucos. */
  private shadowTex: WebGLTexture[] = [];
  private shadowFbo: WebGLFramebuffer[] = [];
  private shadowFront = 0;
  private shadowJob: { matrix: Float32Array; left: GpuChunk[] } | null = null;
  private shadowSize = 2048;
  private sceneFbo: WebGLFramebuffer;
  private sceneColor: WebGLTexture;
  private sceneDepth: WebGLRenderbuffer;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColor: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private sceneW = 0;
  private sceneH = 0;
  private emptyVao: WebGLVertexArrayObject;
  private shadowDirty = true;
  private sunMatrix: Float32Array = new Float32Array(16);
  /** Direção do sol: a maquete pode girar o mundo em relação ao mapa (troca de face do cubo). */
  sunDir: readonly number[] = MAQUETE_LIGHT.sunDir;
  background: readonly [number, number, number] = [0.46, 0.46, 0.47];
  /** Vento (direção x, z e força, em células na copa) e poeira (0 a 1). */
  wind: [number, number, number] = [0, 0, 0];
  dust = 0;
  /** Raio coberto pela sombra e centro. */
  shadowRadius = 60;
  shadowCenter: readonly [number, number, number] = [0, 0, 0];
  stats = { triangles: 0, drawCalls: 0, gpuBytes: 0 };

  /** Suavização: `fxaa` no quadro final (padrão), `msaa4` com 4 amostras, `off` sem. Decisão do usuário nas capturas (`?aa=`). */
  constructor(private gl: WebGL2RenderingContext, private aa: 'fxaa' | 'msaa4' | 'off' = 'fxaa') {
    this.main = compile(gl, VS, FS);
    for (const n of ['uVP', 'uSun', 'uPlace', 'uShadow', 'uSunDir', 'uSunColor', 'uSky', 'uGround', 'uSand', 'uShadowTexel', 'uMode', 'uTime', 'uWind', 'uDust']) this.u[n] = gl.getUniformLocation(this.main, n);
    this.shadowProgram = compile(gl, SHADOW_VS, SHADOW_FS);
    for (const n of ['uSun', 'uPlace']) this.us[n] = gl.getUniformLocation(this.shadowProgram, n);
    this.fxaa = compile(gl, FXAA_VS, FXAA_FS);
    this.fxaaImage = gl.getUniformLocation(this.fxaa, 'uImage');
    this.fxaaTexel = gl.getUniformLocation(this.fxaa, 'uTexel');
    this.fxaaOff = gl.getUniformLocation(this.fxaa, 'uCopy');
    this.emptyVao = gl.createVertexArray() as WebGLVertexArrayObject;
    this.animalProgram = compile(gl, ANIMAL_VS, FS);
    for (const n of ['uVP', 'uSun', 'uShadow', 'uSunDir', 'uSunColor', 'uSky', 'uGround', 'uSand', 'uShadowTexel', 'uMode', 'uTime', 'uRig', 'uDust']) this.ua[n] = gl.getUniformLocation(this.animalProgram, n);
    this.blobProgram = compile(gl, BLOB_VS, BLOB_FS);
    this.blobVP = gl.getUniformLocation(this.blobProgram, 'uVP');
    this.instanceBuffer = gl.createBuffer() as WebGLBuffer;
    gl.activeTexture(gl.TEXTURE9);
    for (let k = 0; k < 2; k++) {
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.shadowTex.push(tex);
      this.shadowFbo.push(fbo);
    }
    this.sceneFbo = gl.createFramebuffer() as WebGLFramebuffer;
    this.sceneColor = gl.createTexture() as WebGLTexture;
    this.sceneDepth = gl.createRenderbuffer() as WebGLRenderbuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private upload(bytes: ArrayBuffer): Buffers | null {
    if (bytes.byteLength === 0) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    const buffer = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.BYTE, true, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, VERTEX_BYTES, 16);
    gl.bindVertexArray(null);
    return { vao, buffer, vertices: bytes.byteLength / VERTEX_BYTES };
  }

  private free(b: Buffers | null): void {
    if (!b) return;
    this.gl.deleteVertexArray(b.vao);
    this.gl.deleteBuffer(b.buffer);
  }

  /**
   * Prepara tudo atrás da tela de carregamento: o navegador só termina de compilar um programa no primeiro desenho de verdade.
   * Desenha um triângulo com cada programa, em todos os modos, e prepara os quadros no tamanho da tela.
   */
  warm(width: number, height: number): void {
    const view = new DataView(new ArrayBuffer(3 * VERTEX_BYTES));
    for (let k = 0; k < 3; k++) { const o = k * VERTEX_BYTES; view.setFloat32(o, k === 1 ? 1 : 0, true); view.setFloat32(o + 8, k === 2 ? 1 : 0, true); view.setInt8(o + 13, 127); view.setUint8(o + 19, 255); }
    const tri = view.buffer as ArrayBuffer, none = new ArrayBuffer(0), key = -1;
    this.setChunk(key, { terrain: tri, water: tri, props: none, propsFar: tri, skirts: tri, skirtRanges: [[0, 3], [0, 0], [0, 0], [0, 0]] }, [0, 0, 1, 0], [true, false, false, false]);
    const mesh = this.addMesh(tri);
    const data = new Float32Array(ANIMAL_FLOATS);
    data[4] = 1;
    this.batches = [{ mesh, data, count: 1 }];
    this.blobs = { data, count: 1 };
    this.stepShadow(10);
    this.draw({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0.8, distance: 100, fov: 25 }, Math.max(1, width), Math.max(1, height), 0);
    this.gl.finish();
    this.batches = [];
    this.blobs = null;
    this.removeChunk(key);
  }

  /** Sobe um modelo para desenhar muitas vezes. Devolve o número dele. */
  addMesh(bytes: ArrayBuffer): number {
    const gl = this.gl;
    const b = this.upload(bytes) as Buffers;
    gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    this.meshes.push(b);
    return this.meshes.length - 1;
  }

  private drawInstances(mesh: number, data: Float32Array, count: number): void {
    const gl = this.gl, b = this.meshes[mesh];
    if (!b || count === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * ANIMAL_FLOATS), gl.STREAM_DRAW);
    gl.bindVertexArray(b.vao);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, ANIMAL_FLOATS * 4, 0);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, ANIMAL_FLOATS * 4, 16);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, ANIMAL_FLOATS * 4, 20);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, b.vertices, count);
  }

  /** Sobe um pedaço. `place`: x, z, cos e sin do giro no plano. */
  setChunk(key: number, data: MaqueteChunkData, place: readonly [number, number, number, number], open: readonly boolean[], center: readonly [number, number] = [16, 16]): void {
    this.removeChunk(key);
    const c: GpuChunk = {
      terrain: this.upload(data.terrain), water: this.upload(data.water), props: null, propsFar: data.propsFar ? this.upload(data.propsFar) : null, skirts: this.upload(data.skirts),
      ranges: data.skirtRanges, open: [...open], place: [place[0], place[1], place[2], place[3]],
      center: [center[0], center[1]],
      nearBytes: 0,
      bytes: data.terrain.byteLength + data.water.byteLength + (data.propsFar?.byteLength ?? 0) + data.skirts.byteLength,
    };
    this.chunks.set(key, c);
    this.stats.gpuBytes += c.bytes;
    this.shadowDirty = true;
  }

  removeChunk(key: number): void {
    const c = this.chunks.get(key);
    if (!c) return;
    for (const b of [c.terrain, c.water, c.props, c.propsFar, c.skirts]) this.free(b);
    this.stats.gpuBytes -= c.bytes + c.nearBytes;
    this.chunks.delete(key);
    this.shadowDirty = true;
  }

  /** Plantas de perto de um pedaço: chegam depois, só para o que está perto da câmera. */
  setNear(key: number, bytes: ArrayBuffer): void {
    const c = this.chunks.get(key);
    if (!c) return;
    this.free(c.props);
    this.stats.gpuBytes += bytes.byteLength - (c.nearBytes);
    c.nearBytes = bytes.byteLength;
    c.props = this.upload(bytes);
  }
  dropNear(key: number): void {
    const c = this.chunks.get(key);
    if (!c || !c.props) return;
    this.free(c.props);
    this.stats.gpuBytes -= c.nearBytes;
    c.nearBytes = 0;
    c.props = null;
  }
  hasNear(key: number): boolean { return !!this.chunks.get(key)?.props; }
  /** Distância do pedaço até a câmera. */
  chunkDistance(key: number, eye: readonly number[]): number {
    const c = this.chunks.get(key);
    if (!c) return Infinity;
    const X = c.place[0] + c.center[0] * c.place[2] + c.center[1] * c.place[3], Z = c.place[1] - c.center[0] * c.place[3] + c.center[1] * c.place[2];
    return Math.hypot(X - (eye[0] as number), 3 - (eye[1] as number), Z - (eye[2] as number));
  }

  hasChunk(key: number): boolean { return this.chunks.has(key); }
  setOpen(key: number, open: readonly boolean[]): void { const c = this.chunks.get(key); if (c) c.open = [...open]; }
  setPlace(key: number, place: readonly [number, number, number, number]): void { const c = this.chunks.get(key); if (c) c.place = [place[0], place[1], place[2], place[3]]; }
  placeOf(key: number): readonly [number, number, number, number] | null { return this.chunks.get(key)?.place ?? null; }
  keys(): IterableIterator<number> { return this.chunks.keys(); }
  markShadowDirty(): void { this.shadowDirty = true; }

  /**
   * A sombra é desenhada em partes (regra 16): alguns pedaços por quadro no mapa de trás, sempre com as plantas simples, e os mapas trocam quando termina.
   * Assim carregar pedaços não dá pico. `budget` = quantos pedaços neste quadro.
   */
  stepShadow(budget: number): void {
    const gl = this.gl;
    if (!this.shadowJob) {
      if (!this.shadowDirty) return;
      const [cx, cy, cz] = this.shadowCenter, d = this.sunDir;
      const eye = [cx + (d[0] as number) * 200, cy + (d[1] as number) * 200, cz + (d[2] as number) * 200];
      const r = this.shadowRadius;
      this.shadowJob = { matrix: multiply(ortho(-r, r, -r, r, 1, 400), lookAt(eye, [cx, cy, cz], [0, 1, 0])), left: [...this.chunks.values()] };
      this.shadowDirty = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo[1 - this.shadowFront] as WebGLFramebuffer);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    const job = this.shadowJob;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo[1 - this.shadowFront] as WebGLFramebuffer);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(this.us.uSun as WebGLUniformLocation, false, job.matrix);
    for (let n = 0; n < budget && job.left.length; n++) {
      const c = job.left.pop() as GpuChunk;
      gl.uniform4f(this.us.uPlace as WebGLUniformLocation, c.place[0], c.place[1], c.place[2], c.place[3]);
      for (const b of [c.terrain, c.propsFar]) {
        if (!b) continue;
        gl.bindVertexArray(b.vao);
        gl.drawArrays(gl.TRIANGLES, 0, b.vertices);
      }
    }
    gl.bindVertexArray(null);
    if (!job.left.length) {
      this.shadowFront = 1 - this.shadowFront;
      this.sunMatrix = job.matrix;
      this.shadowJob = null;
    }
  }

  /** Deixa os quadros prontos no tamanho da tela antes do corte. */
  ensureScene(w: number, h: number): void {
    if (this.sceneW === w && this.sceneH === h) return;
    const gl = this.gl;
    this.sceneW = w;
    this.sceneH = h;
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColor);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    if (this.aa === 'msaa4') {
      // Quatro amostras num quadro à parte; no fim copia para a textura e dela para a tela, sem FXAA.
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, w, h);
      this.msaaColor ??= gl.createRenderbuffer() as WebGLRenderbuffer;
      this.msaaFbo ??= gl.createFramebuffer() as WebGLFramebuffer;
      this.resolveFbo ??= gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColor, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);
    } else {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColor, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);
    }
  }

  /** GPU da maquete para o "Medir desempenho": `frames` desenhos seguidos. */
  async measureDraw(view: MaqueteCamera, width: number, height: number, time: number, frames: number): Promise<{ ms: number[]; method: string }> {
    return measureFrames(this.gl, frames, () => this.draw(view, width, height, time));
  }

  draw(view: MaqueteCamera, width: number, height: number, time: number): void {
    const gl = this.gl;
    this.stepShadow(10);
    this.ensureScene(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.sceneFbo);
    gl.viewport(0, 0, width, height);
    const bg = this.background;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    const eye = eyeOf(view);
    const near = Math.max(1, view.distance * 0.1), far = view.distance * 4 + 200;
    const vp = multiply(perspective(view.fov, width / height, near, far), lookAt(eye, [view.x, view.y, view.z], [0, 1, 0]));
    gl.useProgram(this.main);
    const u = this.u;
    gl.uniformMatrix4fv(u.uVP as WebGLUniformLocation, false, vp);
    gl.uniformMatrix4fv(u.uSun as WebGLUniformLocation, false, this.sunMatrix);
    gl.uniform3f(u.uSunDir as WebGLUniformLocation, this.sunDir[0] as number, this.sunDir[1] as number, this.sunDir[2] as number);
    gl.uniform3fv(u.uSunColor as WebGLUniformLocation, MAQUETE_LIGHT.sunColor);
    gl.uniform3fv(u.uSky as WebGLUniformLocation, MAQUETE_LIGHT.sky);
    gl.uniform3fv(u.uGround as WebGLUniformLocation, MAQUETE_LIGHT.ground);
    gl.uniform3f(u.uSand as WebGLUniformLocation, 226 / 255, 200 / 255, 138 / 255);
    gl.uniform4f(u.uShadowTexel as WebGLUniformLocation, 1.2 / this.shadowSize, 1.2 / this.shadowSize, 0.0016, view.distance > 200 ? 1 : 0);
    gl.uniform1f(u.uTime as WebGLUniformLocation, time);
    gl.uniform4f(u.uWind as WebGLUniformLocation, this.wind[0], this.wind[1], this.wind[2], time);
    gl.uniform1f(u.uDust as WebGLUniformLocation, this.dust);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex[this.shadowFront] as WebGLTexture);
    gl.uniform1i(u.uShadow as WebGLUniformLocation, 9);
    let tris = 0, calls = 0;
    // Recorte: pedaço fora da vista não é desenhado. E as plantas têm modelo simples a partir de LOD_FAR da câmera.
    const seen: GpuChunk[] = [], farAway = new Set<GpuChunk>();
    for (const c of this.chunks.values()) {
      const X = c.place[0] + c.center[0] * c.place[2] + c.center[1] * c.place[3], Z = c.place[1] - c.center[0] * c.place[3] + c.center[1] * c.place[2], Y = 3;
      const w = (vp[3] as number) * X + (vp[7] as number) * Y + (vp[11] as number) * Z + (vp[15] as number);
      const x = (vp[0] as number) * X + (vp[4] as number) * Y + (vp[8] as number) * Z + (vp[12] as number);
      const y = (vp[1] as number) * X + (vp[5] as number) * Y + (vp[9] as number) * Z + (vp[13] as number);
      // Raio do pedaço em volta do centro, com folga para altura.
      const pad = 30 * Math.max(Math.abs(vp[0] as number), Math.abs(vp[5] as number));
      if (w + pad < 0 || x < -w - pad || x > w + pad || y < -w - pad - pad || y > w + pad + pad) continue;
      seen.push(c);
      if (Math.hypot(X - eye[0], Y - eye[1], Z - eye[2]) > LOD_FAR) farAway.add(c);
    }
    const drawSet = (mode: number, pick: (c: GpuChunk) => Buffers | null): void => {
      gl.uniform1i(u.uMode as WebGLUniformLocation, mode);
      for (const c of seen) {
        const b = pick(c);
        if (!b) continue;
        gl.uniform4f(u.uPlace as WebGLUniformLocation, c.place[0], c.place[1], c.place[2], c.place[3]);
        gl.bindVertexArray(b.vao);
        gl.drawArrays(gl.TRIANGLES, 0, b.vertices);
        tris += b.vertices / 3;
        calls++;
      }
    };
    // Plantas primeiro: o chão atrás delas nem é pintado.
    gl.disable(gl.CULL_FACE);
    drawSet(2, (c) => (farAway.has(c) ? c.propsFar : c.props ?? c.propsFar));
    gl.enable(gl.CULL_FACE);
    drawSet(0, (c) => c.terrain);
    gl.disable(gl.CULL_FACE);
    // Borda: só os lados que dão para fora do que está carregado.
    gl.uniform1i(u.uMode as WebGLUniformLocation, 2);
    for (const c of seen) {
      if (!c.skirts || !c.open.some((o) => o)) continue;
      gl.uniform4f(u.uPlace as WebGLUniformLocation, c.place[0], c.place[1], c.place[2], c.place[3]);
      gl.bindVertexArray(c.skirts.vao);
      for (let s = 0; s < 4; s++) {
        const r = c.ranges[s];
        if (r && c.open[s] && r[1] > 0) { gl.drawArrays(gl.TRIANGLES, r[0], r[1]); tris += r[1] / 3; calls++; }
      }
    }
    drawSet(1, (c) => c.water);
    // Animais, depois da água: os que nadam ficam com a parte de baixo escondida por ela.
    if (this.batches.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      if (this.blobs && this.blobs.count > 0) {
        if (this.blobMesh < 0) this.blobMesh = this.addMesh(blobBytes());
        gl.useProgram(this.blobProgram);
        gl.uniformMatrix4fv(this.blobVP, false, vp);
        this.drawInstances(this.blobMesh, this.blobs.data, this.blobs.count);
      }
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      const a = this.ua;
      gl.useProgram(this.animalProgram);
      gl.uniformMatrix4fv(a.uVP as WebGLUniformLocation, false, vp);
      gl.uniformMatrix4fv(a.uSun as WebGLUniformLocation, false, this.sunMatrix);
      gl.uniform3f(a.uSunDir as WebGLUniformLocation, this.sunDir[0] as number, this.sunDir[1] as number, this.sunDir[2] as number);
      gl.uniform3fv(a.uSunColor as WebGLUniformLocation, MAQUETE_LIGHT.sunColor);
      gl.uniform3fv(a.uSky as WebGLUniformLocation, MAQUETE_LIGHT.sky);
      gl.uniform3fv(a.uGround as WebGLUniformLocation, MAQUETE_LIGHT.ground);
      gl.uniform3f(a.uSand as WebGLUniformLocation, 0, 0, 0);
      gl.uniform4f(a.uShadowTexel as WebGLUniformLocation, 1.2 / this.shadowSize, 1.2 / this.shadowSize, 0.0016, view.distance > 200 ? 1 : 0);
      gl.uniform1i(a.uMode as WebGLUniformLocation, 2);
      gl.uniform1f(a.uTime as WebGLUniformLocation, time);
      gl.uniform1i(a.uShadow as WebGLUniformLocation, 9);
      gl.uniform1f(a.uDust as WebGLUniformLocation, this.dust);
      for (const b of this.batches) {
        const rig = b.rig ?? [0, 0, 0, 0];
        gl.uniform4f(a.uRig as WebGLUniformLocation, rig[0], rig[1], rig[2], rig[3]);
        this.drawInstances(b.mesh, b.data, b.count);
        tris += ((this.meshes[b.mesh]?.vertices ?? 0) / 3) * b.count;
        calls++;
      }
    }
    // Quadro final com suavização.
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.fxaa);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColor);
    gl.uniform1i(this.fxaaImage, 9);
    // Passe só copiando quando não é FXAA: limite de contraste impossível.
    gl.uniform2f(this.fxaaTexel, 1 / width, 1 / height);
    gl.uniform1f(this.fxaaOff, this.aa === 'fxaa' ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    this.stats.triangles = tris;
    this.stats.drawCalls = calls;
  }
}
