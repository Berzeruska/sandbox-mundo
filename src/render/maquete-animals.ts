import { VertexOut } from '../maquete/chunk-build';
import { ANIMALS, animalModel, animalRig, POSES, SWIMMERS, type Animal } from '../maquete/animals';
import { hash3 } from '../maquete/hash';
import { MODEL_FLOATS } from '../maquete/models';
import { ANIMAL_FLOATS, type InstanceBatch, type MaqueteRenderer } from './maquete-renderer';

/**
 * Animais ao acaso (só desenho; a ecologia vem no bloco seguinte). O andar é contínuo: a perna balança em volta do quadril e o pescoço desce em volta da base, no desenho,
 * sem quadros soltos (B2). Em grupo por espécie: parados, andando juntos e comendo (D2).
 */
interface Member {
  species: number;
  x: number;
  z: number;
  yaw: number;
  /** Para onde está virando. */
  heading: number;
  /** 0 parado, 1 andando, 3 comendo, 4 morto. */
  state: number;
  until: number;
  seed: number;
  /** Fase do passo, intensidade do passo (0–1) e quanto o pescoço desceu (0–1). */
  phase: number;
  gait: number;
  bend: number;
}
interface Herd { members: Member[]; y: Float32Array; mask: Uint8Array; cx: number; cz: number }
interface Rig { pivotX: number; pivotY: number; down: number; step: number }

const GRID = 33;
const SIZE: Partial<Record<Animal, number>> = { elefante: 1.5, alce: 0.95, bisao: 0.95, urso: 0.8, camelo: 0.85, rena: 0.7, cervo: 0.7, zebra: 0.7, leao: 0.72, onca: 0.62, lobo: 0.55, loboArtico: 0.55, javali: 0.5, antilope: 0.55, cabra: 0.5, capivara: 0.42, macaco: 0.3, lebre: 0.25, jacare: 0.7, dragao: 2 };
const SPEED: Partial<Record<Animal, number>> = { elefante: 0.7, lebre: 1.1, jacare: 0.35, urso: 0.55, baleia: 0.9, cachalote: 0.9, aguia: 2.4 };
const GRAZERS = new Set<Animal>(['rena', 'lebre', 'cervo', 'alce', 'bisao', 'antilope', 'zebra', 'elefante', 'capivara', 'camelo', 'cabra', 'javali', 'macaco', 'urso']);

export class AnimalHerds {
  private herds = new Map<number, Herd>();
  private meshIds = new Map<number, number>();
  private rigs = new Map<number, Rig>();
  private buckets = new Map<number, InstanceBatch>();
  private blobData = new Float32Array(ANIMAL_FLOATS * 256);
  private last = 0;
  count = 0;
  /** Modelos ainda por montar: um por quadro, antes de precisar, para não engasgar no corte. */
  private toPrepare: number[] = [];

  constructor(private renderer: MaqueteRenderer) {}

  setChunk(key: number, animals: Float32Array, y: Float32Array, mask: Uint8Array): void {
    const old = this.herds.get(key);
    if (old) { old.y = y; old.mask = mask; return; }
    const members: Member[] = [];
    let cx = 0, cz = 0, n = 0;
    for (let o = 0; o + 4 <= animals.length; o += 4) {
      const seed = animals[o + 3] as number, sp = animals[o] as number;
      for (const pose of [0, 4]) if (!this.meshIds.has(sp * 8 + pose) && !this.toPrepare.includes(sp * 8 + pose)) this.toPrepare.push(sp * 8 + pose);
      const yaw = seed * 6.283;
      members.push({ species: sp, x: animals[o + 1] as number, z: animals[o + 2] as number, yaw, heading: yaw, state: seed < 0.02 ? 4 : 0, until: seed * 3, seed: seed * 9973, phase: seed * 6, gait: 0, bend: 0 });
      cx += animals[o + 1] as number; cz += animals[o + 2] as number; n++;
    }
    this.herds.set(key, { members, y, mask, cx: n ? cx / n : 16, cz: n ? cz / n : 16 });
  }

  removeChunk(key: number): void { this.herds.delete(key); }

  /** Monta um modelo que vai ser preciso. */
  prepareOne(): void {
    const k = this.toPrepare.pop();
    if (k !== undefined) this.mesh(Math.floor(k / 8), k % 8);
  }

  /** Vértice do animal: quanto balança (perna) ou quanto segue o pescoço. Regras de altura e posição, sem esqueleto. */
  private bake(model: Float32Array, a: Animal, pose: number): ArrayBuffer {
    const out = new VertexOut(model.length / MODEL_FLOATS), rig = animalRig(a), rigged = pose === 0 && rig.top > 0;
    for (let o = 0; o < model.length; o += MODEL_FLOATS) {
      const x = model[o] as number, y = model[o + 1] as number, z = model[o + 2] as number;
      let mask = 0;
      if (rigged) {
        if (y < rig.top) mask = (x > 0 === z > 0 ? 1 : -1) * 0.5 * (1 - y / rig.top);
        else if (x > rig.x - 0.04) mask = 0.5 + 0.5 * Math.min(0.99, (x - rig.x + 0.04) / 0.26);
      }
      out.push(x, y, z, model[o + 3] as number, model[o + 4] as number, model[o + 5] as number, mask, model[o + 6] as number, model[o + 7] as number, model[o + 8] as number, model[o + 9] as number);
    }
    return out.bytes();
  }

  private mesh(species: number, pose: number): number {
    const key = species * 8 + pose;
    let id = this.meshIds.get(key);
    if (id === undefined) {
      const a = ANIMALS[species] as Animal;
      id = this.renderer.addMesh(this.bake(animalModel(a, POSES[pose] as (typeof POSES)[number]), a, pose));
      this.meshIds.set(key, id);
      if (!this.rigs.has(species)) {
        const r = animalRig(a);
        this.rigs.set(species, r.top > 0 ? { pivotX: r.x, pivotY: r.y, down: 1.25, step: r.top * 0.7 } : { pivotX: 0, pivotY: 0, down: 0, step: 0 });
      }
    }
    return id;
  }

  update(time: number, paused: boolean, wind: readonly [number, number, number]): void {
    const dt = paused ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    if (paused) this.frozenFor += Math.max(0, time - this.last);
    this.last = time;
    const clock = time - this.frozenFor;
    for (const b of this.buckets.values()) b.count = 0;
    let blobs = 0, total = 0;
    for (const [key, h] of this.herds) {
      const place = this.renderer.placeOf(key);
      if (!place) continue;
      const size = GRID - 1, origin = chunkOrigin(key), turn = Math.atan2(place[3], place[2]);
      for (const a of h.members) {
        const name = ANIMALS[a.species] as Animal, swims = SWIMMERS.has(name), flies = name === 'aguia';
        const speed = SPEED[name] ?? 0.8;
        if (a.state !== 4 && clock > a.until) {
          a.seed = hash3(Math.floor(a.seed) + 1, a.species, 7) * 99991;
          const r = (a.seed % 1000) / 1000;
          // Quem pasta passa boa parte do tempo comendo; o grupo volta a se juntar quando se afasta.
          a.state = swims || flies ? 1 : GRAZERS.has(name) ? (r < 0.3 ? 1 : r < 0.72 ? 3 : 0) : r < 0.45 ? 1 : 0;
          a.until = clock + 2.5 + ((a.seed % 500) / 100);
          if (a.state === 1) {
            const away = Math.hypot(a.x - h.cx, a.z - h.cz);
            a.heading = away > 6 ? Math.atan2(-(h.cz - a.z), h.cx - a.x) : a.yaw + ((a.seed % 700) / 700 - 0.5) * 1.8;
          }
        }
        // Vira aos poucos, em vez de virar de uma vez.
        const dy = Math.atan2(Math.sin(a.heading - a.yaw), Math.cos(a.heading - a.yaw));
        a.yaw += dy * Math.min(1, dt * 2.4);
        const walking = a.state === 1;
        a.gait += ((walking ? 1 : 0) - a.gait) * Math.min(1, dt * 5);
        a.bend += ((a.state === 3 ? 1 : 0) - a.bend) * Math.min(1, dt * 2.6);
        if (a.gait > 0.02 && dt > 0) {
          const v = speed * a.gait;
          a.phase += dt * (5 + 3 * speed);
          const nx = a.x + Math.cos(a.yaw) * v * dt, nz = a.z - Math.sin(a.yaw) * v * dt;
          const inside = nx > 0.3 && nz > 0.3 && nx < size - 0.3 && nz < size - 0.3;
          const m = inside ? (h.mask[Math.round(nz) * GRID + Math.round(nx)] as number) : 9;
          if (flies ? inside : swims ? m === 2 : m === 0) { a.x = nx; a.z = nz; } else a.heading = a.yaw + 2.2;
        }
        // Furacão: arrasta. Água por cima: leva e deita.
        if (!swims && !flies && wind[2] > 0.5 && dt > 0) {
          const c = place[2], s = place[3], lwx = c * wind[0] - s * wind[1], lwz = s * wind[0] + c * wind[1];
          a.x = Math.max(0.3, Math.min(size - 0.3, a.x + lwx * wind[2] * dt * 2.5));
          a.z = Math.max(0.3, Math.min(size - 0.3, a.z + lwz * wind[2] * dt * 2.5));
        }
        if (!swims && !flies && a.state !== 4 && (h.mask[Math.round(a.z) * GRID + Math.round(a.x)] as number) === 3) a.state = 4;
        if (flies && dt > 0) a.heading += dt * 0.5;
        const i = Math.max(0, Math.min(GRID - 2, Math.floor(a.x))), j = Math.max(0, Math.min(GRID - 2, Math.floor(a.z))), tx = a.x - i, tz = a.z - j;
        const q = j * GRID + i;
        const gy = ((h.y[q] as number) * (1 - tx) + (h.y[q + 1] as number) * tx) * (1 - tz) + ((h.y[q + GRID] as number) * (1 - tx) + (h.y[q + GRID + 1] as number) * tx) * tz;
        const y = swims ? 0 : flies ? gy + 7 : gy;
        const lx = a.x + origin.x, lz = a.z + origin.z;
        const wx = place[0] + place[2] * lx + place[3] * lz, wz = place[1] - place[3] * lx + place[2] * lz;
        const pose = a.state === 4 ? 4 : 0;
        const id = this.mesh(a.species, pose);
        let b = this.buckets.get(id);
        if (!b) {
          const r = this.rigs.get(a.species) as Rig;
          b = { mesh: id, data: new Float32Array(ANIMAL_FLOATS * 16), count: 0, rig: [r.pivotX, r.pivotY, r.down, r.step] };
          this.buckets.set(id, b);
        }
        if ((b.count + 1) * ANIMAL_FLOATS > b.data.length) { const n = new Float32Array(b.data.length * 2); n.set(b.data); b.data = n; }
        const o = b.count * ANIMAL_FLOATS;
        const wobble = swims ? Math.sin(a.phase * 0.6) * 0.1 * a.gait : 0;
        b.data[o] = wx; b.data[o + 1] = y; b.data[o + 2] = wz; b.data[o + 3] = a.yaw + wobble + turn; b.data[o + 4] = 1;
        // A perna vai voltando ao centro quando o bicho para: sin(x) = intensidade × sin(fase).
        b.data[o + 5] = Math.asin(a.gait * Math.sin(a.phase));
        b.data[o + 6] = a.bend;
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
    this.renderer.blobs = { data: this.blobData, count: blobs };
  }

  private frozenFor = 0;

  list(): InstanceBatch[] { return [...this.buckets.values()].filter((b) => b.count > 0); }
}

/** Canto do pedaço, em coordenadas da face, a partir da chave (`chunkKey`); pedaço virtual usa o mesmo formato. */
function chunkOrigin(key: number): { x: number; z: number } {
  const base = key >= 100_000_000 ? key % 100_000_000 : key % 1_000_000;
  const cz = Math.floor(base / 512) - 256, cx = base % 512 - 256;
  return { x: cx * 32, z: cz * 32 };
}
