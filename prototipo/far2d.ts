import { Biome } from '../src/world/biomes';
import type { WorldState } from '../src/world/state';
import { REGION, type RegionPlace, type Scene } from './scene';
import type { RGB } from './styles';

/**
 * O globo de longe, em pixel 2D, no estilo escolhido: um trecho desenhado com Canvas 2D só para o guia de
 * estilo. Cada célula tem o bioma, e em cima dela as árvores uma a uma, as montanhas, as ruas e a cidade.
 */
const W = 160, H = 90, PX = 8;

const css = (c: RGB, k = 1) => `rgb(${Math.min(255, c[0] * k * 255) | 0},${Math.min(255, c[1] * k * 255) | 0},${Math.min(255, c[2] * k * 255) | 0})`;

function hash(x: number, y: number): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function drawFar(world: WorldState, at: RegionPlace, scene: Scene): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W * PX;
  canvas.height = H * PX;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const st = scene.style;
  const n = world.grid.n;
  const cx = at.x0 + REGION / 2, cy = at.y0 + REGION / 2;
  const x0 = Math.max(0, Math.min(n - W, Math.round(cx - W / 2))), y0 = Math.max(0, Math.min(n - H, Math.round(cy - H / 2)));
  const sx = (gridX: number) => (at.flip ? W - 1 - (gridX - x0) : gridX - x0);
  const cellAt = (x: number, y: number) => world.grid.index(at.face, at.flip ? x0 + (W - 1 - x) : x0 + x, y0 + y);
  // Terreno, com um ponto mais claro ou escuro para virar textura.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellAt(x, y);
      const b = world.biome[c] as number;
      const base = (world.isWater(c) ? (b === Biome.DeepOcean ? ([st.water[0] * 0.8, st.water[1] * 0.8, st.water[2] * 0.85] as RGB) : st.water) : st.biome[b]) as RGB;
      ctx.fillStyle = css(base);
      ctx.fillRect(x * PX, y * PX, PX, PX);
      for (let k = 0; k < 3; k++) {
        const r = hash(x * 7 + k, y * 13);
        ctx.fillStyle = css(base, r < 0.5 ? 0.93 : 1.06);
        ctx.fillRect(x * PX + Math.floor(hash(x, y + k * 31) * 7), y * PX + Math.floor(hash(x + k * 17, y) * 7), 2, 2);
      }
    }
  }
  // Costa com uma linha, para ler o desenho do litoral.
  ctx.fillStyle = css(st.side, 0.8);
  for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
    const here = world.isWater(cellAt(x, y));
    if (here !== world.isWater(cellAt(x - 1, y))) ctx.fillRect(x * PX - 1, y * PX, 2, PX);
    if (here !== world.isWater(cellAt(x, y - 1))) ctx.fillRect(x * PX, y * PX - 1, PX, 2);
  }
  // Montanhas e árvores, de cima para baixo (o de baixo cobre o de cima).
  const leaves = st.leaves;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellAt(x, y);
      const b = world.biome[c] as number;
      const r = hash(x, y);
      if (b === Biome.Mountain || b === Biome.SnowyPeak) {
        if (r > 0.55) continue;
        const h = 7 + r * 8, px = x * PX + 4, py = y * PX + 7;
        ctx.fillStyle = css(st.side, 0.62);
        ctx.beginPath(); ctx.moveTo(px - h * 0.8, py); ctx.lineTo(px, py - h); ctx.lineTo(px + h * 0.8, py); ctx.fill();
        ctx.fillStyle = css(st.biome[Biome.Mountain] as RGB, 1.05);
        ctx.beginPath(); ctx.moveTo(px - h * 0.8, py); ctx.lineTo(px, py - h); ctx.lineTo(px, py); ctx.fill();
        if (b === Biome.SnowyPeak || h > 12) {
          ctx.fillStyle = css(st.biome[Biome.SnowyPeak] as RGB);
          ctx.beginPath(); ctx.moveTo(px - h * 0.25, py - h * 0.68); ctx.lineTo(px, py - h); ctx.lineTo(px + h * 0.25, py - h * 0.68); ctx.fill();
        }
      } else if (b === Biome.TemperateForest || b === Biome.TropicalForest || b === Biome.Taiga || (b === Biome.Swamp && r < 0.4) || (b === Biome.Savanna && r < 0.08) || (b === Biome.Grassland && r < 0.05)) {
        const px = x * PX + 2 + Math.floor(hash(y, x) * 4), py = y * PX + 3 + Math.floor(r * 4);
        const leaf = leaves[Math.floor(r * leaves.length)] as RGB;
        ctx.fillStyle = css(leaf, 0.6);
        ctx.fillRect(px - 1, py + 3, 5, 2);
        ctx.fillStyle = css(leaf);
        if (st.tree === 'cone') { ctx.fillRect(px + 1, py - 3, 1, 1); ctx.fillRect(px, py - 2, 3, 2); ctx.fillRect(px - 1, py, 5, 3); }
        else if (st.tree === 'round') { ctx.fillRect(px, py - 2, 3, 1); ctx.fillRect(px - 1, py - 1, 5, 3); ctx.fillRect(px, py + 2, 3, 1); }
        else ctx.fillRect(px - 1, py - 2, 5, 5);
        ctx.fillStyle = css(leaf, 1.2);
        ctx.fillRect(px, py - 1, 2, 1);
      }
    }
  }
  // Rio, vilas e cidade, nas posições da região.
  const rx = (x: number) => (at.flip ? W - 1 - sx(at.x0 + REGION - 1 - x) : sx(at.x0 + x)), ry = (y: number) => at.y0 + y - y0;
  void rx;
  const place = (x: number) => (at.flip ? sx(at.x0 + REGION - 1 - x) : sx(at.x0 + x));
  ctx.fillStyle = css(st.water, 1.05);
  for (const i of scene.river) ctx.fillRect(place(i % REGION) * PX + 1, ry(Math.floor(i / REGION)) * PX + 1, PX - 2, PX - 2);
  scene.centers.forEach((c, k) => {
    const city = k === 0;
    const cxp = place(c.x), cyp = ry(c.y);
    for (let dy = -c.r; dy <= c.r; dy++) for (let dx = -c.r; dx <= c.r; dx++) {
      if (Math.hypot(dx, dy) > c.r + 0.5) continue;
      const wx = cxp + dx, wy = cyp + dy;
      if (wx < 0 || wy < 0 || wx >= W || wy >= H || world.isWater(cellAt(wx, wy))) continue;
      const street = city ? dx % 4 === 0 || dy % 4 === 0 : dx === 0 || dy === 0;
      if (street) {
        ctx.fillStyle = css(st.road);
        ctx.fillRect(wx * PX, wy * PX, PX, PX);
      } else if (city || hash(wx, wy) < 0.5) {
        const wall = st.walls[0] as RGB, roof = st.roofs[Math.floor(hash(wy, wx) * st.roofs.length)] as RGB;
        const inset = city ? 1 : 2;
        ctx.fillStyle = css(wall, 0.75);
        ctx.fillRect(wx * PX + inset, wy * PX + inset + 3, PX - inset * 2, 3);
        ctx.fillStyle = css(roof);
        ctx.fillRect(wx * PX + inset, wy * PX + inset, PX - inset * 2, 4);
      }
    }
  });
  return canvas;
}
