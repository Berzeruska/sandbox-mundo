/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Lista os arquivos de `public/` (copiados para o build como estão). */
function publicFiles(dir = 'public'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full) : [relative('public', full).split('\\').join('/')];
  });
}

/**
 * Gera o service worker no build, com a lista exata de arquivos para guardar offline.
 * Feito à mão (poucas linhas) para não depender do vite-plugin-pwa.
 */
function serviceWorker(): Plugin {
  return {
    name: 'sandbox-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // O index.html entra no pacote depois deste plugin, então vai na lista explicitamente.
      const all = ['./', 'index.html', ...Object.keys(bundle), ...publicFiles()];
      const files = [...new Set(all)].filter((f) => !f.endsWith('.map'));
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync('pwa/sw.js', 'utf8')
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(files)};`);
      if (source.includes('__PRECACHE__;') || source.includes("'__VERSION__'")) {
        this.error('Modelo do service worker não foi preenchido');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// `base: './'` faz o build funcionar tanto na raiz quanto em /sandbox-mundo/ (GitHub Pages).
export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
