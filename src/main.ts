import { App } from './app';
import { GAME_NAME } from './core/version';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Elemento #app não encontrado');

document.title = GAME_NAME;

// Prévia de um branch (publicada em /previa/<branch>/): etiqueta fixa para não confundir com a oficial.
const previewLabel = (import.meta.env.VITE_PREVIEW as string | undefined)?.trim();
if (previewLabel) {
  const badge = document.createElement('div');
  badge.className = 'preview-badge';
  badge.textContent = `PRÉVIA ${previewLabel}`;
  root.append(badge);
  document.title = `${GAME_NAME} (prévia ${previewLabel})`;
}

// A geração roda no Web Worker: a página já abre e mostra "Gerando mundo…" sem travar.
const seed = new URLSearchParams(window.location.search).get('seed')?.trim() || 'pangeia';
const app = new App(root, seed);
app.start();
if (import.meta.env.DEV) (window as unknown as { game: App }).game = app;

// PWA: guarda o jogo para abrir offline (só no build publicado, não no servidor de desenvolvimento).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => console.warn('Service worker não registrado:', err));
  });
}
