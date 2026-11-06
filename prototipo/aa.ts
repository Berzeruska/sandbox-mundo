import { program } from './chunks';

/**
 * Item 4.2: suavização de bordas no quadro final, no lugar do MSAA 4× (regra 16). O diorama é desenhado num quadro fora da tela, sem
 * amostras extras, e um passe de tela cheia suaviza as bordas pelo contraste (FXAA, da família 3.11, escrito aqui em poucas linhas). Sem dependência.
 */
const VS = `#version 300 es
out vec2 vUv;
void main(){ vec2 q = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0; vUv = q; gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uTexel;
out vec4 frag;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 m = texture(uImage, vUv).rgb;
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

export type AaMode = 'msaa4' | 'msaa2' | 'fxaa' | 'off';

/** Quadro fora da tela para o diorama, conforme o modo. No MSAA 4× o quadro é a própria tela (o canvas tem antialias). */
export class FinalPass {
  private fbo: WebGLFramebuffer | null = null;
  private color: WebGLTexture | null = null;
  private msColor: WebGLRenderbuffer | null = null;
  private depth: WebGLRenderbuffer | null = null;
  private resolve: WebGLFramebuffer | null = null;
  private prog: WebGLProgram | null = null;
  private uTexel: WebGLUniformLocation | null = null;
  private w = 0;
  private h = 0;

  constructor(private gl: WebGL2RenderingContext, readonly mode: AaMode) {
    if (mode === 'fxaa') {
      this.prog = program(gl, VS, FS);
      this.uTexel = gl.getUniformLocation(this.prog, 'uTexel');
    }
  }

  private allocate(w: number, h: number): void {
    const gl = this.gl;
    this.w = w;
    this.h = h;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.color) gl.deleteTexture(this.color);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    if (this.msColor) gl.deleteRenderbuffer(this.msColor);
    this.fbo = gl.createFramebuffer();
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    if (this.mode === 'msaa2') {
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 2, gl.DEPTH_COMPONENT24, w, h);
      this.msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 2, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    } else {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      this.color = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.color);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    }
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Onde o diorama deve desenhar neste quadro. */
  target(w: number, h: number): WebGLFramebuffer | null {
    if (this.mode === 'msaa4' || this.mode === 'off') return null;
    if (w !== this.w || h !== this.h || !this.fbo) this.allocate(w, h);
    return this.fbo;
  }

  /** Passa o quadro para a tela, suavizando. */
  finish(): void {
    const gl = this.gl;
    if (this.mode === 'msaa2') {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    if (this.mode !== 'fxaa' || !this.prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.uniform2f(this.uTexel, 1 / this.w, 1 / this.h);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
