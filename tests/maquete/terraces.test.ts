import { describe, expect, it } from 'vitest';
import { buildTerrain, levelY, newFields, prepareSteps, surfaceY, TERRACE, TERRACE_BASE, VERTEX_BYTES, type Fields } from '../../src/maquete/chunk-build';
import { Biome } from '../../src/world/biomes';
import { buildWorldChunk, type CoarseWorld } from '../../src/maquete/world-fields';
import { CHUNK_CELLS } from '../../src/maquete/chart';

/** Campo de teste: `u` dado por uma função, chão todo preso ao patamar. */
function fieldsOf(size: number, u: (x: number, z: number) => number): Fields {
  const f = newFields(size, 3);
  for (let j = 0; j < f.stride; j++) for (let i = 0; i < f.stride; i++) {
    const k = j * f.stride + i;
    f.u[k] = u(i - f.margin, j - f.margin);
    f.keep[k] = 1;
    f.r[k] = 0.4; f.g[k] = 0.6; f.b[k] = 0.2;
  }
  prepareSteps(f);
  return f;
}

function heights(mesh: ArrayBuffer): number[] {
  const v = new DataView(mesh), out: number[] = [];
  for (let o = 0; o < mesh.byteLength; o += VERTEX_BYTES) out.push(v.getFloat32(o + 4, true));
  return out;
}

describe('terraços da maquete', () => {
  it('a altura do patamar cresce com o nível; na montanha, só de três em três a partir do pé', () => {
    expect(levelY(0, 1)).toBeCloseTo(TERRACE_BASE);
    expect(levelY(3, 1)).toBeCloseTo(TERRACE_BASE + 3 * TERRACE);
    // Pé da montanha no nível 4: os níveis 4, 5 e 6 ficam no mesmo patamar e o 7 sobe três degraus de uma vez.
    expect(levelY(4, 3, 4)).toBeCloseTo(levelY(4, 1));
    expect(levelY(6, 3, 4)).toBeCloseTo(levelY(4, 1));
    expect(levelY(7, 3, 4)).toBeCloseTo(levelY(7, 1));
    // Abaixo do pé, degrau comum: a montanha não cava um fosso em volta.
    expect(levelY(2, 3, 4)).toBeCloseTo(levelY(2, 1));
    for (let l = -3; l < 12; l++) expect(levelY(l + 1, 3, 4)).toBeGreaterThanOrEqual(levelY(l, 3, 4));
  });

  it('numa encosta, todo vértice fica num patamar ou no pé de uma parede: nada no meio do caminho', () => {
    const f = fieldsOf(12, (x, z) => 0.2 + x * 0.37 + z * 0.11);
    const mesh = buildTerrain(f, 0, 0, 7);
    expect(mesh.byteLength % (VERTEX_BYTES * 3)).toBe(0);
    const allowed: number[] = [];
    for (let l = -2; l < 10; l++) { allowed.push(levelY(l, 1)); allowed.push(levelY(l, 1) - 0.03); }
    for (const y of heights(mesh)) {
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.min(...allowed.map((a) => Math.abs(a - y)))).toBeLessThan(1e-4);
    }
  });

  it('há parede entre dois patamares: a malha tem vértices nos dois níveis da troca', () => {
    const f = fieldsOf(8, (x) => (x < 4 ? 0.5 : 1.5));
    const ys = heights(buildTerrain(f, 0, 0, 7));
    expect(ys.some((y) => Math.abs(y - levelY(1, 1)) < 1e-4)).toBe(true);
    expect(ys.some((y) => Math.abs(y - levelY(0, 1)) < 1e-4)).toBe(true);
    // Pé da parede, um pouco enterrado no patamar de baixo.
    expect(ys.some((y) => Math.abs(y - (levelY(0, 1) - 0.03)) < 1e-4)).toBe(true);
  });

  it('crista fina que mal passa do nível não vira risco de terra: fica no patamar de baixo', () => {
    const f = fieldsOf(10, (x) => (x === 5 ? 1.2 : 0.5));
    for (const y of heights(buildTerrain(f, 0, 0, 7))) expect(y).toBeLessThan(levelY(0, 1) + 1e-4);
  });

  it('vala fina também some; patamar largo continua', () => {
    const ditch = fieldsOf(10, (x) => (x === 5 ? 0.6 : 1.5));
    for (const y of heights(buildTerrain(ditch, 0, 0, 7))) expect(y).toBeGreaterThan(levelY(1, 1) - 1e-4);
    const wide = fieldsOf(10, (x) => (x >= 3 && x <= 7 ? 1.2 : 0.5));
    expect(heights(buildTerrain(wide, 0, 0, 7)).some((y) => Math.abs(y - levelY(1, 1)) < 1e-4)).toBe(true);
  });

  it('a planta pisa no patamar, não no meio da parede', () => {
    const f = fieldsOf(8, (x) => 0.2 + x * 0.4);
    for (let x = 0.05; x < 7.9; x += 0.37) {
      const y = surfaceY(f, x, 3.3), level = Math.floor(0.2 + x * 0.4);
      expect(y).toBeCloseTo(levelY(level, 1), 4);
    }
  });
});

/** Mundo pequeno com uma serra no meio da face 0: cada pico tem de sair igual nos pedaços vizinhos. */
function rangeWorld(n: number): CoarseWorld {
  const count = 6 * n * n;
  const w: CoarseWorld = { n, height: new Int16Array(count), rgba: new Uint8Array(count * 4), cover: new Uint8Array(count).fill(200), state: new Uint8Array(count), deposit: new Uint8Array(count), ice: new Uint8Array(count), temp: new Int8Array(count).fill(10), volcano: new Uint8Array(count) };
  for (let c = 0; c < count; c++) {
    const rest = c % (n * n), x = rest % n, y = Math.floor(rest / n);
    const h = 400 + 3200 * Math.max(0, 1 - Math.hypot(x - n / 2, y - n / 2) / (n * 0.42));
    w.height[c] = h;
    w.rgba[c * 4] = 120; w.rgba[c * 4 + 1] = 150; w.rgba[c * 4 + 2] = 90;
    w.rgba[c * 4 + 3] = h > 2000 ? Biome.Mountain : Biome.Grassland;
  }
  return w;
}

describe('picos da montanha', () => {
  it('pedaços vizinhos têm a mesma altura na borda que dividem', () => {
    const w = rangeWorld(32), g = CHUNK_CELLS + 1;
    const a = buildWorldChunk(w, null, 0, 1, 1), b = buildWorldChunk(w, null, 0, 2, 1), c = buildWorldChunk(w, null, 0, 1, 2);
    let high = 0;
    for (let j = 0; j < g; j++) {
      expect(a.walkY[j * g + CHUNK_CELLS]).toBeCloseTo(b.walkY[j * g] as number, 4);
      expect(a.walkY[CHUNK_CELLS * g + j]).toBeCloseTo(c.walkY[j] as number, 4);
      high = Math.max(high, a.walkY[j * g + CHUNK_CELLS] as number);
    }
    // A serra do teste tem picos de verdade nessa borda (senão o teste não provaria nada).
    expect(high).toBeGreaterThan(6);
  }, 30000);

  it('a mesma célula dá o mesmo pedaço (determinismo)', () => {
    const w = rangeWorld(32);
    const a = buildWorldChunk(w, null, 0, 1, 1), b = buildWorldChunk(w, null, 0, 1, 1);
    expect(new Uint8Array(a.terrain)).toEqual(new Uint8Array(b.terrain));
  }, 30000);
});
