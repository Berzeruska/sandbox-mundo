import { App } from './app';
import { GAME_NAME } from './core/version';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Elemento #app não encontrado');

const canvas = document.createElement('canvas');
canvas.id = 'globe';
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Gerando mundo…';
root.append(canvas, loading);
document.title = GAME_NAME;

// Deixa a mensagem aparecer antes do trabalho pesado da geração.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      const app = new App(canvas, 'pangeia');
      loading.remove();
      app.start();
      if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
    } catch (err) {
      loading.textContent = `Erro: ${err instanceof Error ? err.message : String(err)}`;
      throw err;
    }
  }, 30),
);
