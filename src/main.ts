import { App, setSeedInUrl } from './app';
import { GAME_NAME } from './core/version';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Elemento #app não encontrado');

const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Gerando mundo…';
root.append(loading);
document.title = GAME_NAME;

// Deixa a mensagem aparecer antes do trabalho pesado da geração.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      const seed = new URLSearchParams(window.location.search).get('seed')?.trim() || 'pangeia';
      const app = new App(root, seed);
      setSeedInUrl(seed);
      loading.remove();
      app.start();
      if (import.meta.env.DEV) (window as unknown as { game: App }).game = app;
    } catch (err) {
      loading.textContent = `Erro: ${err instanceof Error ? err.message : String(err)}`;
      throw err;
    }
  }, 30),
);

// PWA: guarda o jogo para abrir offline (só no build publicado, não no servidor de desenvolvimento).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => console.warn('Service worker não registrado:', err));
  });
}
