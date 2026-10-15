/* global self, caches, fetch, URL, __PRECACHE__ */
/**
 * Service worker do Sandbox Mundo: guarda o jogo para abrir offline.
 * Este arquivo é um modelo: o build (vite.config.ts) preenche a versão e a lista de arquivos.
 * Cada versão publicada tem um cache próprio; o antigo é apagado ao ativar a nova.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `sandbox-mundo-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sandbox-mundo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Página: tenta a rede (para pegar versão nova) e cai no cache se estiver offline.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(new URL('index.html', self.registration.scope).href, { cacheName: CACHE }),
      ),
    );
    return;
  }

  // Arquivos do jogo têm nome com hash: o que está no cache nunca fica velho.
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
});
