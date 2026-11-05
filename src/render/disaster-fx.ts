import type { Vec3 } from '../world/cubesphere';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';
import type { Camera } from './camera';

/**
 * Animações dos desastres na camada sobreposta (canvas 2D por cima do globo). Correm em tempo real,
 * independente da velocidade do jogo: a 20× um ano passa em 0,05 s e nada seria visto. Os efeitos de
 * verdade (relevo, marcas) a simulação já aplicou. Exceção: o meteoro só bate quando o impacto do jogo
 * chega à tela (`land`), o que vale para qualquer velocidade (B1, teste da `d7479ae2`; teste da `3238cd7b`).
 */

interface Fx {
  e: DisasterEvent;
  /** Início (ms, relógio da página) e duração. */
  start: number;
  ms: number;
  /** Meteoro: quanto da entrada já foi desenhado (0 a 1) e o instante do último desenho. */
  entry?: number;
  drawnAt?: number;
  /** Meteoro: quando o impacto chegou (ms). */
  landed?: number;
}

/** Meteoro: quanto tempo a rocha leva até o chão, em qualquer velocidade. */
export const METEOR_ENTRY_MS = 1000;
/**
 * Meteoro: quanto a animação dura depois de bater (ms): clarão curto, entulho em cubos e a fumacinha que
 * sobe e se desfaz em cubos (B3, escolha do usuário: opção 4 + a fumaça da opção 5).
 */
export const METEOR_AFTER_MS = 1800;
/** Clarão da batida (ms), dentro de METEOR_AFTER_MS. */
const METEOR_FLASH_MS = 220;
/** Até onde a rocha desce sem o tempo andar: pedida com o jogo pausado, ela aparece no céu e espera. */
const METEOR_PAUSED_ENTRY = 1 / 6;
/** O quase-chão: só o impacto (`land`) põe a rocha no chão. */
const METEOR_MAX_ENTRY = 0.999;

/**
 * Quanto da queda está desenhado depois de um quadro de `dtMs`. `ticksLeft`: passos até o impacto (estimado);
 * `ticksPerSecond`: ritmo do jogo agora (0 = pausado). Enquanto a rocha está no tempo certo (até 1,5 passo de
 * diferença), anda igual em todo quadro: em 1× o passo chega aos degraus, e seguir o passo daria o movimento
 * "engasgado" (teste da `2d9a2156`). Fora disso, mira no impacto: no Máx o ritmo varia, e quem muda a
 * velocidade no meio da queda acelera ou freia a rocha. Nunca anda para trás.
 */
export function meteorEntry(entry: number, dtMs: number, ticksLeft: number, ticksPerSecond: number): number {
  if (ticksPerSecond <= 0) return entry < METEOR_PAUSED_ENTRY ? Math.min(METEOR_PAUSED_ENTRY, entry + dtMs / METEOR_ENTRY_MS) : entry;
  const tickMs = 1000 / ticksPerSecond;
  const leftMs = Math.max(0, ticksLeft) * tickMs;
  const late = 1 - leftMs / METEOR_ENTRY_MS - entry;
  const speed = Math.abs(late) <= (1.5 * tickMs) / METEOR_ENTRY_MS ? 1 / METEOR_ENTRY_MS : (1 - entry) / Math.max(leftMs, dtMs);
  return Math.max(entry, Math.min(METEOR_MAX_ENTRY, entry + speed * dtMs));
}

/** Raio da bola do meteoro em relação ao raio da cratera na tela (E12). */
export const METEOR_HEAD = 0.35;
/**
 * Bola mínima (px, × dpr) por tamanho (Pequeno, Médio, Grande, Gigante), para o tamanho continuar
 * visível de longe (F5, teste da `58f53e7`: com o globo inteiro na tela a cratera pequena tem ~3 px e a
 * média ~9; o mínimo único de 4 px deixava pequeno, médio e grande iguais). Na proporção das crateras
 * (1 : 2 : 3 : 4). Rocha de menos de ~3 px não se lê como rocha (B1, teste da `9b5ba0d4`: o pequeno de longe
 * tinha cubos de 1 px e "nem aparecia").
 */
export const METEOR_MIN_HEAD = [0, 3, 4.5, 6, 8] as const;
/** Lado mínimo dos cubos da rocha na tela (px, × dpr). */
const METEOR_MIN_CUBE = 2;
/** Quantas vezes o raio da bola ela percorre no céu, quando cabe na tela. */
const METEOR_FALL_HEADS = 16;

/** Raio da bola (px) do meteoro de tamanho `size` (1–4) com a cratera de `craterPx` px na tela. */
export function meteorHead(size: number, craterPx: number, dpr: number): number {
  return Math.max((METEOR_MIN_HEAD[size] ?? 2) * dpr, METEOR_HEAD * craterPx);
}

/**
 * Comprimento da queda (px) até o ponto (x, y): 16 bolas, mas a rocha sempre começa dentro da tela (B1,
 * teste da `9b5ba0d4`: de perto, ou tocando perto da borda, ela nascia fora da tela; pausada, ficava lá e
 * "nem aparecia"). `dx`, `dy`: direção da subida (dy < 0).
 */
export function meteorFall(x: number, y: number, head: number, dx: number, dy: number, width: number, height: number): number {
  const margin = head * 2;
  let len = head * METEOR_FALL_HEADS;
  if (dy < 0) len = Math.min(len, Math.max(0, y - margin) / -dy);
  if (dy > 0) len = Math.min(len, Math.max(0, height - margin - y) / dy);
  if (dx > 0) len = Math.min(len, Math.max(0, width - margin - x) / dx);
  if (dx < 0) len = Math.min(len, Math.max(0, x - margin) / -dx);
  return len;
}

/** Duração das animações (ms). */
const FX_MS: Record<number, number> = {
  // Incêndio (R3), seca e enchente (R4) aparecem nas próprias células, sem animação por cima; o raio é
  // um clarão rápido.
  [DisasterKind.Lightning]: 450,
  // Meteoro: ~1 s entrando no céu e o clarão do impacto.
  [DisasterKind.Meteor]: METEOR_ENTRY_MS + METEOR_AFTER_MS,
};
/** Raio: duração do clarão (ms) dentro da animação. */
const FLASH_MS = 300;
/** Animações ao mesmo tempo, no máximo (em "Muitos" a 20× chegam várias por segundo). */
const MAX_FX = 24;

export class DisasterFx {
  private list: Fx[] = [];

  add(e: DisasterEvent, now: number): void {
    const ms = FX_MS[e.kind];
    if (!ms) return;
    this.list.push({ e, start: now, ms, entry: e.fallDone ?? 0 });
    if (this.list.length <= MAX_FX) return;
    // Cheio: sai o mais antigo que não é meteoro. Sem a rocha, a cratera apareceria do nada (no Máx com "Muitos"
    // os raios enchiam a lista: 6 de 17 meteoros bateram sem rocha na medição).
    const k = this.list.findIndex((f) => f.e.kind !== DisasterKind.Meteor);
    this.list.splice(Math.max(0, k), 1);
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  clear(): void {
    this.list = [];
  }

  /** O meteoro `id` bateu no jogo: a rocha chega ao chão agora. Devolve o evento, se ele estava na tela. */
  land(id: number, now: number): DisasterEvent | undefined {
    const f = this.list.find((x) => x.e.id === id && x.e.kind === DisasterKind.Meteor);
    if (f) f.landed = now;
    return f?.e;
  }

  /** Desenha tudo no instante `now`, com o jogo no passo `tick` (estimado) e neste ritmo; tira o que acabou. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, now: number, tick: number, ticksPerSecond: number, dpr: number): void {
    for (const f of this.list) {
      if (f.e.kind !== DisasterKind.Meteor || f.landed !== undefined) continue;
      f.entry = meteorEntry(f.entry ?? 0, now - (f.drawnAt ?? f.start), (f.e.impactTick ?? f.e.tick) - tick, ticksPerSecond);
      f.drawnAt = now;
    }
    this.list = this.list.filter((f) => (f.e.kind === DisasterKind.Meteor ? f.landed === undefined || now - f.landed < METEOR_AFTER_MS : now - f.start < f.ms));
    for (const f of this.list) {
      if (f.e.kind === DisasterKind.Lightning) drawLightning(ctx, camera, f.e, now - f.start, f.e.id, dpr);
      else if (f.e.kind === DisasterKind.Meteor) drawMeteor(ctx, camera, f.e, f.landed === undefined ? (f.entry ?? 0) : 1 + (now - f.landed) / METEOR_AFTER_MS, f.e.id, dpr);
    }
  }
}

/** Número fixo de 0 a 1 para o meteoro `id` e o índice `k` (o desenho não muda de um quadro para outro). */
function rand(id: number, k: number): number {
  let h = Math.imul(id ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Um cubo visto de cima e de lado (estilo diorama): topo claro, lado esquerdo médio, lado direito escuro.
 * `x, y`: centro; `s`: aresta (px); `rgb`: cor do topo.
 */
function cube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rgb: readonly [number, number, number], alpha: number): void {
  if (alpha <= 0.01 || s < 0.4) return;
  const w = s * 0.87;
  const h = s * 0.5;
  const shade = (k: number) => `rgba(${Math.round(rgb[0] * k)}, ${Math.round(rgb[1] * k)}, ${Math.round(rgb[2] * k)}, ${alpha.toFixed(3)})`;
  ctx.fillStyle = shade(1);
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + w, y - h);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(0.72);
  ctx.beginPath();
  ctx.moveTo(x - w, y - h);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(0.5);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y - h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + s);
  ctx.closePath();
  ctx.fill();
}

const ROCK: readonly [number, number, number] = [92, 88, 86];
const ROCK_DARK: readonly [number, number, number] = [58, 54, 54];
const EMBER: readonly [number, number, number] = [255, 132, 40];
const EMBER_HOT: readonly [number, number, number] = [255, 214, 92];
const SMOKE: readonly [number, number, number] = [168, 166, 164];

/**
 * Meteoro em cubos (B3, escolha do usuário em 2026-11-03: a rocha em brasa da opção 4, com sombra
 * suave, mais a fumacinha final da opção 5; imagem `docs/img/m2-b3-meteoro-cubos.png`). Caindo: rocha
 * de cubos escuros com a frente em brasa, rastro de fumaça cinza em cubos e, no chão, uma sombra suave
 * que cresce até a batida (mostra onde vai cair, também de longe e em 20×). Batendo: clarão curto,
 * entulho e brasas em cubos saltando e a fumacinha subindo e se desfazendo em cubos. O tamanho acompanha
 * a cratera (E12, F5): a rocha tem ~1/3 do raio da cratera na tela.
 */
/** `phase`: 0 a 1 entrando no céu; de 1 a 2, depois de bater. */
function drawMeteor(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, phase: number, id: number, dpr: number): void {
  const c = camera.worldToScreen(e.point);
  if (!c.visible || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
  // Raio da cratera na tela (px): e.radius é o raio dela em radianos.
  const crater = (e.radius / camera.cellAngle) * camera.cellPixels();
  const head = meteorHead(e.magnitude, crater, dpr);
  // Vem do alto, de um lado sorteado (nunca de baixo para cima).
  const dx = (rand(id, 0) < 0.5 ? -1 : 1) * (0.55 + 0.35 * rand(id, 1));
  const dy = -1;
  const canvas = ctx.canvas as HTMLCanvasElement | undefined;
  const w = canvas?.width ?? Infinity;
  const h = canvas?.height ?? Infinity;
  // Sem espaço do lado sorteado e com mais do outro, vem do outro.
  const room = dx > 0 ? w - c.x : c.x;
  const other = dx > 0 ? c.x : w - c.x;
  const fx = room < head * METEOR_FALL_HEADS * Math.abs(dx) && other > room ? -dx : dx;
  const len = meteorFall(c.x, c.y, head, fx, dy, w, h);
  const cubeSize = Math.max(METEOR_MIN_CUBE * dpr, head * 0.55);
  if (phase < 1) {
    const t = phase;
    // Sombra suave no ponto de impacto, crescendo e escurecendo até a batida.
    const sr = Math.max(head * 1.2, crater * (0.35 + 0.55 * t));
    const sg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, sr);
    sg.addColorStop(0, `rgba(10, 8, 6, ${(0.5 * t).toFixed(3)})`);
    sg.addColorStop(0.55, `rgba(10, 8, 6, ${(0.28 * t).toFixed(3)})`);
    sg.addColorStop(1, 'rgba(10, 8, 6, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, sr, sr * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    const hx = c.x + fx * len * (1 - t);
    const hy = c.y + dy * len * (1 - t);
    // Rastro de fumaça: cubos cinza ficando para trás, menores e mais claros quanto mais longe.
    const trail = 14;
    for (let k = 1; k <= trail; k++) {
      const back = (k / trail) * len * 0.9 * Math.min(1, t * 3 + 0.25);
      const jitter = (rand(id, 10 + k) - 0.5) * cubeSize * (0.6 + k * 0.08);
      cube(ctx, hx + fx * back + jitter, hy + dy * back + jitter * 0.5, cubeSize * (0.95 - 0.5 * (k / trail)), SMOKE, 0.9 * (1 - k / (trail + 2)));
    }
    // A rocha: um bloco de cubos escuros, a frente (para o lado da queda) em brasa.
    const parts: [number, number, number][] = [
      [0, 0, 1],
      [-0.55, 0.3, 0.8],
      [0.55, 0.3, 0.85],
      [0, -0.6, 0.75],
      [-0.3, 0.75, 0.7],
      [0.35, 0.8, 0.7],
    ];
    for (let k = 0; k < parts.length; k++) {
      const [ox, oy, sz] = parts[k] as [number, number, number];
      // Frente em brasa: as partes do lado de baixo e do lado para onde vai.
      const front = oy > 0.5 || ox * -Math.sign(fx) > 0.4;
      const color = front ? (k % 2 ? EMBER : EMBER_HOT) : k % 2 ? ROCK_DARK : ROCK;
      cube(ctx, hx + ox * cubeSize * 1.1, hy + oy * cubeSize * 1.1, cubeSize * sz, color, 1);
    }
    return;
  }
  const u = phase - 1; // 0 a 1 depois da batida (METEOR_AFTER_MS)
  const ms = u * METEOR_AFTER_MS;
  const r = Math.max(head * 3, crater * 1.3);
  // Clarão curto.
  if (ms < METEOR_FLASH_MS) {
    const f = 1 - ms / METEOR_FLASH_MS;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0, `rgba(255, 250, 225, ${(0.9 * f).toFixed(3)})`);
    g.addColorStop(0.45, `rgba(255, 190, 110, ${(0.55 * f).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 128, 48, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  }
  // Entulho e brasas em cubos saltando para fora e caindo (0–0,8 s).
  const debris = 10 + e.magnitude * 4;
  const d = Math.min(1, ms / 800);
  if (d < 1) {
    for (let k = 0; k < debris; k++) {
      const a = rand(id, 100 + k) * Math.PI * 2;
      const dist = r * (0.35 + 0.65 * rand(id, 200 + k)) * (0.2 + 0.8 * Math.sqrt(d));
      const up = Math.sin(Math.PI * d) * r * 0.35 * rand(id, 300 + k);
      const hot = rand(id, 400 + k) < 0.3;
      cube(ctx, c.x + Math.cos(a) * dist, c.y + Math.sin(a) * dist * 0.62 - up, cubeSize * (0.45 + 0.4 * rand(id, 500 + k)), hot ? EMBER : rand(id, 600 + k) < 0.5 ? ROCK : ROCK_DARK, 1 - d * d);
    }
  }
  // Fumacinha final: cubos cinza subindo do ponto e se desfazendo (espalham, diminuem e somem).
  const puffs = 10 + e.magnitude * 4;
  for (let k = 0; k < puffs; k++) {
    const start = 0.05 + rand(id, 700 + k) * 0.3;
    const v = (u - start) / (1 - start);
    if (v <= 0 || v >= 1) continue;
    // Coluna que sobe devagar no fim (ease-out) e abre para os lados enquanto se desfaz.
    const rise = (1 - (1 - v) * (1 - v)) * (r * 1.3 + head * 5) * (0.55 + 0.45 * rand(id, 800 + k));
    const spread = (rand(id, 900 + k) - 0.5) * r * (0.3 + 1.1 * v);
    const size = cubeSize * (1.1 + 0.9 * rand(id, 1000 + k)) * (1 - 0.55 * v);
    const tone = 0.85 + 0.25 * rand(id, 1100 + k);
    cube(ctx, c.x + spread, c.y - rise, size, [SMOKE[0] * tone, SMOKE[1] * tone, SMOKE[2] * tone], 0.85 * (1 - v) * Math.min(1, v * 5));
  }
}

/**
 * Raio (R3): um risco em zigue-zague descendo do alto até o ponto e um clarão branco em volta (0,3 s).
 * O desenho é fixo por raio (sorteado pelo id), não muda de um quadro para outro.
 */
function drawLightning(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, ms: number, id: number, dpr: number): void {
  const c = camera.worldToScreen(e.point);
  if (!c.visible || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
  const fade = Math.max(0, 1 - ms / FLASH_MS);
  // Tamanho pelo zoom: de longe um risquinho junto do chão (antes 220 px fixos: parecia cair do espaço).
  const cell = camera.cellPixels();
  const scale = Math.max(0.08, Math.min(1, cell / 40));
  const boltAlpha = ms < FLASH_MS ? 1 : Math.max(0, 1 - (ms - FLASH_MS) / 150);
  // Clarão: brilho radial em volta do ponto.
  if (fade > 0) {
    const r = Math.max(8 * dpr, 60 * dpr * scale);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0, `rgba(255, 255, 255, ${(0.85 * fade).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  }
  // Zigue-zague: de ~220 px acima até o ponto, com desvios sorteados pelo id.
  let h = (Math.imul(id, 2654435761) >>> 0) || 1;
  const rnd = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const top = Math.max(14 * dpr, 220 * dpr * scale);
  let x = c.x + (rnd() - 0.5) * 80 * dpr * scale;
  let y = c.y - top;
  const pts: [number, number][] = [[x, y]];
  while (y < c.y - 12 * dpr) {
    y += Math.max(3 * dpr, (18 + 16 * rnd()) * dpr * scale);
    x += (rnd() - 0.5) * 34 * dpr * scale + (c.x - x) * 0.22;
    pts.push([x, Math.min(y, c.y)]);
  }
  pts.push([c.x, c.y]);
  ctx.lineJoin = 'round';
  for (const [w, color] of [
    [8, `rgba(170, 205, 255, ${(0.45 * boltAlpha).toFixed(3)})`],
    [2.5, `rgba(255, 255, 255, ${boltAlpha.toFixed(3)})`],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w * dpr * Math.max(0.5, scale);
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
}

/** Contorno de um círculo de raio `angle` (rad) na superfície (some atrás do globo). */
export function strokeCap(ctx: CanvasRenderingContext2D, camera: Camera, center: Vec3, angle: number, style: string, width: number): void {
  pathCap(ctx, camera, center, angle);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** Caminho (beginPath…) do círculo de raio `angle` na superfície, só a parte visível. */
function pathCap(ctx: CanvasRenderingContext2D, camera: Camera, center: Vec3, angle: number): void {
  let ax = center[2];
  let az = -center[0];
  let ay = 0;
  if (Math.hypot(ax, az) < 1e-6) [ax, ay, az] = [1, 0, 0];
  const alen = Math.hypot(ax, ay, az);
  ax /= alen;
  ay /= alen;
  az /= alen;
  const bx = center[1] * az - center[2] * ay;
  const by = center[2] * ax - center[0] * az;
  const bz = center[0] * ay - center[1] * ax;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const steps = 48;
  ctx.beginPath();
  let penDown = false;
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * Math.PI * 2;
    const ct = Math.cos(t) * s;
    const st = Math.sin(t) * s;
    const q = camera.worldToScreen([center[0] * c + ax * ct + bx * st, center[1] * c + ay * ct + by * st, center[2] * c + az * ct + bz * st]);
    if (!q.visible) {
      penDown = false;
      continue;
    }
    if (penDown) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
    penDown = true;
  }
}
