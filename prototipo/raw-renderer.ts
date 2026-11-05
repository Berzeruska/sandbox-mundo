import { INSTANCE_FLOATS, lookAt, multiply, sunMatrix, VERTEX_FLOATS, type Instances, type Mesh, type Scene } from './scene';

/** O diorama em WebGL2 direto, o mesmo motor do globo do jogo. `sprites`: o plano B do portão do M3. */

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
uniform float uTime, uRelief, uGrow, uTerrain;
out vec3 vColor, vNormal, vShadow, vWorld;
void main(){
  vec3 p = aPos;
  if (aLeg != 0.0) p.z += aLeg * sin(uTime * 9.0 + iRotPhase.y) * 0.32 * (0.36 - p.y) / 0.36;
  float g = uGrow >= 1.0 || uTerrain > 0.5 ? 1.0 : smoothstep(0.0, 1.0, clamp(uGrow * 2.0 - fract(iPos.x * 0.37 + iPos.z * 0.61), 0.0, 1.0));
  float c = cos(iRotPhase.x), s = sin(iRotPhase.x);
  vec3 q = p * iScale * g;
  vec3 world = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + iPos;
  vec4 sh = uSun * vec4(world, 1.0);
  world.y = uTerrain > 0.5 ? world.y * uRelief : q.y + iPos.y * uRelief;
  vec3 n = vec3(c * aNormal.x + s * aNormal.z, aNormal.y, -s * aNormal.x + c * aNormal.z);
  vColor = aColor * iColor; vNormal = n; vWorld = world;
  vShadow = sh.xyz * 0.5 + 0.5;
  gl_Position = uVP * vec4(world, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vColor, vNormal, vShadow, vWorld;
uniform sampler2DShadow uShadowMap;
uniform vec3 uSunDir, uSunColor, uSky, uGround;
uniform float uFlat, uAlpha, uFade, uWater, uTime, uShadowOn;
out vec4 frag;
const float B[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
void main(){
  if (uFade < 1.0) { ivec2 q = ivec2(gl_FragCoord.xy) % 4; if ((B[q.x + q.y * 4] + 0.5) / 16.0 > uFade) discard; }
  if (uFlat > 0.5) { frag = vec4(vColor, uAlpha); return; }
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, uSunDir), 0.0);
  float lit = 1.0;
  if (uShadowOn > 0.5 && sun > 0.0) {
    float t = 1.0 / 2048.0;
    lit = 0.25 * (texture(uShadowMap, vShadow + vec3(-t, -t, -0.0015)) + texture(uShadowMap, vShadow + vec3(t, -t, -0.0015))
      + texture(uShadowMap, vShadow + vec3(-t, t, -0.0015)) + texture(uShadowMap, vShadow + vec3(t, t, -0.0015)));
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
const SPRITE_VS = `#version 300 es
layout(location=0) in vec2 aQuad;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iScale;
layout(location=7) in vec3 iColor;
uniform mat4 uVP, uSun;
uniform vec3 uRight, uUp;
uniform vec4 uTile;
uniform float uTint, uFrame;
out vec2 vUv; out vec3 vColor, vShadow;
void main(){
  vec3 world = iPos + uRight * (aQuad.x - 0.5) * iScale.x * uFrame + uUp * aQuad.y * mix(iScale.x, iScale.y, 0.5) * uFrame;
  vUv = uTile.xy + vec2(aQuad.x, 1.0 - aQuad.y) * uTile.zw;
  vColor = mix(vec3(1.0), iColor, uTint);
  vShadow = (uSun * vec4(iPos, 1.0)).xyz * 0.5 + 0.5;
  gl_Position = uVP * vec4(world, 1.0);
}`;
const SPRITE_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec2 vUv; in vec3 vColor, vShadow;
uniform sampler2D uAtlas;
uniform sampler2DShadow uShadowMap;
out vec4 frag;
void main(){
  vec4 t = texture(uAtlas, vUv);
  if (t.a < 0.5) discard;
  float lit = texture(uShadowMap, vShadow + vec3(0.0, 0.0, -0.004));
  frag = vec4(t.rgb * vColor * (0.72 + 0.28 * lit), 1.0);
}`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
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

interface Drawable {
  vao: WebGLVertexArrayObject;
  vertices: number;
  count: number;
  buffer: WebGLBuffer | null;
  data: Float32Array | null;
  casts: boolean;
}

export interface DrawOptions {
  clear: boolean;
  fade: number;
  relief: number;
  grow: number;
}

export class RawRenderer {
  private main: WebGLProgram;
  private shadowProgram: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private terrain!: Drawable;
  private water!: Drawable;
  private parts: Drawable[] = [];
  private body!: Drawable;
  private blob!: Drawable;
  private shadowTexture!: WebGLTexture;
  private shadowFbo!: WebGLFramebuffer;
  private sun: Float32Array = new Float32Array(16);
  private spriteProgram: WebGLProgram | null = null;
  private spriteU: Record<string, WebGLUniformLocation | null> = {};
  private spriteVao: { tree: WebGLVertexArrayObject; house: WebGLVertexArrayObject } | null = null;
  private atlas: WebGLTexture | null = null;
  private counts = { tree: 0, house: 0 };
  drawCalls = 0;

  constructor(private gl: WebGL2RenderingContext, private scene: Scene, private sprites: boolean) {
    this.main = program(gl, VS, FS);
    for (const n of ['uVP', 'uSun', 'uTime', 'uRelief', 'uGrow', 'uShadowMap', 'uSunDir', 'uSunColor', 'uSky', 'uGround', 'uFlat', 'uAlpha', 'uFade', 'uWater', 'uShadowOn', 'uTerrain']) this.u[n] = gl.getUniformLocation(this.main, n);
    this.shadowProgram = program(gl, SHADOW_VS, SHADOW_FS);
    this.terrain = this.drawable(scene.terrain, null, 1, true, false);
    this.water = this.drawable(scene.water, null, 1, false, false);
    this.parts = scene.parts.map((p) => this.fromInstances(p, false));
    this.body = this.fromInstances(scene.figures.body, true);
    this.blob = this.fromInstances(scene.figures.blob, true);
    this.bakeShadow();
    if (sprites) this.bakeSprites();
  }

  private drawable(mesh: Mesh, instances: Float32Array | null, count: number, casts: boolean, dynamic: boolean): Drawable {
    const gl = this.gl;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    const stride = VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    let buffer: WebGLBuffer | null = null;
    if (instances) {
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, instances, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      this.instanceAttributes();
    }
    gl.bindVertexArray(null);
    return { vao, vertices: mesh.vertices, count, buffer, data: instances, casts };
  }

  private instanceAttributes(): void {
    const gl = this.gl;
    const s = INSTANCE_FLOATS * 4;
    for (const [loc, size, offset] of [[4, 3, 0], [5, 3, 12], [6, 2, 24], [7, 3, 32]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, s, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
  }

  private fromInstances(p: Instances, dynamic: boolean): Drawable {
    return this.drawable(p.mesh, p.data, p.count, p.casts, dynamic);
  }

  private constants(): void {
    const gl = this.gl;
    gl.vertexAttrib3f(4, 0, 0, 0);
    gl.vertexAttrib3f(5, 1, 1, 1);
    gl.vertexAttrib2f(6, 0, 0);
    gl.vertexAttrib3f(7, 1, 1, 1);
  }

  /** A sombra do que não se mexe é feita uma vez só: o sol é fixo e o relevo muda pouco. */
  private bakeShadow(): void {
    const gl = this.gl;
    this.sun = sunMatrix(this.scene.style.sun);
    this.shadowTexture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 2048, 2048);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram, 'uSun'), false, this.sun);
    this.constants();
    for (const d of [this.terrain, ...this.parts]) {
      if (!d.casts) continue;
      gl.bindVertexArray(d.vao);
      if (d.data) gl.drawArraysInstanced(gl.TRIANGLES, 0, d.vertices, d.count);
      else gl.drawArrays(gl.TRIANGLES, 0, d.vertices);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Plano B: desenha árvore e casas uma vez, num atlas, e o jogo só mostra retângulos com essa imagem. */
  private bakeSprites(): void {
    const gl = this.gl;
    const TILE = 256, COLS = 4;
    const style = this.scene.style;
    this.atlas = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 5, gl.RGBA8, TILE * COLS, TILE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.atlas, 0);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, TILE * COLS, TILE);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.main);
    this.setMainUniforms(0, { clear: false, fade: 1, relief: 1, grow: 1 });
    gl.uniform1f(this.u['uShadowOn'] as WebGLUniformLocation, 0);
    const view = lookAt([3.4, 4.1, 3.4], [0, 0.65, 0], [0, 1, 0]);
    const ortho = new Float32Array([1 / 1.2, 0, 0, 0, 0, 1 / 1.2, 0, 0, 0, 0, -0.05, 0, 0, 0, 0, 1]);
    gl.uniformMatrix4fv(this.u['uVP'] as WebGLUniformLocation, false, multiply(ortho, view));
    const instance = (d: Drawable, sx: number, sy: number, sz: number, c: readonly number[], y = 0) => {
      gl.bindVertexArray(d.vao);
      gl.disableVertexAttribArray(4); gl.disableVertexAttribArray(5); gl.disableVertexAttribArray(6); gl.disableVertexAttribArray(7);
      gl.vertexAttrib3f(4, 0, y, 0); gl.vertexAttrib3f(5, sx, sy, sz); gl.vertexAttrib2f(6, 0, 0); gl.vertexAttrib3f(7, c[0] as number, c[1] as number, c[2] as number);
      gl.drawArrays(gl.TRIANGLES, 0, d.vertices);
      for (const l of [4, 5, 6, 7]) gl.enableVertexAttribArray(l);
    };
    gl.viewport(0, 0, TILE, TILE);
    instance(this.parts[0] as Drawable, 1, 1, 1, [1, 1, 1]);
    instance(this.parts[1] as Drawable, 1, 1, 1, style.trunk);
    style.roofs.slice(0, 3).forEach((roof, k) => {
      gl.viewport(TILE * (k + 1), 0, TILE, TILE);
      instance(this.parts[2] as Drawable, 1, 0.7, 1, style.walls[k % style.walls.length] as readonly number[]);
      instance(this.parts[3] as Drawable, 1, 0.8, 1, roof, 0.7);
    });
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.spriteProgram = program(gl, SPRITE_VS, SPRITE_FS);
    for (const n of ['uVP', 'uSun', 'uRight', 'uUp', 'uTile', 'uTint', 'uFrame', 'uAtlas', 'uShadowMap']) this.spriteU[n] = gl.getUniformLocation(this.spriteProgram, n);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    const make = (inst: Drawable) => {
      const vao = gl.createVertexArray() as WebGLVertexArrayObject;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
      this.instanceAttributes();
      gl.bindVertexArray(null);
      return vao;
    };
    this.spriteVao = { tree: make(this.parts[0] as Drawable), house: make(this.parts[2] as Drawable) };
    this.counts = { tree: (this.parts[0] as Drawable).count, house: (this.parts[2] as Drawable).count };
  }

  private setMainUniforms(time: number, o: DrawOptions): void {
    const gl = this.gl, u = this.u as Record<string, WebGLUniformLocation>, st = this.scene.style;
    gl.uniformMatrix4fv(u['uSun'] as WebGLUniformLocation, false, this.sun);
    gl.uniform1f(u['uTime'] as WebGLUniformLocation, time);
    gl.uniform1f(u['uRelief'] as WebGLUniformLocation, o.relief);
    gl.uniform1f(u['uGrow'] as WebGLUniformLocation, o.grow);
    gl.uniform1f(u['uFade'] as WebGLUniformLocation, o.fade);
    gl.uniform1f(u['uFlat'] as WebGLUniformLocation, 0);
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 0);
    gl.uniform1f(u['uShadowOn'] as WebGLUniformLocation, 1);
    gl.uniform1f(u['uTerrain'] as WebGLUniformLocation, 0);
    const l = Math.hypot(...st.sun);
    gl.uniform3f(u['uSunDir'] as WebGLUniformLocation, st.sun[0] / l, st.sun[1] / l, st.sun[2] / l);
    gl.uniform3fv(u['uSunColor'] as WebGLUniformLocation, st.sunColor);
    gl.uniform3fv(u['uSky'] as WebGLUniformLocation, st.sky);
    gl.uniform3fv(u['uGround'] as WebGLUniformLocation, st.ground);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.uniform1i(u['uShadowMap'] as WebGLUniformLocation, 0);
  }

  /** Atualiza as instâncias dos bonecos no buffer. */
  updateFigures(): void {
    const gl = this.gl;
    for (const d of [this.body, this.blob]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, d.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.data as Float32Array);
    }
  }

  draw(vp: Float32Array, right: readonly number[], up: readonly number[], time: number, o: DrawOptions): void {
    const gl = this.gl, u = this.u as Record<string, WebGLUniformLocation>;
    const bg = this.scene.style.background;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    if (o.clear) {
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } else gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    gl.uniformMatrix4fv(u['uVP'] as WebGLUniformLocation, false, vp);
    this.setMainUniforms(time, o);
    this.constants();
    let calls = 0;
    gl.uniform1f(u['uTerrain'] as WebGLUniformLocation, 1);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.terrain.vertices);
    calls++;
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 1);
    gl.bindVertexArray(this.water.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.water.vertices);
    calls++;
    gl.uniform1f(u['uWater'] as WebGLUniformLocation, 0);
    gl.uniform1f(u['uTerrain'] as WebGLUniformLocation, 0);
    if (!this.sprites) {
      for (const d of this.parts) {
        gl.bindVertexArray(d.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, d.vertices, d.count);
        calls++;
      }
    }
    gl.bindVertexArray(this.body.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.body.vertices, this.body.count);
    calls++;
    if (this.sprites && this.spriteVao && this.spriteProgram) {
      const s = this.spriteU as Record<string, WebGLUniformLocation>;
      gl.useProgram(this.spriteProgram);
      gl.uniformMatrix4fv(s['uVP'] as WebGLUniformLocation, false, vp);
      gl.uniformMatrix4fv(s['uSun'] as WebGLUniformLocation, false, this.sun);
      gl.uniform3fv(s['uRight'] as WebGLUniformLocation, right as number[]);
      gl.uniform3fv(s['uUp'] as WebGLUniformLocation, up as number[]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.uniform1i(s['uAtlas'] as WebGLUniformLocation, 1);
      gl.uniform1i(s['uShadowMap'] as WebGLUniformLocation, 0);
      gl.disable(gl.CULL_FACE);
      gl.uniform1f(s['uFrame'] as WebGLUniformLocation, 2.4);
      gl.uniform1f(s['uTint'] as WebGLUniformLocation, 1);
      gl.uniform4f(s['uTile'] as WebGLUniformLocation, 0, 0, 0.25, 1);
      gl.bindVertexArray(this.spriteVao.tree);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.counts.tree);
      gl.uniform1f(s['uTint'] as WebGLUniformLocation, 0);
      gl.uniform4f(s['uTile'] as WebGLUniformLocation, 0.25, 0, 0.25, 1);
      gl.bindVertexArray(this.spriteVao.house);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.counts.house);
      calls += 2;
      gl.useProgram(this.main);
    }
    // Sombra redonda sob os bonecos.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(u['uFlat'] as WebGLUniformLocation, 1);
    gl.uniform1f(u['uAlpha'] as WebGLUniformLocation, 0.28);
    gl.bindVertexArray(this.blob.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.blob.vertices, this.blob.count);
    calls++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.drawCalls = calls;
  }

  /** Antes do globo do jogo desenhar no mesmo contexto: deixa o estado como ele espera. */
  resetState(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
    for (const l of [4, 5, 6, 7]) gl.vertexAttribDivisor(l, 0);
  }
}
