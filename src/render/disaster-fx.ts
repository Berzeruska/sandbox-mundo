import type { Vec3 } from '../world/cubesphere';
import { DisasterKind, type DisasterEvent } from '../world/disasters/types';
import type { Camera } from './camera';

/**
 * Animações dos desastres na camada sobreposta (canvas 2D por cima do globo). Correm em tempo real,
 * independente da velocidade do jogo: a 20× um ano passa em 0,05 s e nada seria visto. Os efeitos de
 * verdade (relevo, marcas) a simulação já aplicou.
 */

interface Fx {
  e: DisasterEvent;
  /** Início (ms, relógio da página) e duração. */
  start: number;
  ms: number;
}

/** Duração das animações (ms). */
const FX_MS: Record<number, number> = {
  [DisasterKind.Quake]: 1800,
  [DisasterKind.Tsunami]: 6000,
  [DisasterKind.Volcano]: 3200,
  [DisasterKind.Hurricane]: 9000,
  // Incêndio (R3), seca e enchente (R4) aparecem nas próprias células, sem animação por cima; o raio é
  // um clarão rápido.
  [DisasterKind.Lightning]: 450,
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
    this.list.push({ e, start: now, ms });
    if (this.list.length > MAX_FX) this.list.shift();
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  /**
   * Furacões em curso, para o shader das nuvens: posição na trilha (anda nela em FX_MS) e força. Devolve
   * quantos. `storms`: centro xyz + raio; `power`: força 0–1, com o sinal do sentido do giro.
   */
  stormsAt(now: number, storms: Float32Array, power: Float32Array, max: number): number {
    let n = 0;
    for (const f of this.list) {
      if (f.e.kind !== DisasterKind.Hurricane || !f.e.path || n >= max) continue;
      const path = f.e.path;
      const count = path.length / 3;
      if (count < 1) continue;
      const u = Math.min(1, (now - f.start) / f.ms);
      const x = u * (count - 1);
      const i = Math.min(count - 1, Math.floor(x));
      const j = Math.min(count - 1, i + 1);
      const t = x - i;
      let px = (path[i * 3] as number) * (1 - t) + (path[j * 3] as number) * t;
      let py = (path[i * 3 + 1] as number) * (1 - t) + (path[j * 3 + 1] as number) * t;
      let pz = (path[i * 3 + 2] as number) * (1 - t) + (path[j * 3 + 2] as number) * t;
      const l = Math.hypot(px, py, pz) || 1;
      px /= l;
      py /= l;
      pz /= l;
      const st = f.e.strength;
      const cat = st ? (st[i] as number) * (1 - t) + (st[j] as number) * t : f.e.magnitude;
      // Nasce e some aos poucos.
      const fade = Math.min(1, u * 8, (1 - u) * 6);
      storms.set([px, py, pz, f.e.radius * (0.6 + 0.4 * Math.min(1, cat / 5))], n * 4);
      // Hemisfério norte gira no sentido anti-horário visto de cima.
      power[n] = (py >= 0 ? 1 : -1) * Math.max(0.05, Math.min(1, cat / 5) * fade);
      n++;
    }
    return n;
  }

  clear(): void {
    this.list = [];
  }

  /** Desenha tudo no instante `now`; tira o que acabou. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, now: number, dpr: number): void {
    this.list = this.list.filter((f) => now - f.start < f.ms);
    for (const f of this.list) {
      const u = (now - f.start) / f.ms;
      if (f.e.kind === DisasterKind.Quake) drawQuake(ctx, camera, f.e, u, dpr);
      else if (f.e.kind === DisasterKind.Tsunami) drawWave(ctx, camera, f.e, u, dpr);
      else if (f.e.kind === DisasterKind.Volcano) drawEruption(ctx, camera, f.e, u, f.e.id, dpr);
      else if (f.e.kind === DisasterKind.Lightning) drawLightning(ctx, camera, f.e, now - f.start, f.e.id, dpr);
    }
  }
}

/** Terremoto: três anéis que se abrem do epicentro e somem; os grandes em vermelho. */
function drawQuake(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, u: number, dpr: number): void {
  const color = e.notable ? '255, 80, 50' : '255, 190, 90';
  for (let k = 0; k < 3; k++) {
    const t = u * 1.5 - k * 0.22;
    if (t <= 0 || t >= 1) continue;
    const alpha = (1 - t) * (e.notable ? 0.95 : 0.7);
    strokeCap(ctx, camera, e.point, e.radius * t, `rgba(${color}, ${alpha.toFixed(3)})`, (e.notable ? 2.5 : 1.5) * dpr);
  }
  // Ponto no epicentro.
  const c = camera.worldToScreen(e.point);
  if (c.visible && u < 0.8) {
    ctx.fillStyle = `rgba(${color}, ${(1 - u / 0.8).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Raio (R3): um risco em zigue-zague descendo do alto até o ponto e um clarão branco em volta (0,3 s).
 * O desenho é fixo por raio (sorteado pelo id), não muda de um quadro para outro.
 */
function drawLightning(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, ms: number, id: number, dpr: number): void {
  const c = camera.worldToScreen(e.point);
  if (!c.visible) return;
  const fade = Math.max(0, 1 - ms / FLASH_MS);
  const boltAlpha = ms < FLASH_MS ? 1 : Math.max(0, 1 - (ms - FLASH_MS) / 150);
  // Clarão: brilho radial em volta do ponto.
  if (fade > 0) {
    const r = 60 * dpr;
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
  const top = 220 * dpr;
  let x = c.x + (rnd() - 0.5) * 80 * dpr;
  let y = c.y - top;
  const pts: [number, number][] = [[x, y]];
  while (y < c.y - 12 * dpr) {
    y += (18 + 16 * rnd()) * dpr;
    x += (rnd() - 0.5) * 34 * dpr + (c.x - x) * 0.22;
    pts.push([x, Math.min(y, c.y)]);
  }
  pts.push([c.x, c.y]);
  ctx.lineJoin = 'round';
  for (const [w, color] of [
    [8, `rgba(170, 205, 255, ${(0.45 * boltAlpha).toFixed(3)})`],
    [2.5, `rgba(255, 255, 255, ${boltAlpha.toFixed(3)})`],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w * dpr;
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
}

/** Tsunami: a frente da onda (pontos de mar no tempo de chegada) andando pelo oceano. */
function drawWave(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, u: number, dpr: number): void {
  const path = e.path;
  const times = e.times;
  if (!path || !times) return;
  const band = 0.07;
  // Tamanho do ponto: pelo menos uma célula na tela (a frente fica contínua) e no mínimo 3 px.
  const size = Math.max(3 * dpr, camera.cellPixels() * 1.2);
  for (let i = 0; i < times.length; i++) {
    const d = u - (times[i] as number);
    if (d < 0 || d > band) continue;
    const p: Vec3 = [path[i * 3] as number, path[i * 3 + 1] as number, path[i * 3 + 2] as number];
    const q = camera.worldToScreen(p);
    if (!q.visible) continue;
    const a = Math.min(1, 1.4 * (1 - d / band)) * (1 - 0.4 * u);
    ctx.fillStyle = `rgba(235, 250, 255, ${a.toFixed(3)})`;
    ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
  }
}

/** Erupção: brilho de lava no centro, fagulhas e a nuvem de cinzas que se abre e some. */
function drawEruption(ctx: CanvasRenderingContext2D, camera: Camera, e: DisasterEvent, u: number, id: number, dpr: number): void {
  const c = camera.worldToScreen(e.point);
  if (!c.visible) return;
  // Nuvem de cinzas: abre até o raio das cinzas.
  const grow = Math.min(1, u * 1.6);
  const fade = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
  pathCap(ctx, camera, e.point, Math.max(e.radius * grow, 1e-4));
  ctx.fillStyle = `rgba(95, 90, 88, ${(0.45 * fade).toFixed(3)})`;
  ctx.fill();
  // Brilho no centro, pulsando.
  const glow = (e.notable ? 7 : 4) * dpr * (1 + 0.3 * Math.sin(u * 30));
  ctx.fillStyle = `rgba(255, ${Math.round(120 + 80 * (1 - u))}, 40, ${(0.95 * fade).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(c.x, c.y, glow, 0, Math.PI * 2);
  ctx.fill();
  // Fagulhas: riscos curtos saindo do centro, em direções fixas por erupção.
  if (u < 0.5) {
    ctx.strokeStyle = `rgba(255, 170, 60, ${(1 - u / 0.5).toFixed(3)})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    const n = e.notable ? 10 : 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + id;
      const r0 = glow + u * 30 * dpr;
      const r1 = r0 + 6 * dpr;
      ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
      ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
    }
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
