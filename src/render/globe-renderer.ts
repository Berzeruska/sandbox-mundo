import { fragmentShader, MAX_STORMS, VERTEX_SHADER } from './shaders';
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
  /** Nuvens (T10): ligadas (0–1), relógio delas (s) e furacões (centro xyz + raio; força com sinal). */
  clouds = 1;
  cloudTime = 0;
  stormCount = 0;
  readonly storms = new Float32Array(MAX_STORMS * 4);
  readonly stormPower = new Float32Array(MAX_STORMS);
  /** Cor do fundo oceânico novo (fenda aberta entre placas antes da recomposição), 0–1. */
  ridgeColor: [number, number, number] = [0.08, 0.18, 0.39];
  /** Cor da fenda nova entre dois continentes (vale de rifte, como a simulação faz), 0–1. */
  riftColor: [number, number, number] = [0.36, 0.3, 0.24];
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
  /**
   * Transição com imagem guardada (RG): na recomposição, a composição que vai virar a "anterior" é
   * desenhada uma vez nesta imagem (cor da superfície, tamanho da tela), com a câmera e os ângulos das
   * placas daquela hora. Na transição o shader lê dela em vez de desenhar a composição anterior de novo.
   */
  private snap: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  /** A imagem vale para a transição atual; `snapFresh`: o próximo quadro mostra só ela. */
  private snapValid = false;
  private snapFresh = false;
  private snapRot = new Float32Array(9);
  private snapCenter: [number, number] = [0, 0];
  private snapRadius = 1;
  private snapTotal = new Float32Array(MAX_SHADER_PLATES * 2);
  private snapDelta = new Float32Array(MAX_SHADER_PLATES * 2);
  /** Câmera e movimento do último quadro (a imagem da recomposição sai igual a ele). */
  private lastCamera: Camera | null = null;
  private lastMotion: PlateMotionUniforms | null = null;

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
      this.snap = null;
      this.snapValid = false;
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
    for (const name of ['uCells', 'uNoise', 'uN', 'uCenter', 'uRadius', 'uRot', 'uLight', 'uCellAngle', 'uPlates', 'uMoving', 'uPlateAxis', 'uPlateCenter', 'uPlateTotal', 'uPlateBase', 'uMaxDelta', 'uRidgeColor', 'uCellsPrev', 'uPlatesPrev', 'uPlateBasePrev', 'uFade', 'uMaxDeltaPrev', 'uDeposits', 'uDepositsPrev', 'uResLayer', 'uRiftColor', 'uClouds', 'uCloudTime', 'uStormCount', 'uStorms', 'uStormPower', 'uPass', 'uSnap', 'uSnapOn', 'uSnapRot', 'uSnapCenter', 'uSnapRadius', 'uSnapSize', 'uSnapDelta']) {
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
    // Antes de trocar as texturas: guarda a imagem da composição que vai virar a anterior.
    this.takeSnapshot();
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

  /**
   * Mede o desenho do globo para o "Medir desempenho" (meta ≤ 8 ms de GPU): `frames` desenhos
   * seguidos. Com a consulta de tempo da GPU (EXT_disjoint_timer_query_webgl2) o tempo é o da GPU; sem
   * ela (o Firefox não a oferece), cada desenho espera a GPU terminar (lendo 1 pixel) e o tempo inclui
   * o envio pela CPU (um pouco acima do real).
   */
  async measureDraw(camera: Camera, motion: PlateMotionUniforms | undefined, frames: number): Promise<{ ms: number[]; method: string }> {
    const gl = this.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const px = new Uint8Array(4);
    const sync: number[] = [];
    const queries: WebGLQuery[] = [];
    for (let k = 0; k < frames; k++) {
      const q = ext ? gl.createQuery() : null;
      if (ext && q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now();
      this.draw(camera, motion);
      if (ext && q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      // Sem a consulta de tempo da GPU, cada desenho espera a GPU (lendo 1 pixel) para ser medido.
      if (!ext) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sync.push(performance.now() - t0);
      }
    }
    if (ext && queries.length) {
      // Os resultados das consultas chegam alguns quadros depois.
      const last = queries[queries.length - 1] as WebGLQuery;
      for (let tries = 0; tries < 30 && !gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE); tries++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ms: number[] = [];
      for (const q of queries) {
        if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) ms.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
        gl.deleteQuery(q);
      }
      if (ms.length >= frames / 2) return { ms, method: 'consulta de tempo da GPU' };
      // A consulta falhou (GPU trocou de ritmo no meio): mede de novo esperando a GPU.
      for (let k = 0; k < frames; k++) {
        const t0 = performance.now();
        this.draw(camera, motion);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sync.push(performance.now() - t0);
      }
    }
    return { ms: sync, method: 'quadro esperando a GPU (inclui o envio pela CPU; o navegador não tem a consulta de tempo da GPU)' };
  }

  /**
   * Guarda a imagem da composição atual como o último quadro a mostrou (câmera e ângulos dele). Custa um
   * desenho do globo, uma vez por recomposição; o quadro seguinte só mostra a imagem (sem desenhar a
   * composição nova), então nenhum quadro desenha o globo duas vezes.
   */
  private takeSnapshot(): void {
    const camera = this.lastCamera;
    const motion = this.lastMotion;
    this.snapValid = false;
    this.snapFresh = false;
    if (!this.motionSupported || !camera || !motion || !motion.moving) return;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.snap || this.snap.w !== w || this.snap.h !== h) {
      if (this.snap) {
        gl.deleteFramebuffer(this.snap.fbo);
        gl.deleteTexture(this.snap.tex);
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        this.snap = null;
        return;
      }
      this.snap = { fbo, tex, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.snap.fbo);
    this.render(camera, motion, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    camera.rotationMatrix(this.snapRot);
    this.snapCenter = [camera.centerX(), h - camera.centerY()];
    this.snapRadius = camera.radius();
    this.snapTotal.set(motion.total);
    this.snapValid = true;
    this.snapFresh = true;
  }

  draw(camera: Camera, motion?: PlateMotionUniforms): void {
    this.lastCamera = camera;
    this.lastMotion = motion ?? null;
    const fading = !!motion && motion.moving && motion.fade < 1;
    // Quadro da recomposição: só a imagem guardada (a transição começa nela).
    const pass = fading && this.snapValid && this.snapFresh ? 2 : 0;
    this.render(camera, motion, pass);
    if (pass === 2) this.snapFresh = false;
  }

  /** Um desenho do globo. `pass`: 0 normal; 1 imagem guardada (no framebuffer dela); 2 só a imagem. */
  private render(camera: Camera, motion: PlateMotionUniforms | undefined, pass: 0 | 1 | 2): void {
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
    // A imagem guardada (passo 1) é a composição atual sozinha, sem transição.
    const fading = pass !== 1 && moving && !!motion && motion.fade < 1 && !!this.prevTexture && !!this.prevPlateTexture;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading ? this.prevTexture : this.texture);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading ? this.prevPlateTexture : this.plateTexture);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depositTexture);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fading && this.prevDepositTexture ? this.prevDepositTexture : this.depositTexture);
    // A imagem guardada não pode estar ligada enquanto é desenhada (laço de leitura e escrita).
    const snap = this.snap;
    const snapOn = pass === 0 && fading && this.snapValid && !!snap && snap.w === this.canvas.width && snap.h === this.canvas.height;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, pass !== 1 && snap ? snap.tex : null);
    gl.activeTexture(gl.TEXTURE0);
    const u = this.uniforms;
    gl.uniform1i(u.uCells ?? null, 0);
    gl.uniform1i(u.uNoise ?? null, 1);
    gl.uniform1i(u.uPlates ?? null, 2);
    gl.uniform1i(u.uCellsPrev ?? null, 3);
    gl.uniform1i(u.uPlatesPrev ?? null, 4);
    gl.uniform1i(u.uDeposits ?? null, 5);
    gl.uniform1i(u.uDepositsPrev ?? null, 6);
    gl.uniform1i(u.uSnap ?? null, 7);
    gl.uniform1i(u.uPass ?? null, pass);
    gl.uniform1i(u.uSnapOn ?? null, snapOn ? 1 : 0);
    if (snapOn && snap && motion) {
      // Quanto cada placa girou desde a imagem: ângulo agora − ângulo na imagem (cos e sen da diferença).
      const d = this.snapDelta;
      for (let k = 0; k < MAX_SHADER_PLATES; k++) {
        const ca = motion.total[k * 2] as number;
        const sa = motion.total[k * 2 + 1] as number;
        const cb = this.snapTotal[k * 2] as number;
        const sb = this.snapTotal[k * 2 + 1] as number;
        d[k * 2] = ca * cb + sa * sb;
        d[k * 2 + 1] = sa * cb - ca * sb;
      }
      gl.uniform2fv(u.uSnapDelta ?? null, d);
      gl.uniformMatrix3fv(u.uSnapRot ?? null, false, this.snapRot);
      gl.uniform2f(u.uSnapCenter ?? null, this.snapCenter[0], this.snapCenter[1]);
      gl.uniform1f(u.uSnapRadius ?? null, this.snapRadius);
      gl.uniform2f(u.uSnapSize ?? null, snap.w, snap.h);
    }
    gl.uniform1i(u.uResLayer ?? null, this.resourcesLayer ? 1 : 0);
    gl.uniform1f(u.uClouds ?? null, this.clouds);
    gl.uniform1f(u.uCloudTime ?? null, this.cloudTime);
    gl.uniform1i(u.uStormCount ?? null, this.stormCount);
    if (this.stormCount) {
      gl.uniform4fv(u.uStorms ?? null, this.storms);
      gl.uniform1fv(u.uStormPower ?? null, this.stormPower);
    }
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
      gl.uniform3f(u.uRiftColor ?? null, this.riftColor[0], this.riftColor[1], this.riftColor[2]);
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
