// Uso: node shots.mjs <saida-dir> <json de capturas>
// captura: { name, seed, kind, arg, px, yaw, skip, query, pre }
import { start } from './wd.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2], shots = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const base = process.env.GAME_URL ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });
const page = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const b = await start();
try {
  let cur = '';
  for (const s of shots) {
    const url = base + '?seed=' + (s.seed ?? 'terra') + (s.query ? '&' + s.query : '');
    if (url !== cur) {
      await b.go(url);
      cur = url;
      for (let i = 0; i < 200; i++) { await b.sleep(250); if (await b.exec('return !!(window.game && window.game.info && window.game.renderer)')) break; }
      await b.sleep(1500);
      await b.exec(page);
      await b.async('const done = arguments[arguments.length-1]; T.init().then(done)');
      await b.exec('window.game.setSpeed(0)');
    }
    if (s.pre) { await b.async('const done = arguments[arguments.length-1]; (async()=>{' + s.pre + '})().then(done, e=>done("ERR "+e))'); await b.exec(page.replace('window.T = {', 'Object.assign(window.T, {').replace(/};\s*$/, '});')); await b.async('const done = arguments[arguments.length-1]; T.init().then(done)'); }
    const f = s.cell != null ? { cell: s.cell } : await b.exec('return T.find(arguments[0], arguments[1], arguments[2], arguments[3])', [s.kind, s.arg ?? 0, s.r ?? 4, s.skip ?? 0]);
    if (!f) { console.log(s.name, 'NAO ACHOU'); continue; }
    const r = await b.async('const done = arguments[arguments.length-1]; T.goto(arguments[0], arguments[1], arguments[2]).then(done, e=>done("ERR "+e))', [f.cell, s.px ?? 14, s.yaw ?? 0]);
    if (s.hideUi !== false) await b.exec("document.querySelectorAll('.hud, .toasts').forEach(e=>e.style.visibility='hidden')");
    await b.sleep(300);
    await b.shot(`${out}/${s.name}.png`);
    console.log(s.name, JSON.stringify(f), r);
  }
} catch (e) { console.error('ERRO', e); console.error(b.log().slice(-1500)); }
await b.quit();
