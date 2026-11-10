import { start } from './wd.mjs';
const out = process.argv[2], pages = process.argv.slice(3);
const b = await start();
try {
  for (const p of pages) {
    await b.go('http://localhost:5199/prototipo/folhas.html?' + p);
    await b.sleep(2500);
    await b.shot(`${out}/folha-${p.replace(/[^a-z0-9]+/gi, '-')}.png`);
    console.log(p);
  }
} catch (e) { console.error(e); }
await b.quit();
