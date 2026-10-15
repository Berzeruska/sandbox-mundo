# Registro de decisões

Formato: data — decisão — motivo — alternativa descartada.

- **2026-10-14 — Jogo de navegador (TypeScript + Vite), sem engine.**
  Motivo: mesmo código no celular e no notebook, teste por link, ciclo rápido com IA.
  Descartado: Godot agora. Reavaliar no Marco 6–7 se o desempenho de combate com muitas unidades
  bater no teto.

- **2026-10-14 — Planeta em cube-sphere (6 faces N×N).**
  Motivo: polos sem distorção e editáveis; células de tamanho parecido no globo todo.
  Descartado: grade latitude × longitude (polos viram fatias finas e distorcidas).

- **2026-10-14 — Zoom contínuo em projeção ortográfica, sem troca de modo globo/mapa.**
  Motivo: o globo aproximado já preenche a tela; um único estado, nada a sincronizar.
  Descartado: alternar entre globo e mapa plano.

- **2026-10-14 — Render em WebGL2 (shader) em vez de Canvas 2D por pixel.**
  Motivo: desenhar a esfera pixel a pixel em Canvas 2D é pesado no celular; o shader faz isso de graça.
  Canvas 2D continua para interface e marcações sobrepostas.

- **2026-10-14 — Revolução é evento, não etapa obrigatória.**
  Motivo: fidelidade histórica (girondinos/jacobinos surgem ao derrubar uma monarquia).

- **2026-10-14 — Velocidade das placas é controlada pelo jogador, inclusive zero.**
  Motivo: decisão de design do usuário.

- **2026-10-14 — Dois níveis de simulação (agregado longe, individual perto) a partir do Marco 3.**
  Motivo: mundo vasto no celular sem abrir mão de ver cada indivíduo de perto.

- **2026-10-14 — Dependências de desenvolvimento do Marco 0.**
  `vite` (servidor e build), `typescript`, `vitest` (testes), `eslint` + `@eslint/js` +
  `typescript-eslint` (lint). Todas só de desenvolvimento: nada disso vai para o jogo publicado
  (o build atual pesa ~1 kB de JS). Já previstas na pilha de `01-arquitetura.md`.
  Descartado: Jest (mais lento e precisa de configuração extra para TypeScript/ESM).

- **2026-10-14 — Lint proíbe `Math.random()`.**
  Motivo: garantir a regra de determinismo automaticamente; o `npm run check` falha se alguém usar.

- **2026-10-14 — Build com caminhos relativos (`base: './'`).**
  Motivo: o mesmo build funciona no GitHub Pages (`/sandbox-mundo/`) e em qualquer outra pasta.
