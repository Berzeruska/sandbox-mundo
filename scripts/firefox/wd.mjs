// Cliente WebDriver mínimo para o Firefox real (geckodriver), em janela Wayland no compositor sem tela.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const PORT = Number(process.env.GD_PORT ?? 4477);
const base = `http://127.0.0.1:${PORT}`;
async function rq(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message);
  return j.value;
}
export async function start({ w = 1920, h = 1080, prefs = {} } = {}) {
  const root = process.env.HOME + '/snap/firefox/common/wdprof';
  mkdirSync(root, { recursive: true });
  const env = { ...process.env, WAYLAND_DISPLAY: 'wayland-9', MOZ_ENABLE_WAYLAND: '1', DISPLAY: '' };
  delete env.DISPLAY;
  const gd = spawn('/snap/bin/geckodriver', ['--port', String(PORT), '--profile-root', root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  gd.stdout.on('data', (d) => (log += d));
  gd.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/status'); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const s = await rq('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
      args: ['--width=' + w, '--height=' + h],
      prefs: { 'webgl.enable-privileged-extensions': true, 'dom.webgpu.enabled': false, 'browser.shell.checkDefaultBrowser': false, 'datareporting.policy.dataSubmissionEnabled': false, 'full-screen-api.ignore-widgets': false, 'full-screen-api.warning.timeout': 0, 'full-screen-api.approval-required': false, 'full-screen-api.allow-trusted-requests-only': false, ...prefs },
    } } },
  });
  const id = s.sessionId;
  const S = '/session/' + id;
  const api = {
    log: () => log,
    go: (url) => rq('POST', S + '/url', { url }),
    exec: (script, args = []) => rq('POST', S + '/execute/sync', { script, args }),
    async: (script, args = []) => rq('POST', S + '/execute/async', { script, args }),
    timeouts: (t) => rq('POST', S + '/timeouts', t),
    rect: (r) => rq('POST', S + '/window/rect', r),
    fullscreen: () => rq('POST', S + '/window/fullscreen', {}),
    actions: (actions) => rq('POST', S + '/actions', { actions }),
    release: () => rq('DELETE', S + '/actions'),
    async shot(file) { const b = await rq('GET', S + '/screenshot'); writeFileSync(file, Buffer.from(b, 'base64')); },
    async key(k, ms = 0) {
      await api.actions([{ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: k }, { type: 'pause', duration: ms }, { type: 'keyUp', value: k }] }]);
    },
    async click(x, y) {
      await api.actions([{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x, y, duration: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 40 }, { type: 'pointerUp', button: 0 }] }]);
    },
    async wheel(x, y, dy, n = 1) {
      for (let i = 0; i < n; i++) await api.actions([{ type: 'wheel', id: 'w', actions: [{ type: 'scroll', x, y, deltaX: 0, deltaY: dy, duration: 0 }] }]);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async quit() { try { await rq('DELETE', S); } catch {} gd.kill(); },
  };
  await api.timeouts({ script: 280000, pageLoad: 120000 });
  return api;
}
