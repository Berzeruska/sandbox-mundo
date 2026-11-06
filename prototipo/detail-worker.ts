import { buildChunk, type WorldData } from './detail';

/** Monta os pedaços da maquete fora da tela. Fila: sempre o pedido mais novo primeiro (o mais perto da câmera). */
let world: WorldData | null = null;
let generation = 0;
let queue: { cx: number; cz: number }[] = [];
let busy = false;

function pump(): void {
  if (busy) return;
  busy = true;
  setTimeout(() => {
    busy = false;
    const job = queue.shift();
    if (!job || !world) return;
    const c = buildChunk(world, job.cx, job.cz);
    const transfer: Transferable[] = [c.terrain.buffer as ArrayBuffer, c.sea.buffer as ArrayBuffer, c.corners.buffer as ArrayBuffer, c.walk.buffer as ArrayBuffer];
    for (const a of Object.values(c.instances)) transfer.push(a.buffer as ArrayBuffer);
    postMessage({ type: 'chunk', generation, chunk: c }, { transfer });
    if (queue.length) pump();
  }, 0);
}

onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'world'; world: WorldData; generation: number } | { type: 'want'; list: { cx: number; cz: number }[]; generation: number };
  generation = m.generation;
  if (m.type === 'world') {
    world = m.world;
    queue = [];
  } else {
    // Os pedidos novos (mais perto da câmera) vão na frente; os antigos continuam na fila.
    const seen = new Set(m.list.map((j) => `${j.cx},${j.cz}`));
    queue = [...m.list, ...queue.filter((j) => !seen.has(`${j.cx},${j.cz}`))];
    pump();
  }
};
