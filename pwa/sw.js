/* global self, caches, fetch, URL, Headers, Response, __PRECACHE__ */
/**
 * Service worker do Sandbox Mundo: guarda o jogo para abrir offline.
 * Este arquivo é um modelo: o build (vite.config.ts) preenche a versão e a lista de arquivos.
 * Cada versão publicada tem um cache próprio; o antigo é apagado ao ativar a nova.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
// Cache separado por endereço: o site principal e as prévias (/previa/...) não apagam o cache um do outro.
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = `sandbox-mundo:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;

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
      .then((keys) =>
        Promise.all(
          keys
            // Versões antigas deste mesmo endereço (e o formato antigo "sandbox-mundo-<versão>", só na raiz).
            .filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || (k.startsWith('sandbox-mundo-') && !SCOPE.includes('/previa/')))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Isolamento entre origens (correção 2): o GitHub Pages não deixa configurar cabeçalhos, então o
 * service worker os acrescenta às respostas do jogo. Com eles a página fica `crossOriginIsolated` e o
 * navegador libera a memória compartilhada (SharedArrayBuffer) entre a tela e os workers.
 * Respostas opacas (redirecionamento, erro de rede) passam como vieram.
 */
function isolated(response) {
  if (!response || response.status === 0 || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Página: tenta a rede (para pegar versão nova) e cai no cache se estiver offline.
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(new URL('index.html', self.registration.scope).href, { cacheName: CACHE }))
        .then(isolated),
    );
    return;
  }

  // Arquivos do jogo têm nome com hash: o que está no cache nunca fica velho.
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)).then(isolated));
});
