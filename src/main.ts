import { GAME_NAME, MILESTONE } from './core/version';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado');

const title = document.createElement('h1');
title.textContent = GAME_NAME;
const version = document.createElement('div');
version.className = 'version';
version.textContent = MILESTONE;
app.append(title, version);
