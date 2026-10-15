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

- **2026-10-14 — Entrada por Pointer Events num módulo só (`src/input/pointer.ts`).**
  Motivo: Pointer Events tratam mouse, toque e caneta com o mesmo código; separar em `touch.ts` e
  `mouse.ts` (como previa a arquitetura) duplicaria a lógica de giro e zoom.

- **2026-10-14 — Giro livre do globo (quatérnio), com botão "norte para cima".**
  Motivo: o ponto sob o dedo segue o dedo em qualquer lugar, inclusive em cima dos polos, sem
  travar. Como o giro livre pode inclinar o norte, há um botão para endireitar.
  Descartado: guinada/arfagem com limite nos polos (trava ao passar por cima do polo).

- **2026-10-14 — Relógio de passo fixo: 1 passo = 1 mês; 1× = 1 ano por segundo.**
  Velocidades 2×, 5×, 20× multiplicam os passos; "máximo" roda quantos passos couberem em 8 ms por
  quadro (teto de 600). Motivo: resultado da simulação não depende do fps do aparelho.
  Escala provisória: reavaliar no M2, quando a geologia começar a usar os passos.

- **2026-10-14 — Ruído com tabela de gradientes e tabela do vento sob demanda.**
  Motivo: a abertura do jogo caiu de ~2,6 s para ~0,7 s no notebook (o celular é ~3× mais lento).
  Os mundos gerados continuam idênticos para a mesma semente (conferido byte a byte).

- **2026-10-14 — Semente na URL (`?seed=...`).**
  Motivo: um link reproduz exatamente o mesmo mundo, o que ajuda a relatar bugs.

- **2026-10-14 — `@types/node` (só tipos, ~2,5 MB no disco, 0 bytes no jogo).**
  Motivo: o `vite.config.ts` usa `node:fs`/`node:crypto` para gerar o service worker. Fica num
  `tsconfig.node.json` separado para os tipos do Node não vazarem no código do navegador.

- **2026-10-14 — Service worker gerado por um plugin próprio de ~30 linhas no `vite.config.ts`.**
  Motivo: lista exata dos arquivos do build para abrir offline, sem dependência nova.
  Descartado: `vite-plugin-pwa` (traz o Workbox inteiro para algo que cabe em poucas linhas).
