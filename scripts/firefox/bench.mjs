// "Medir desempenho" completo no Firefox real, com o relógio da GPU (webgl.enable-privileged-extensions).
import { start } from './wd.mjs';
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const b = await start();
try {
  await b.go('http://localhost:5299/?seed=terra');
  for (let i = 0; i < 200; i++) { await b.sleep(250); if (await b.exec('return !!(window.game && window.game.info && window.game.renderer)')) break; }
  await b.sleep(3000);
  await b.exec('window.confirm = () => true; window.__done = false; window.game.runBenchmark().then(() => { window.__done = true; }, (e) => { window.__done = "ERR " + e; });');
  let text = '';
  for (let i = 0; i < 400; i++) {
    await b.sleep(3000);
    const r = await b.exec('return [window.__done, (document.querySelector("textarea") || {}).value || ""]');
    if (r[0]) { text = r[1] || String(r[0]); break; }
  }
  writeFileSync(out, text);
  console.log('ok', text.length);
} catch (e) { console.error(e); }
await b.quit();
