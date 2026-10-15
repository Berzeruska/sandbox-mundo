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

- **2026-10-14 — T12, medição no notebook (parcial; falta o celular do usuário).**
  Notebook do usuário, GPU integrada AMD Radeon 610M, Chrome, 1280×800: **60 fps** com o globo
  girando sem parar, tanto inteiro quanto no zoom máximo (célula de 48 px); JavaScript gasta
  ~0,2 ms por quadro. Geração do mundo: ~0,6 s. Pincel máximo (raio 30): ~3–5 ms por aplicação.
  Resolução mantida em N = 256.

- **2026-10-15 — T12 concluída: celular do usuário a 68–91 fps.**
  Medido pelo usuário com o "girar sem parar" do painel de depuração (acima de 60 porque a tela do
  aparelho tem taxa de atualização alta). Meta de ≥ 30 fps atendida com folga: **N = 256 mantido**,
  nenhuma redução de resolução necessária.

- **2026-10-15 — Projeção cubo→esfera verificada: já é a equiangular (desde a T2), mantida.**
  Medição em N = 256 (`cellShape` em `src/world/cubesphere.ts`, teste em `tests/world/cubesphere.test.ts`):
  | Projeção            | Área maior/menor | Pior desvio de ângulo |
  |---------------------|------------------|------------------------|
  | gnomônica simples   | 5,155            | 30,0° (células do canto do cubo) |
  | equiangular (atual) | 1,410            | 30,0° (células do canto do cubo) |
  O "losango" perto dos cantos do cubo não depende da projeção: num canto se encontram 3 faces, então
  3 células dividem um vértice e precisam ter ângulos de ~120° (nenhuma projeção de cubo evita).
  Os polos ficam no centro das faces ±Y, com desvio 0°. Solução visual: esconder a grade no shader
  (T13). Nenhuma mudança na geração: **a mesma semente continua gerando o mesmo mundo.**

- **2026-10-15 — T13: detalhe visual no shader para esconder a grade (sem mudar a simulação).**
  - Bordas orgânicas: o shader desloca o ponto da esfera com ruído (até ~1 célula) antes de escolher a
    célula; fronteiras de bioma, costas e calotas viram curvas. Ruído em 3D na esfera, sem emenda.
  - Textura sutil por bioma (intensidade em `BIOME_INFO.detail`; o bioma vai no canal alfa).
  - Removida a variação de brilho por célula da CPU (ela desenhava a grade).
  - Os dois efeitos somem com o zoom afastado (célula < ~1–2 px), para não cintilar.
  - Ruído lido de uma textura 3D pré-calculada (64³ RGBA, ~1 MB), não calculado por pixel: a
    primeira versão com hash por pixel custava ~3 ms por quadro a mais no notebook.
  - fps sem limite de tela (Radeon 610M, build de produção, giro de teste):
    | Cenário                      | Antes (v1.0) | Hash por pixel | Final (textura 3D) |
    |------------------------------|--------------|----------------|--------------------|
    | Notebook 1920×1080, inteiro  | 935          | 251            | 734                |
    | Notebook 1920×1080, zoom máx | 525          | 271            | 646                |
    | Celular 412×915 @2x, inteiro | 997          | 663            | 1175               |
    | Celular 412×915 @2x, zoom máx| 596          | 439            | 680                |
    (variações de ±20% entre execuções são ruído da medição.) Imagem: `docs/img/t13-antes-depois.png`.
  - A mesma semente continua gerando o mesmo mundo (nenhuma mudança na simulação).
