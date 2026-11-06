import type { Camera } from '../src/render/camera';
import type { WorldState } from '../src/world/state';

/**
 * Item 1.4: prova da escala. Espalha cidades, países e rotas no mundo gerado e desenha por cima do globo, como o 2D de longe faria.
 * De longe a cidade é um símbolo de mapa, maior que o tamanho real dela: é o que faz o mundo parecer coberto.
 */
export interface Occupation {
  cities: number[];
  capitals: number[];
  country: Int16Array;
  roads: [number, number][];
  sea: [number, number][];
  air: [number, number][];
  landCells: number;
}

function hash(a: number, b: number): number {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** `cityTarget`: número de cidades; `countryTarget`: número de países. */
export function occupy(world: WorldState, cityTarget: number, countryTarget: number): Occupation {
  const g = world.grid, count = world.cellCount;
  const land: number[] = [];
  const point = new Float32Array(count * 3);
  const p: [number, number, number] = [0, 0, 0];
  for (let c = 0, f = 0; f < 6; f++) for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++, c++) {
    const i = g.index(f, x, y);
    g.cellToPoint(f, x, y, p);
    point[i * 3] = p[0]; point[i * 3 + 1] = p[1]; point[i * 3 + 2] = p[2];
    if (!world.isWater(i)) land.push(i);
  }
  // Ordem fixa e embaralhada; cada cidade nova fica a uma distância mínima das outras, com tabela por setor para ser rápida.
  const shuffled = land.map((c) => [hash(c, 17), c] as const).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
  const angle = Math.sqrt((4 * Math.PI * (land.length / count)) / Math.max(1, cityTarget)) * 0.72;
  const cos = Math.cos(angle);
  const SECT = Math.max(4, Math.min(64, Math.floor(2 / angle)));
  const sector = (i: number) => {
    const a = Math.floor(((point[i * 3] as number) + 1) * 0.4999 * SECT), b = Math.floor(((point[i * 3 + 1] as number) + 1) * 0.4999 * SECT), d = Math.floor(((point[i * 3 + 2] as number) + 1) * 0.4999 * SECT);
    return [a, b, d] as const;
  };
  const buckets = new Map<number, number[]>();
  const key = (a: number, b: number, d: number) => (a * SECT + b) * SECT + d;
  const cities: number[] = [];
  for (const c of shuffled) {
    if (cities.length >= cityTarget) break;
    const [a, b, d] = sector(c);
    let ok = true;
    for (let x = a - 1; x <= a + 1 && ok; x++) for (let y = b - 1; y <= b + 1 && ok; y++) for (let z = d - 1; z <= d + 1 && ok; z++) {
      for (const o of buckets.get(key(x, y, z)) ?? []) {
        const dot = (point[c * 3] as number) * (point[o * 3] as number) + (point[c * 3 + 1] as number) * (point[o * 3 + 1] as number) + (point[c * 3 + 2] as number) * (point[o * 3 + 2] as number);
        if (dot > cos) { ok = false; break; }
      }
    }
    if (!ok) continue;
    cities.push(c);
    const k = key(a, b, d);
    const list = buckets.get(k);
    if (list) list.push(c);
    else buckets.set(k, [c]);
  }
  const capitals = cities.filter((_, i) => i % Math.max(1, Math.round(cities.length / countryTarget)) === 0).slice(0, countryTarget);
  const country = new Int16Array(count).fill(-1);
  for (const c of land) {
    let best = -1, bestDot = -2;
    for (let k = 0; k < capitals.length; k++) {
      const o = capitals[k] as number;
      const dot = (point[c * 3] as number) * (point[o * 3] as number) + (point[c * 3 + 1] as number) * (point[o * 3 + 1] as number) + (point[c * 3 + 2] as number) * (point[o * 3 + 2] as number);
      if (dot > bestDot) { bestDot = dot; best = k; }
    }
    country[c] = best;
  }
  const dotOf = (a: number, b: number) => (point[a * 3] as number) * (point[b * 3] as number) + (point[a * 3 + 1] as number) * (point[b * 3 + 1] as number) + (point[a * 3 + 2] as number) * (point[b * 3 + 2] as number);
  const midWater = (a: number, b: number) => {
    let water = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = (point[a * 3] as number) * (1 - t) + (point[b * 3] as number) * t, y = (point[a * 3 + 1] as number) * (1 - t) + (point[b * 3 + 1] as number) * t, z = (point[a * 3 + 2] as number) * (1 - t) + (point[b * 3 + 2] as number) * t;
      if (world.isWater(g.pointToCell(x, y, z))) water++;
    }
    return water;
  };
  const roads: [number, number][] = [], sea: [number, number][] = [], air: [number, number][] = [];
  const reach = Math.cos(angle * 2.4);
  for (const c of cities) {
    const [a, b, d] = sector(c);
    const near: [number, number][] = [];
    const span = Math.ceil(angle * 2.4 * SECT * 0.5);
    for (let x = a - span; x <= a + span; x++) for (let y = b - span; y <= b + span; y++) for (let z = d - span; z <= d + span; z++) {
      for (const o of buckets.get(key(x, y, z)) ?? []) if (o > c && dotOf(c, o) > reach) near.push([dotOf(c, o), o]);
    }
    near.sort((u, v) => v[0] - u[0]);
    for (const [, o] of near.slice(0, 2)) {
      if (midWater(c, o) === 0) roads.push([c, o]);
      else if (hash(c, o) < 0.5) sea.push([c, o]);
    }
  }
  // Rotas aéreas: cada capital com a seguinte, e algumas longas.
  for (let k = 0; k + 7 < capitals.length; k += 7) air.push([capitals[k] as number, capitals[k + 7] as number]);
  return { cities, capitals, country, roads, sea, air, landCells: land.length };
}

/** Desenha por cima do globo, na câmera dada. `symbol`: tamanho do símbolo da cidade, em pixels. */
export function drawOccupation(ctx: CanvasRenderingContext2D, world: WorldState, camera: Camera, o: Occupation, symbol: number): void {
  const g = world.grid;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const screen = (c: number) => {
    const f = Math.floor(c / (g.n * g.n)), rest = c - f * g.n * g.n;
    const p = g.cellToPoint(f, rest % g.n, Math.floor(rest / g.n));
    return camera.worldToScreen([p[0] as number, p[1] as number, p[2] as number]);
  };
  // Fronteiras: pixel a pixel, onde o país muda.
  const img = ctx.createImageData(w, h);
  const owner = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = camera.pick(x, y);
    if (v) owner[y * w + x] = o.country[g.pointToCell(v[0], v[1], v[2])] as number;
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = owner[y * w + x] as number, r = owner[y * w + x + 1] as number, d = owner[(y + 1) * w + x] as number;
    if (a >= 0 && ((r >= 0 && r !== a) || (d >= 0 && d !== a))) {
      const i = (y * w + x) * 4;
      img.data[i] = 30; img.data[i + 1] = 20; img.data[i + 2] = 20; img.data[i + 3] = 170;
    }
  }
  ctx.putImageData(img, 0, 0);
  const line = (list: [number, number][], color: string, width: number, dash: number[]) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath();
    for (const [a, b] of list) {
      const p = screen(a), q = screen(b);
      if (!p.visible || !q.visible) continue;
      ctx.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
      ctx.lineTo(Math.round(q.x) + 0.5, Math.round(q.y) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(o.roads, 'rgba(250,235,200,0.8)', symbol >= 8 ? 2 : 1, []);
  line(o.sea, 'rgba(235,245,255,0.7)', 1, [3, 3]);
  line(o.air, 'rgba(255,255,255,0.35)', 1, [1, 4]);
  const capitalSet = new Set(o.capitals);
  // Três tamanhos, como no mundo real: poucas grandes, algumas médias, muitas pequenas. Cada uma é um carimbo de quarteirões.
  for (const c of o.cities) {
    const p = screen(c);
    if (!p.visible) continue;
    const r = hash(c, 91), capital = capitalSet.has(c);
    const scale = capital || r < 0.05 ? 1.7 : r < 0.25 ? 1 : 0.65;
    const s = Math.max(2, Math.round(symbol * scale)), x = Math.round(p.x - s / 2), y = Math.round(p.y - s / 2);
    ctx.fillStyle = '#2a1a16';
    ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(x, y, s, s);
    const block = s >= 12 ? 3 : s >= 6 ? 2 : s;
    for (let by = 0; by < s; by += block + 1) for (let bx = 0; bx < s; bx += block + 1) {
      ctx.fillStyle = hash(c + bx * 7, by + 3) < 0.5 ? '#c8452f' : hash(c + by, bx) < 0.5 ? '#e0683f' : '#f4e3c8';
      ctx.fillRect(x + bx, y + by, Math.min(block, s - bx), Math.min(block, s - by));
    }
    if (capital) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + (s >> 1) - 1, y - 3, 2, 2); }
  }
}
