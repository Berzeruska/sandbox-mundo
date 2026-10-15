import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import type { Camera } from './camera';

/** Retângulo alterado de uma face (em células). */
export interface DirtyRect {
  face: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Desenha o globo com WebGL2. As cores das células ficam numa textura de 6 camadas (uma por face),
 * lida pixel a pixel pelo shader com `texelFetch` (pixel nítido, sem interpolação).
 */
export class GlobeRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private n: number;
  private colors: Uint8Array;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private rot = new Float32Array(9);
  private lost = false;

  constructor(canvas: HTMLCanvasElement, n: number, colors: Uint8Array) {
    this.canvas = canvas;
    this.n = n;
    this.colors = colors;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('Este navegador não suporta WebGL2.');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.init();
    });
    this.init();
  }

  /** Troca o mundo (nova resolução ou novo array de cores) e reenvia tudo. */
  setWorld(n: number, colors: Uint8Array): void {
    this.n = n;
    this.colors = colors;
    if (!this.lost) this.createTexture();
  }

  private init(): void {
    const gl = this.gl;
    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    for (const name of ['uCells', 'uN', 'uCenter', 'uRadius', 'uRot', 'uLight']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.vao = gl.createVertexArray();
    this.createTexture();
  }

  private createTexture(): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.n, this.n, 6);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.n, this.n, 6, gl.RGBA, gl.UNSIGNED_BYTE, this.colors);
  }

  /** Reenvia só os retângulos alterados (lendo direto do array de cores do mundo). */
  upload(rects: readonly DirtyRect[]): void {
    if (this.lost || rects.length === 0) return;
    const gl = this.gl;
    const n = this.n;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    // Lê o retângulo direto do array completo: largura da linha e altura da "imagem" = N.
    // (O WebGL2 recusa SKIP_ROWS sem IMAGE_HEIGHT em envios 3D.)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, n);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, n);
    for (const r of rects) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, r.x0, r.y0, r.face, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, this.colors, r.face * n * n * 4,
      );
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /** Ajusta o tamanho interno do canvas ao tamanho na tela. Retorna true se mudou. */
  resize(pixelRatio: number): boolean {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  draw(camera: Camera): void {
    if (this.lost || !this.program) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    const u = this.uniforms;
    gl.uniform1i(u.uCells ?? null, 0);
    gl.uniform1i(u.uN ?? null, this.n);
    // gl_FragCoord tem origem embaixo; a câmera usa origem em cima.
    gl.uniform2f(u.uCenter ?? null, camera.centerX(), this.canvas.height - camera.centerY());
    gl.uniform1f(u.uRadius ?? null, camera.radius());
    gl.uniformMatrix3fv(u.uRot ?? null, false, camera.rotationMatrix(this.rot));
    gl.uniform3f(u.uLight ?? null, -0.42, 0.5, 0.76);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Falha ao criar shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Erro no shader: ${gl.getShaderInfoLog(shader) ?? ''}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Erro ao ligar o programa: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  return program;
}
