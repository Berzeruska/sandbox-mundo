import { bakeProps } from '../maquete/chunk-build';
import { ANIMALS, animalModel, POSES, SWIMMERS, type Animal } from '../maquete/animals';
import { hash3 } from '../maquete/hash';
import { ANIMAL_FLOATS, type InstanceBatch, type MaqueteRenderer } from './maquete-renderer';

/** Animais andando ao acaso (T7): só desenho. Sem fome, sem caça e sem morte: isso vem com a especificação do M3. */
interface Member {
  species: number;
  x: number;
  z: number;
  yaw: number;
  /** 0 parado, 1 andando, 3 comendo, 4 morto. */
  state: number;
  until: number;
  seed: number;
  step: number;
}
interface Herd { members: Member[]; y: Float32Array; mask: Uint8Array }

const GRID = 33;
const SIZE: Partial<Record<Animal, number>> = { elefante: 1.5, alce: 0.95, bisao: 0.95, urso: 0.8, camelo: 0.85, rena: 0.7, cervo: 0.7, zebra: 0.7, leao: 0.72, onca: 0.62, lobo: 0.55, loboArtico: 0.55, javali: 0.5, antilope: 0.55, cabra: 0.5, capivara: 0.42, macaco: 0.3, lebre: 0.25, jacare: 0.7 };
const SPEED: Partial<Record<Animal, number>> = { elefante: 0.7, lebre: 1.1, jacare: 0.35, urso: 0.55, baleia: 0.9, cachalote: 0.9, aguia: 2.4 };

export class AnimalHerds {
  private herds = new Map<number, Herd>();
  private meshIds = new Map<number, number>();
  private buckets = new Map<number, InstanceBatch>();
  private blobData = new Float32Array(ANIMAL_FLOATS * 256);
  private last = 0;
  count = 0;

  constructor(private renderer: MaqueteRenderer) {}

  setChunk(key: number, animals: Float32Array, y: Float32Array, mask: Uint8Array): void {
    const old = this.herds.get(key);
    if (old) { old.y = y; old.mask = mask; return; }
    const members: Member[] = [];
    for (let o = 0; o + 4 <= animals.length; o += 4) {
      const seed = animals[o + 3] as number;
      // Uns poucos caídos, para a pose "morto" existir sem simulação.
      members.push({ species: animals[o] as number, x: animals[o + 1] as number, z: animals[o + 2] as number, yaw: seed * 6.283, state: seed < 0.025 ? 4 : 0, until: seed * 3, seed: seed * 9973, step: 0 });
    }
    this.herds.set(key, { members, y, mask });
  }

  removeChunk(key: number): void { this.herds.delete(key); }

  private mesh(species: number, pose: number): number {
    const key = species * 8 + pose;
    let id = this.meshIds.get(key);
    if (id === undefined) {
      const model = animalModel(ANIMALS[species] as Animal, POSES[pose] as (typeof POSES)[number]);
      const white: readonly [number, number, number] = [1, 1, 1];
      id = this.renderer.addMesh(bakeProps([{ model, x: 0, y: 0, z: 0, scale: 1, stretch: 1, yaw: 0, tint: white }]));
      this.meshIds.set(key, id);
    }
    return id;
  }

  update(time: number): void {
    const dt = Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    for (const b of this.buckets.values()) b.count = 0;
    let blobs = 0, total = 0;
    for (const [key, h] of this.herds) {
      const place = this.renderer.placeOf(key);
      if (!place) continue;
      const size = GRID - 1;
      const origin = chunkOrigin(key);
      for (const a of h.members) {
        const name = ANIMALS[a.species] as Animal, swims = SWIMMERS.has(name), flies = name === 'aguia';
        const speed = SPEED[name] ?? 0.8;
        if (a.state !== 4 && time > a.until) {
          a.seed = hash3(Math.floor(a.seed) + 1, a.species, 7) * 99991;
          const r = (a.seed % 1000) / 1000;
          a.state = swims || flies || r < 0.55 ? 1 : r < 0.8 ? 0 : 3;
          a.until = time + 1.5 + ((a.seed % 400) / 100);
          if (a.state === 1) a.yaw += ((a.seed % 700) / 700 - 0.5) * 2.2;
        }
        if (a.state === 1) {
          a.step += dt;
          const nx = a.x + Math.cos(a.yaw) * speed * dt, nz = a.z - Math.sin(a.yaw) * speed * dt;
          const inside = nx > 0.3 && nz > 0.3 && nx < size - 0.3 && nz < size - 0.3;
          const m = inside ? (h.mask[Math.round(nz) * GRID + Math.round(nx)] as number) : 9;
          if (flies ? inside : swims ? m === 2 : m === 0) { a.x = nx; a.z = nz; } else a.yaw += 2.2;
        }
        const i = Math.floor(a.x), j = Math.floor(a.z), tx = a.x - i, tz = a.z - j;
        const q = j * GRID + i;
        const gy = ((h.y[q] as number) * (1 - tx) + (h.y[q + 1] as number) * tx) * (1 - tz) + ((h.y[q + GRID] as number) * (1 - tx) + (h.y[q + GRID + 1] as number) * tx) * tz;
        const y = swims ? (name === 'cardume' ? 0.02 : 0.06) : flies ? gy + 7 : gy;
        const lx = a.x + origin.x, lz = a.z + origin.z;
        const wx = place[0] + place[2] * lx + place[3] * lz, wz = place[1] - place[3] * lx + place[2] * lz;
        const turn = Math.atan2(place[3], place[2]);
        const pose = a.state === 4 ? 4 : a.state === 3 ? 3 : a.state === 1 ? (Math.floor(a.step * 5) % 2 === 0 ? 1 : 2) : 0;
        const id = this.mesh(a.species, pose);
        let b = this.buckets.get(id);
        if (!b) { b = { mesh: id, data: new Float32Array(ANIMAL_FLOATS * 16), count: 0 }; this.buckets.set(id, b); }
        if ((b.count + 1) * ANIMAL_FLOATS > b.data.length) { const n = new Float32Array(b.data.length * 2); n.set(b.data); b.data = n; }
        const o = b.count * ANIMAL_FLOATS;
        b.data[o] = wx; b.data[o + 1] = y; b.data[o + 2] = wz; b.data[o + 3] = a.yaw + turn; b.data[o + 4] = 1;
        b.count++;
        total++;
        if (!swims) {
          if ((blobs + 1) * ANIMAL_FLOATS > this.blobData.length) { const n = new Float32Array(this.blobData.length * 2); n.set(this.blobData); this.blobData = n; }
          const p = blobs * ANIMAL_FLOATS;
          this.blobData[p] = wx; this.blobData[p + 1] = gy; this.blobData[p + 2] = wz; this.blobData[p + 3] = 0; this.blobData[p + 4] = SIZE[name] ?? 0.5;
          blobs++;
        }
      }
    }
    this.count = total;
    this.renderer.batches = [...this.buckets.values()].filter((b) => b.count > 0);
    this.renderer.blobs = { data: this.blobData, count: blobs };
  }
}

/** Canto do pedaço, em coordenadas da face, a partir da chave (`chunkKey`); pedaço virtual usa o mesmo formato. */
function chunkOrigin(key: number): { x: number; z: number } {
  const base = key >= 100_000_000 ? key % 100_000_000 : key % 1_000_000;
  const cz = Math.floor(base / 512) - 256, cx = base % 512 - 256;
  return { x: cx * 32, z: cz * 32 };
}
