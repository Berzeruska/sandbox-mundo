# Firefox real, sem aparecer na tela

Roteiros que o Claude Code usou no fechamento do M3 para capturar e medir no Firefox do notebook, numa janela de 1920×1080 dentro de um compositor GNOME sem tela. São ferramentas de trabalho: o jogo não depende deles e o `npm run check` não os roda.

1. `./compositor.sh &` sobe o compositor em `wayland-9`. Depois: `ln -sfn ../wayland-9 /run/user/1000/snap.firefox/wayland-9` (o Firefox é snap).
2. `wd.mjs` é um cliente WebDriver mínimo sobre o `/snap/bin/geckodriver`, com `webgl.enable-privileged-extensions` ligado (relógio da GPU).
3. `shots.mjs <pasta> <lista.json>`: capturas da maquete. Precisa do servidor de desenvolvimento (`npx vite --port 5199`), porque usa `window.game` e importa módulos do `src/` (`page.js`). Cada item da lista: `{ "name", "kind", "arg", "px", "yaw", "skip" }`; `kind` é `biome`, `deposit`, `oil`, `high`, `volcano`, `ice`, `hills` ou `coast`.
4. `folhas.mjs <pasta> "folha=animais1" …`: as folhas de conferência de `prototipo/folhas.html`.
5. `bench.mjs <saida.txt>`: o "Medir desempenho" completo. Precisa de um build de produção com `window.game` exposto, servido em `:5299`: copie o repositório para fora dele, troque em `src/main.ts` o `if (import.meta.env.DEV)` por nada, rode `vite build` e `vite preview --port 5299`.

Cuidados (medidos nesta máquina): conferir `/sys/class/drm/card*/device/gpu_busy_percent` antes de medir; nesse compositor o ritmo de quadros não vale (ele não limita a 60 Hz), só os tempos de GPU e de trabalho da tela; se um roteiro cair, o Firefox de teste continua vivo e ocupa a GPU.
