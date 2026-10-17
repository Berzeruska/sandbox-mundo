import { fragmentShader, VERTEX_SHADER } from './shaders';
import type { Camera } from './camera';
import { packRect } from './dirty';
import { buildNoiseVolume, NOISE_SIZE } from './noise-volume';
import { MAX_SHADER_PLATES } from './plate-motion';

/** Estado do movimento das placas para o desenho suave entre recomposições. */
export interface PlateMotionUniforms {
  moving: boolean;
  /** Eixo (x, y, z) e velocidade relativa (w) de cada placa, MAX_SHADER_PLATES × 4. */
  axis: Float32Array;
  /** Centro atual de cada placa, MAX_SHADER_PLATES × 3. */
  center: Float32Array;
  /** cos, sen do ângulo total de cada placa, MAX_SHADER_PLATES × 2. */
  total: Float32Array;
  /** cos, sen do ângulo em que a textura foi composta, MAX_SHADER_PLATES × 2. */
  base: Float32Array;
  /** Igual a `base`, para a composição anterior (transição suave). */
  basePrev: Float32Array;
  /** Mistura com a composição anterior: 1 = só a atual. */
  fade: number;
  /** Maior rotação desde a composição anterior (raio de busca dela na transição). */
  maxDeltaPrev: number;
  maxDelta: number;
}

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
  private noiseTexture: WebGLTexture | null = null;
  private plateTexture: WebGLTexture | null = null;
  /** Texturas da composição anterior, mantidas durante a transição suave. */
  private prevTexture: WebGLTexture | null = null;
  private prevPlateTexture: WebGLTexture | null = null;
  private plateCells: Uint8Array | null = null;
  /** Jazidas (T6): 1 byte por célula, código de `resources.ts`; atual e da composição anterior. */
  private depositTexture: WebGLTexture | null = null;
  private prevDepositTexture: WebGLTexture | null = null;
  private deposits: Uint8Array | null = null;
  /** Camada "Ver recursos" ligada (o petróleo escondido aparece listrado de perto). */
  resourcesLayer = false;
  /** Cor do fundo oceânico novo (fenda aberta entre placas antes da recomposição), 0–1. */
  ridgeColor: [number, number, number] = [0.08, 0.18, 0.39];
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private rot = new Float32Array(9);
  /**
   * Shader completo (movimento suave das placas) ou simplificado (plano B). O simplificado entra se
   * o driver da GPU recusar o completo ou se a GPU perder o contexto com ele.
   */
  motionSupported = true;
  /** Nome da GPU informado pelo navegador (para o relatório de desempenho). */
  gpuName(): string {
    const gl = this.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    return `${String(name)} (${String(vendor)})`;
  }

  /** Por que o desenho está simplificado (vazio = completo). Aparece no painel Dados. */
  fallbackReason = '';
  private contextLosses = 0;
  /** Bloco reaproveitado para os envios parciais. */
  private packBuffer = new Uint8Array(0);
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
      this.contextLosses++;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      // A GPU reiniciou: se foi com o shader completo, volta com o simplificado (mais leve).
      if (this.motionSupported) {
        this.motionSupported = false;
        this.fallbackReason = 'a GPU reiniciou (contexto perdido) com o desenho completo';
      }
      this.init();
    });
    this.init();
  }

  /** Troca o mundo (nova resolução ou novo array de cores) e reenvia tudo. */
  setWorld(n: number, colors: Uint8Array): void {
    this.n = n;
    this.colors = colors;
    if (!this.lost) {
      if (this.prevTexture) this.gl.deleteTexture(this.prevTexture);
      if (this.prevPlateTexture) this.gl.deleteTexture(this.prevPlateTexture);
      if (this.prevDepositTexture) this.gl.deleteTexture(this.prevDepositTexture);
      this.prevTexture = null;
      this.prevPlateTexture = null;
      this.prevDepositTexture = null;
      this.createTexture();
      this.createPlateTexture();
      this.createDepositTexture();
    }
  }

  private init(): void {
    const gl = this.gl;
    this.program = null;
    if (this.motionSupported) {
      try {
        this.program = linkProgram(gl, VERTEX_SHADER, fragmentShader(true));
      } catch (err) {
        // Plano B: o driver não aceitou o shader completo; o jogo segue com o simplificado.
        this.motionSupported = false;
        this.fallbackReason = err instanceof Error ? err.message : String(err);
        console.warn('Shader completo recusado pela GPU; usando o simplificado.', err);
      }
    }
    // Se até o simplificado falhar, o erro sobe e aparece na tela (App).
    this.program ??= linkProgram(gl, VERTEX_SHADER, fragmentShader(false));
    for (const name of ['uCells', 'uNoise', 'uN', 'uCenter', 'uRadius', 'uRot', 'uLight', 'uCellAngle', 'uPlates', 'uMoving', 'uPlateAxis', 'uPlateCenter', 'uPlateTotal', 'uPlateBase', 'uMaxDelta', 'uRidgeColor', 'uCellsPrev', 'uPlatesPrev', 'uPlateBasePrev', 'uFade', 'uMaxDeltaPrev', 'uDeposits', 'uDepositsPrev', 'uResLayer']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.vao = gl.createVertexArray();
    this.createNoiseTexture();
    this.createTexture();
    this.createPlateTexture();
    this.createDepositTexture();
  }

  /** Jazidas do mundo todo (mundo novo, ou petróleo revelado por uma pincelada). */
  setDeposits(deposits: Uint8Array): void {
    this.deposits = deposits;
    if (this.lost) return;
    if (this.depositTexture) this.fillDepositTexture();
    else this.createDepositTexture();
  }

  private createDepositTexture(): void {
    const gl = this.gl;
    if (this.depositTexture) gl.deleteTexture(this.depositTexture);
    this.depositTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depositTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, this.n, this.n, 6);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fillDepositTexture();
  }

  private fillDepositTexture(): void {
    const gl = this.gl;
    const data = this.deposits && this.deposits.length === this.n * this.n * 6 ? this.deposits : new Uint8Array(this.n * this.n * 6);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depositTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.n, this.n, 6, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  }

  /**
   * Recomposição chegou: a composição atual vira a "anterior" (para a transição suave) e as cores
   * (já atualizadas no array) e as placas novas viram a atual.
   */
  recomposed(plateCells: Uint8Array, deposits: Uint8Array): void {
    if (this.lost) return;
    const spareDeposits = this.prevDepositTexture;
    this.prevDepositTexture = this.depositTexture;
    this.depositTexture = spareDeposits;
    this.deposits = deposits;
    if (this.depositTexture) this.fillDepositTexture();
    else this.createDepositTexture();
    // Reaproveita as texturas da composição de duas recomposições atrás (sem uso há segundos): criar
    // e apagar textura na GPU a cada recomposição pode travar um quadro no celular.
    const spareColors = this.prevTexture;
    const sparePlates = this.prevPlateTexture;
    this.prevTexture = this.texture;
    this.prevPlateTexture = this.plateTexture;
    this.plateCells = plateCells;
    this.texture = spareColors;
    this.plateTexture = sparePlates;
    if (this.texture) this.fillColorTexture();
    else this.createTexture();
    if (this.plateTexture) this.fillPlateTexture();
    else this.createPlateTexture();
  }

  /** Placa de cada célula (bits 0–3) e crosta continental (bit 4), para o movimento suave. */
  setPlates(cells: Uint8Array): void {
    this.plateCells = cells;
    if (!this.lost) this.createPlateTexture();
  }

  private createPlateTexture(): void {
    const gl = this.gl;
    if (this.plateTexture) gl.deleteTexture(this.plateTexture);
    this.plateTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.plateTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8UI, this.n, this.n, 6);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fillPlateTexture();
  }

  private fillPlateTexture(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.plateTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const size = this.n * this.n * 6 * 2;
    const data = this.plateCells && this.plateCells.length === size ? this.plateCells : new Uint8Array(size);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.n, this.n, 6, gl.RG_INTEGER, gl.UNSIGNED_BYTE, data);
  }

  private createNoiseTexture(): void {
    const gl = this.gl;
    this.noiseTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildNoiseVolume());
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, wrap, gl.REPEAT);
    }
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
    this.fillColorTexture();
  }

  private fillColorTexture(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.n, this.n, 6, gl.RGBA, gl.UNSIGNED_BYTE, this.colors);
  }

  /**
   * Reenvia só os retângulos alterados. Cada retângulo é copiado para um bloco contínuo antes:
   * pedir ao driver para "pular" linhas/colunas (UNPACK_SKIP_*) desenhava pedaços no lugar errado
   * em alguns celulares (ver docs/bugs.md, 2026-10-15).
   */
  upload(rects: readonly DirtyRect[]): void {
    if (this.lost || rects.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    for (const r of rects) {
      const size = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * 4;
      if (this.packBuffer.length < size) this.packBuffer = new Uint8Array(size);
      const data = packRect(this.colors, this.n, r, this.packBuffer);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, r.x0, r.y0, r.face, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, data,
      );
    }
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

  draw(camera: Camera, motion?: PlateMotionUniforms): void {
    if (this.lost || !this.program) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.plateTexture);
    const moving = this.motionSupported && !!motion && motion.moving;
    const fading = moving && !!motion && motion.fade < 1 && !!this.prevTexture && !!this.prevPlateTexture;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading ? this.prevTexture : this.texture);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading ? this.prevPlateTexture : this.plateTexture);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depositTexture);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading && this.prevDepositTexture ? this.prevDepositTexture : this.depositTexture);
    gl.activeTexture(gl.TEXTURE0);
    const u = this.uniforms;
    gl.uniform1i(u.uCells ?? null, 0);
    gl.uniform1i(u.uNoise ?? null, 1);
    gl.uniform1i(u.uPlates ?? null, 2);
    gl.uniform1i(u.uCellsPrev ?? null, 3);
    gl.uniform1i(u.uPlatesPrev ?? null, 4);
    gl.uniform1i(u.uDeposits ?? null, 5);
    gl.uniform1i(u.uDepositsPrev ?? null, 6);
    gl.uniform1i(u.uResLayer ?? null, this.resourcesLayer ? 1 : 0);
    gl.uniform1f(u.uFade ?? null, fading && motion ? motion.fade : 1);
    gl.uniform1i(u.uMoving ?? null, moving ? 1 : 0);
    if (motion && moving) {
      gl.uniform4fv(u.uPlateAxis ?? null, motion.axis, 0, MAX_SHADER_PLATES * 4);
      gl.uniform3fv(u.uPlateCenter ?? null, motion.center, 0, MAX_SHADER_PLATES * 3);
      gl.uniform2fv(u.uPlateTotal ?? null, motion.total, 0, MAX_SHADER_PLATES * 2);
      gl.uniform2fv(u.uPlateBase ?? null, motion.base, 0, MAX_SHADER_PLATES * 2);
      gl.uniform2fv(u.uPlateBasePrev ?? null, motion.basePrev, 0, MAX_SHADER_PLATES * 2);
      gl.uniform1f(u.uMaxDelta ?? null, motion.maxDelta);
      gl.uniform1f(u.uMaxDeltaPrev ?? null, motion.maxDeltaPrev);
      gl.uniform3f(u.uRidgeColor ?? null, this.ridgeColor[0], this.ridgeColor[1], this.ridgeColor[2]);
    }
    gl.uniform1i(u.uN ?? null, this.n);
    // gl_FragCoord tem origem embaixo; a câmera usa origem em cima.
    gl.uniform2f(u.uCenter ?? null, camera.centerX(), this.canvas.height - camera.centerY());
    gl.uniform1f(u.uRadius ?? null, camera.radius());
    gl.uniformMatrix3fv(u.uRot ?? null, false, camera.rotationMatrix(this.rot));
    gl.uniform3f(u.uLight ?? null, -0.42, 0.5, 0.76);
    gl.uniform1f(u.uCellAngle ?? null, Math.PI / 2 / this.n);
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
