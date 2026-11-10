// Funções injetadas na página (dev: window.game existe).
window.T = {
  async init() {
    const g = window.game;
    T.cs = await import('/src/world/cubesphere.ts');
    T.res = await import('/src/world/resources.ts');
    T.dep = await import('/src/maquete/deposits.ts');
    T.hash = await import('/src/maquete/hash.ts');
    const n = g.info.n;
    T.n = n;
    T.snap = await g.sim.maqueteSnapshot();
    T.colors = g.colors;
    return n;
  },
  point(c) {
    const n = T.n, face = Math.floor(c / (n * n)), rest = c % (n * n), x = rest % n, y = Math.floor(rest / n);
    const a = ((x + 0.5) / n) * 2 - 1, b = ((y + 0.5) / n) * 2 - 1;
    return T.cs.faceCoordToPoint(face, a, b);
  },
  // Acha a célula no meio da maior concentração do critério (janela de raio r na mesma face).
  find(kind, arg, r = 4, skip = 0) {
    const n = T.n, s = T.snap, col = T.colors;
    const ok = new Uint8Array(6 * n * n);
    for (let c = 0; c < ok.length; c++) {
      const biome = col[c * 4 + 3] & 15, h = s.height[c], dep = T.res.depositType(s.deposit[c]);
      let v = false;
      if (kind === 'biome') v = biome === arg && !s.ice[c];
      else if (kind === 'deposit') v = dep === arg && h > 0 && !s.ice[c] && !T.res.isHiddenOil(s.deposit[c]);
      else if (kind === 'oil') v = dep === T.res.Resource.Oil && h > 0 && !s.ice[c] && (!T.res.isHiddenOil(s.deposit[c]) || T.dep.surfaceOil(n, c)) && T.hash.hash3(c, 3, 79) <= 0.1;
      else if (kind === 'high') v = h > arg;
      else if (kind === 'volcano') v = s.volcano[c] >= arg && h > 200;
      else if (kind === 'ice') v = s.ice[c] && (arg ? h > 0 : h <= 0);
      else if (kind === 'coast') v = h > 0 && h < 60 && biome !== 3;
      else if (kind === 'hills') v = h > 250 && h < 1400 && (biome === 7 || biome === 11 || biome === 8);
      ok[c] = v ? 1 : 0;
    }
    const list = [];
    for (let f = 0; f < 6; f++) for (let y = r; y < n - r; y += 2) for (let x = r; x < n - r; x += 2) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sum += ok[f * n * n + (y + dy) * n + x + dx];
      if (sum > 0 && ok[f * n * n + y * n + x]) list.push([sum, f * n * n + y * n + x]);
    }
    list.sort((a, b) => b[0] - a[0]);
    const pick = list[Math.min(list.length - 1, skip * 40)];
    return pick ? { cell: pick[1], score: pick[0], total: list.length } : null;
  },
  async goto(c, px = 14, yawAdd = 0) {
    const g = window.game, cam = g.camera;
    if (cam.inMaquete) { cam.exit(); }
    cam.lookAt(T.point(c));
    cam.zoom = cam.maxZoom;
    g.requestDraw();
    for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 50)); if (cam.inMaquete) break; }
    if (!cam.inMaquete) return 'nao entrou';
    // px por célula fina
    const d = cam.height / (2 * px * Math.tan((25 * Math.PI) / 360));
    cam.zoomAt(cam.width / 2, cam.height / 2, cam.view.distance / d);
    cam.view.yaw += yawAdd;
    cam.refresh();
    for (let i = 0; i < 200; i++) { await new Promise((r) => setTimeout(r, 50)); if (g.maquete.pendingCount === 0 && g.maquete.arrived.length === 0 && g.maquete.inFlight === 0 && i > 20) break; }
    await new Promise((r) => setTimeout(r, 700));
    return 'ok ' + cam.view.distance.toFixed(0);
  },
};
