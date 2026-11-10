import { VertexOut } from '../maquete/chunk-build';
import { ANIMALS, animalModel, animalRig, POSES, SWIMMERS, type Animal } from '../maquete/animals';
import { SPECIES, SPECIES_COUNT, type SpeciesInfo } from '../world/species';
import { hash3 } from '../maquete/hash';
import { MODEL_FLOATS } from '../maquete/models';
import { ANIMAL_FLOATS, type InstanceBatch, type MaqueteRenderer } from './maquete-renderer';

/**
 * Os indivíduos da maquete (E5): cada pedaço mostra a população do bloco dele na ecologia (`src/world/ecology.ts`). Quem manda são os números: quando o número do bloco sobe,
 * nasce um filhote (pequeno, e cresce); quando desce, um morre. Se há caçador da espécie no pedaço, ele corre atrás da presa, ela foge, cai, e ele come ao lado.
 * O andar é contínuo: a perna balança em volta do quadril e o pescoço desce em volta da base, no desenho, sem quadros soltos (B2).
 * Sangue leve, de diorama (E8): uma mancha baixa e escura debaixo de quem foi caçado, que some com o corpo. Sem pedaços.
 */
interface Member {
  species: number;
  x: number;
  z: number;
  yaw: number;
  /** Para onde está virando. */
  heading: number;
  /** 0 parado, 1 andando, 2 fugindo, 3 comendo, 4 morto, 5 caçando. */
  state: number;
  until: number;
  seed: number;
  /** Fase do passo, intensidade do passo (0–1) e quanto o pescoço desceu (0–1). */
  phase: number;
  gait: number;
  bend: number;
  /** Quando nasceu e quando morreu (relógio do desenho, em segundos). */
  born: number;
  died: number;
  blood: boolean;
  /** Quem ele caça, ou de quem foge. */
  other: Member | null;
}
interface Herd { key: number; block: number; members: Member[]; y: Float32Array; mask: Uint8Array; nextSync: number; filled: boolean }
interface Rig { pivotX: number; pivotY: number; down: number; step: number }
export interface MythicView { id: number; species: number; x: number; z: number }
export interface AnimalHandle { herd: number; member: Member }

const GRID = 33;
const SIZE: Partial<Record<Animal, number>> = { elefante: 1.5, alce: 0.95, bisao: 0.95, urso: 0.8, camelo: 0.85, rena: 0.7, cervo: 0.7, zebra: 0.7, leao: 0.72, onca: 0.62, lobo: 0.55, loboArtico: 0.55, javali: 0.5, antilope: 0.55, cabra: 0.5, capivara: 0.42, macaco: 0.3, lebre: 0.25, jacare: 0.7, dragao: 2 };
const SPEED: Partial<Record<Animal, number>> = { elefante: 0.7, lebre: 1.1, jacare: 0.35, urso: 0.55, baleia: 0.9, cachalote: 0.9, aguia: 2.4 };
const GRAZERS = new Set<Animal>(['rena', 'lebre', 'cervo', 'alce', 'bisao', 'antilope', 'zebra', 'elefante', 'capivara', 'camelo', 'cabra', 'javali', 'macaco', 'urso']);
/** O corpo fica no chão por este tempo e some nos últimos segundos; o filhote leva este tempo para crescer. */
export const BODY_SECONDS = 26, FADE_SECONDS = 4, GROW_SECONDS = 8;
/** De quanto em quanto tempo o pedaço confere os números, e quantos indivíduos de uma espécie cabem nele. */
const SYNC_SECONDS = 1.4, MAX_LAND = 18, MAX_SEA = 5;
/** Um modelo de cardume já são nove peixes. */
const SCHOOL = 9;
const SIZE_TRAIT = 0, SPEED_TRAIT = 3, TRAIT_COUNT = 5;

/** Quantos indivíduos o pedaço mostra para um número do bloco: a fração vira um a mais em parte dos blocos, sempre os mesmos. */
export function shownCount(population: number, block: number, species: number, sea: boolean): number {
  const n = species === CARDUME ? population / SCHOOL : population;
  return Math.min(sea ? MAX_SEA : MAX_LAND, Math.floor(n + hash3(block, species, 911)));
}
const CARDUME = ANIMALS.indexOf('cardume');

export class AnimalHerds {
  private herds = new Map<number, Herd>();
  private meshIds = new Map<number, number>();
  private rigs = new Map<number, Rig>();
  private buckets = new Map<number, InstanceBatch>();
  private blobData = new Float32Array(ANIMAL_FLOATS * 256);
  private stainData = new Float32Array(ANIMAL_FLOATS * 64);
  private last = 0;
  private frozenFor = 0;
  private clock = 0;
  count = 0;
  /** Números da ecologia: indivíduos × 16 por espécie e bloco, e quantos blocos por lado de face. */
  private life: Uint16Array = new Uint16Array(0);
  private lifeBlocks = 0;
  private traits: Float32Array = new Float32Array(0);
  private mythics: MythicView[] = [];
  /** Modelos ainda por montar: um por quadro, antes de precisar, para não engasgar no corte. */
  private toPrepare: number[] = [];

  constructor(private renderer: MaqueteRenderer) {}

  setLife(life: Uint16Array, blocksPerSide: number): void { this.life = life; this.lifeBlocks = blocksPerSide; }
  setTraits(traits: Float32Array): void { this.traits = traits; }
  setMythics(list: MythicView[]): void {
    this.mythics = list;
    for (const m of list) this.want(m.species, 0);
  }

  private want(species: number, pose: number): void {
    const k = species * 8 + pose;
    if (!this.meshIds.has(k) && !this.toPrepare.includes(k)) this.toPrepare.push(k);
  }

  /** Pedaço novo na tela, com o bloco da ecologia que ele mostra; ou o chão dele refeito. */
  setChunk(key: number, block: number, y: Float32Array, mask: Uint8Array): void {
    const old = this.herds.get(key);
    if (old) { old.y = y; old.mask = mask; return; }
    this.herds.set(key, { key, block, members: [], y, mask, nextSync: 0, filled: false });
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

  private walkable(h: Herd, x: number, z: number, swims: boolean, flies: boolean): boolean {
    if (!(x > 0.4 && z > 0.4 && x < GRID - 1.4 && z < GRID - 1.4)) return false;
    if (flies) return true;
    const m = h.mask[Math.round(z) * GRID + Math.round(x)] as number;
    return swims ? m === 2 : m === 0;
  }

  /** Confere o pedaço com os números do bloco: nasce quem falta, morre quem sobra (um de cada vez, para dar tempo de ver). */
  private sync(h: Herd): void {
    const B = 6 * this.lifeBlocks * this.lifeBlocks, first = !h.filled;
    if (!B || h.block < 0 || h.block >= B) return;
    h.filled = true;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const info = SPECIES[s] as SpeciesInfo;
      if (info.mythic) continue;
      const name = ANIMALS[s] as Animal, swims = SWIMMERS.has(name), flies = name === 'aguia';
      const target = shownCount((this.life[s * B + h.block] as number) / 16, h.block, s, swims);
      const alive = h.members.filter((m) => m.species === s && m.state !== 4);
      if (alive.length < target) {
        const add = first ? target - alive.length : 1;
        for (let k = 0; k < add; k++) {
          const near = alive.length ? alive[Math.floor(hash3(h.key, this.clock * 7 + k, s) * alive.length)] as Member : null;
          for (let attempt = 0; attempt < 14; attempt++) {
            const r1 = hash3(h.key + k * 13, s * 31 + attempt, Math.floor(this.clock * 3) + 5), r2 = hash3(h.key + k * 17, s * 37 + attempt, Math.floor(this.clock * 3) + 9);
            const x = near ? near.x + (r1 - 0.5) * 5 : 1 + r1 * (GRID - 3), z = near ? near.z + (r2 - 0.5) * 5 : 1 + r2 * (GRID - 3);
            if (!this.walkable(h, x, z, swims, flies)) continue;
            const m: Member = { species: s, x, z, yaw: r1 * 6.283, heading: r1 * 6.283, state: 0, until: this.clock + r2 * 3, seed: r1 * 9973 + r2 * 31, phase: r2 * 6, gait: 0, bend: 0, born: first ? -1e9 : this.clock, died: 0, blood: false, other: null };
            h.members.push(m); alive.push(m);
            this.want(s, 0); this.want(s, 4);
            break;
          }
        }
      } else if (alive.length > target) {
        // Morre o que já não é perseguido; se há caçador dele no pedaço, a morte é uma caçada.
        const victim = alive.find((m) => m.other === null) ?? (alive[0] as Member);
        if (victim.state === 2 && victim.other) continue;
        const hunter = swims || flies ? undefined : h.members.find((m) => m.state !== 4 && m.state !== 5 && m.other === null && (SPECIES[m.species] as SpeciesInfo).prey.includes(info.id) && Math.hypot(m.x - victim.x, m.z - victim.z) < 26);
        if (hunter) { hunter.state = 5; hunter.other = victim; hunter.until = this.clock + 9; victim.state = 2; victim.other = hunter; victim.until = this.clock + 9; }
        else this.die(victim, false);
      }
    }
  }

  private die(m: Member, blood: boolean): void {
    m.state = 4; m.died = this.clock; m.blood = blood; m.other = null;
  }

  /** Indivíduo mais perto de um ponto do plano (para acompanhar com a câmera). */
  pick(wx: number, wz: number, radius: number): AnimalHandle | null {
    let best: AnimalHandle | null = null, bestD = radius;
    for (const h of this.herds.values()) {
      for (const m of h.members) {
        if (m.state === 4) continue;
        const p = this.worldOf(h, m);
        if (!p) break;
        const d = Math.hypot(p.x - wx, p.z - wz);
        if (d < bestD) { bestD = d; best = { herd: h.key, member: m }; }
      }
    }
    return best;
  }

  /** Onde o indivíduo está agora no plano; null se morreu ou o pedaço saiu da tela. */
  where(a: AnimalHandle): { x: number; z: number; species: number } | null {
    const h = this.herds.get(a.herd);
    if (!h || a.member.state === 4 || !h.members.includes(a.member)) return null;
    const p = this.worldOf(h, a.member);
    return p ? { ...p, species: a.member.species } : null;
  }

  private worldOf(h: Herd, m: Member): { x: number; z: number } | null {
    const place = this.renderer.placeOf(h.key);
    if (!place) return null;
    const origin = chunkOrigin(h.key), lx = m.x + origin.x, lz = m.z + origin.z;
    return { x: place[0] + place[2] * lx + place[3] * lz, z: place[1] - place[3] * lx + place[2] * lz };
  }

  private push(species: number, pose: number, x: number, y: number, z: number, yaw: number, scale: number, phase: number, bend: number): void {
    const id = this.mesh(species, pose);
    let b = this.buckets.get(id);
    if (!b) {
      const r = this.rigs.get(species) as Rig;
      b = { mesh: id, data: new Float32Array(ANIMAL_FLOATS * 16), count: 0, rig: [r.pivotX, r.pivotY, r.down, r.step] };
      this.buckets.set(id, b);
    }
    if ((b.count + 1) * ANIMAL_FLOATS > b.data.length) { const n = new Float32Array(b.data.length * 2); n.set(b.data); b.data = n; }
    const o = b.count * ANIMAL_FLOATS;
    b.data[o] = x; b.data[o + 1] = y; b.data[o + 2] = z; b.data[o + 3] = yaw; b.data[o + 4] = scale; b.data[o + 5] = phase; b.data[o + 6] = bend;
    b.count++;
  }

  update(time: number, paused: boolean, wind: readonly [number, number, number]): void {
    const dt = paused ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    if (paused) this.frozenFor += Math.max(0, time - this.last);
    this.last = time;
    const clock = time - this.frozenFor;
    this.clock = clock;
    for (const b of this.buckets.values()) b.count = 0;
    let blobs = 0, stains = 0, total = 0;
    const T = this.traits;
    for (const [key, h] of this.herds) {
      const place = this.renderer.placeOf(key);
      if (!place) continue;
      if (!paused && clock >= h.nextSync) { this.sync(h); h.nextSync = clock + SYNC_SECONDS * (0.8 + hash3(key, 3, 5) * 0.4); }
      const size = GRID - 1, origin = chunkOrigin(key), turn = Math.atan2(place[3], place[2]);
      let removed = false;
      for (const a of h.members) {
        const name = ANIMALS[a.species] as Animal, swims = SWIMMERS.has(name), flies = name === 'aguia';
        const speed = (SPEED[name] ?? 0.8) * (T.length ? (T[a.species * TRAIT_COUNT + SPEED_TRAIT] as number) : 1);
        let run = 1;
        if (a.state === 4) {
          if (clock - a.died > BODY_SECONDS) { removed = true; a.died = -1; continue; }
        } else if (a.state === 5 && a.other) {
          // Caçando: corre até a presa; quando alcança, ela cai e ele come ao lado.
          const v = a.other, d = Math.hypot(v.x - a.x, v.z - a.z);
          a.heading = Math.atan2(-(v.z - a.z), v.x - a.x);
          run = 2.4;
          if (d < 0.9 || clock > a.until || v.state === 4) {
            if (v.state !== 4) this.die(v, true);
            a.state = 3; a.other = null; a.until = clock + 7;
          }
        } else if (a.state === 2 && a.other) {
          // Fugindo de quem o caça.
          const p = a.other;
          a.heading = Math.atan2(a.z - p.z, a.x - p.x) + Math.sin(clock * 2 + a.seed) * 0.5;
          run = 1.9;
          if (p.state !== 5 || clock > a.until) { a.state = 0; a.other = null; }
        } else if (clock > a.until) {
          a.seed = hash3(Math.floor(a.seed) + 1, a.species, 7) * 99991;
          const r = (a.seed % 1000) / 1000;
          // Quem pasta passa boa parte do tempo comendo; quem se afasta do grupo volta.
          a.state = swims || flies ? 1 : GRAZERS.has(name) ? (r < 0.3 ? 1 : r < 0.72 ? 3 : 0) : r < 0.45 ? 1 : 0;
          a.until = clock + 2.5 + ((a.seed % 500) / 100);
          if (a.state === 1) a.heading = a.yaw + ((a.seed % 700) / 700 - 0.5) * 1.8;
        }
        const alive = a.state !== 4;
        if (alive) {
          const dy = Math.atan2(Math.sin(a.heading - a.yaw), Math.cos(a.heading - a.yaw));
          a.yaw += dy * Math.min(1, dt * (run > 1 ? 5 : 2.4));
          const moving = a.state === 1 || a.state === 2 || a.state === 5;
          a.gait += ((moving ? 1 : 0) - a.gait) * Math.min(1, dt * 5);
          a.bend += ((a.state === 3 ? 1 : 0) - a.bend) * Math.min(1, dt * 2.6);
          if (a.gait > 0.02 && dt > 0) {
            const v = speed * a.gait * run;
            a.phase += dt * (5 + 3 * speed) * (run > 1 ? 1.5 : 1);
            const nx = a.x + Math.cos(a.yaw) * v * dt, nz = a.z - Math.sin(a.yaw) * v * dt;
            if (this.walkable(h, nx, nz, swims, flies)) { a.x = nx; a.z = nz; } else a.heading = a.yaw + 2.2;
          }
          // Furacão: arrasta. Água por cima: leva e deita.
          if (!swims && !flies && wind[2] > 0.5 && dt > 0) {
            const c = place[2], s = place[3], lwx = c * wind[0] - s * wind[1], lwz = s * wind[0] + c * wind[1];
            a.x = Math.max(0.3, Math.min(size - 0.3, a.x + lwx * wind[2] * dt * 2.5));
            a.z = Math.max(0.3, Math.min(size - 0.3, a.z + lwz * wind[2] * dt * 2.5));
          }
          if (!swims && !flies && (h.mask[Math.round(a.z) * GRID + Math.round(a.x)] as number) === 3) this.die(a, false);
          if (flies && dt > 0) a.heading += dt * 0.5;
        }
        const i = Math.max(0, Math.min(GRID - 2, Math.floor(a.x))), j = Math.max(0, Math.min(GRID - 2, Math.floor(a.z))), tx = a.x - i, tz = a.z - j;
        const q = j * GRID + i;
        const gy = ((h.y[q] as number) * (1 - tx) + (h.y[q + 1] as number) * tx) * (1 - tz) + ((h.y[q + GRID] as number) * (1 - tx) + (h.y[q + GRID + 1] as number) * tx) * tz;
        const y = swims ? 0 : flies ? gy + 7 : gy;
        const lx = a.x + origin.x, lz = a.z + origin.z;
        const wx = place[0] + place[2] * lx + place[3] * lz, wz = place[1] - place[3] * lx + place[2] * lz;
        // Filhote nasce pequeno e cresce; o corpo some encolhendo nos últimos segundos.
        const grown = Math.min(1, 0.4 + 0.6 * (clock - a.born) / GROW_SECONDS);
        const fade = a.state === 4 ? Math.max(0, Math.min(1, (BODY_SECONDS - (clock - a.died)) / FADE_SECONDS)) : 1;
        const scale = grown * fade * (T.length ? (T[a.species * TRAIT_COUNT + SIZE_TRAIT] as number) : 1);
        const wobble = swims ? Math.sin(a.phase * 0.6) * 0.1 * a.gait : 0;
        // A perna vai voltando ao centro quando o bicho para: sin(x) = intensidade × sin(fase).
        this.push(a.species, a.state === 4 ? 4 : 0, wx, y, wz, a.yaw + wobble + turn, scale, Math.asin(Math.min(1, a.gait) * Math.sin(a.phase)), a.bend);
        total++;
        const reach = (SIZE[name] ?? 0.5) * scale;
        if (!swims) {
          if ((blobs + 1) * ANIMAL_FLOATS > this.blobData.length) { const n = new Float32Array(this.blobData.length * 2); n.set(this.blobData); this.blobData = n; }
          const p = blobs * ANIMAL_FLOATS;
          this.blobData[p] = wx; this.blobData[p + 1] = gy; this.blobData[p + 2] = wz; this.blobData[p + 3] = 0; this.blobData[p + 4] = reach;
          blobs++;
        }
        if (a.state === 4 && a.blood && !swims) {
          if ((stains + 1) * ANIMAL_FLOATS > this.stainData.length) { const n = new Float32Array(this.stainData.length * 2); n.set(this.stainData); this.stainData = n; }
          const p = stains * ANIMAL_FLOATS;
          // A mancha abre devagar e fica menor que o corpo.
          this.stainData[p] = wx + 0.15; this.stainData[p + 1] = gy + 0.01; this.stainData[p + 2] = wz + 0.1; this.stainData[p + 3] = 0; this.stainData[p + 4] = reach * 0.8 * Math.min(1, (clock - a.died) / 3) * fade;
          stains++;
        }
      }
      if (removed) h.members = h.members.filter((m) => m.died !== -1);
    }
    // Classe mítica: indivíduos de verdade, postos por deus; rondam o lugar onde a simulação diz que estão.
    for (const m of this.mythics) {
      const name = ANIMALS[m.species] as Animal, fly = name === 'dragao', t = clock * (fly ? 0.22 : 0.12) + m.id * 2.1, r = fly ? 9 : 5;
      this.push(m.species, 0, m.x + Math.cos(t) * r, fly ? 9 : 0, m.z + Math.sin(t) * r, -t - 1.5708, 1, Math.sin(clock * 3 + m.id), 0);
      total++;
    }
    this.count = total;
    this.renderer.blobs = { data: this.blobData, count: blobs };
    this.renderer.stains = { data: this.stainData, count: stains };
  }

  list(): InstanceBatch[] { return [...this.buckets.values()].filter((b) => b.count > 0); }
}

/** Canto do pedaço, em coordenadas da face, a partir da chave (`chunkKey`); pedaço virtual usa o mesmo formato. */
function chunkOrigin(key: number): { x: number; z: number } {
  const base = key >= 100_000_000 ? key % 100_000_000 : key % 1_000_000;
  const cz = Math.floor(base / 512) - 256, cx = base % 512 - 256;
  return { x: cx * 32, z: cz * 32 };
}
