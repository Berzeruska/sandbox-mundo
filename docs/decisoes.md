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

- **2026-10-15 — T14: pincéis em forma de sino, teto macio e sombreado de relevo.**
  Diagnóstico: os dados já tinham queda do centro à borda; o "platô" vinha do teto duro (4 s de Elevar
  travavam o centro em 9.000 m, que virava gelo chapado), das cores em faixas por bioma e da falta de
  indicação de inclinação. Correção: queda `(1 − t²)³`, desaceleração nos últimos 6 km antes do
  teto/fundo e sombreado de relevo nas cores (luz de noroeste, inclinação em metros por célula
  calculada em 3D, sem emenda entre faces; vale para o planeta todo, inclusive montanhas naturais).
  Perfil de Elevar com pincel 29 por 4 s: antes 8.999 m no centro (teto) e 5.213 m no meio do raio;
  depois 6.799 m e 3.909 m, borda intacta. Imagem: `docs/img/t14-antes-depois.png`.
  Só visual e pincéis: a mesma semente continua gerando o mesmo mundo.

- **2026-10-15 — Linha de base de desempenho (v1.1), medida pelo usuário no celular dele.**
  Painel de depuração, "girar sem parar":
  | Situação              | mín. | média | máx.  |
  |-----------------------|------|-------|-------|
  | Globo inteiro         | 59   | 65–67 | 91    |
  | De perto, girando     | 55   | —     | 61–63 |
  Notebook (Radeon 610M, sem limite de tela, build de produção): globo inteiro 727 fps, zoom máximo
  619 fps em 1920×1080; 1.168 / 615 fps em tela de celular 412×915 @2x.
  **Regra:** ao fim de cada marco, medir de novo nas mesmas condições e comparar com esta tabela
  (registrar aqui). Meta mínima continua: ≥ 30 fps no celular, 60 no notebook.

- **2026-10-15 — Nenhum teste pode depender do relógio real.**
  O CI roda só o Vitest (`npm run check`), determinístico. As verificações no navegador (Playwright)
  são roteiros locais de conferência, fora do CI. A checagem de inércia do roteiro dependia do
  intervalo real entre eventos de toque emulados (janela de 80 ms) e falhava quando o navegador
  desenhava por software e ficava lento. Correção: a lógica virou função pura
  (`inertiaFromHistory` em `src/input/pointer.ts`) com teste determinístico de tempos sintéticos em
  `tests/input/pointer.test.ts`; a checagem dependente de relógio saiu do roteiro do navegador.
  O mesmo foi feito com a espera de 80 ms que separa pincelada de pinça (`PaintGate` em
  `src/input/paint-gate.ts`, teste em `tests/input/paint-gate.test.ts`).

- **2026-10-15 — Menu de ferramentas por categorias (M2, T1): layout aprovado pelo usuário.**
  Esboço: `docs/img/m2-t1-esboco-menu.png`. Decisões junto com a aprovação:
  - aba extra **"Mundo"** com Novo mundo e Dados (depuração); a **bússola fica no canto** da tela;
  - **sem** opção de mão esquerda (botões à direita, zona do polegar direito);
  - tocar no cartão da ferramenta ativa abre o menu **na categoria dela**.
  **Lembrete:** o acabamento visual do menu (ícones próprios, animações, estilo) fica para o
  **Marco 8 — Embelezamento**. Na T1 vale o layout e a usabilidade, não a beleza.

- **2026-10-15 — T1 do M2 feita: menu por categorias (`src/ui/menu-state.ts` + `src/ui/hud.ts`).**
  Área da tela coberta pela interface num celular 390×844: v1.1 = 24,3%; menu fechado = **8,8%**;
  menu aberto ≈ 50%, só enquanto aberto. O botão ☰ e o cartão abrem o menu na categoria da
  ferramenta ativa. Ferramentas de tarefas futuras ficam desativadas ("em breve"). A lógica do menu
  é pura e testada; a barra de espaço (pausa) e Esc (fecha o menu) funcionam no notebook.

- **2026-10-15 — Prévias de branch publicadas em `/previa/<branch>/` (workflow `preview.yml`).**
  Motivo: o usuário testa no celular por link antes do merge, sem mexer no `main`.
  Como funciona: um push num branch `marco-*` reconstrói o site principal a partir do `main`
  (igual ao que já está no ar) e coloca o build do branch em `/previa/<branch>/`, com etiqueta
  "PRÉVIA". O ambiente `github-pages` passou a aceitar deploy de `marco-*`. O cache offline é
  separado por endereço, para a prévia e o site principal não apagarem um ao outro.
  Limitação: o próximo deploy do `main` publica só o `main` e remove as prévias (voltam no próximo
  push do branch). Descartado: repositório separado para prévias (mais um repo e um token).

- **2026-10-15 — Ideias novas do usuário registradas nos marcos certos (sem implementar agora).**
  Recursos minerais e petróleo: geração no M2 (nova T6), uso nos M4/M7 (`03`, `05`, `06`).
  Quatro classes sociais: M5 (`05`). Feedback ambiental: base no M3, gatilhos humanos no M4/M7
  (`04`). Doutrinas de guerra ligadas a cultura, terreno e tecnologia: M6/M7 (`06`). Escala visual
  pequena de pessoas e cidades: M3/M4 e M8 (`00`). Resumo em `docs/02-marcos.md`.

- **2026-10-15 — T2 do M2: simulação no Web Worker.**
  O worker (`src/sim/worker.ts`) guarda o mundo, o relógio, a geração, o clima e os pincéis; a lógica
  fica em `SimulationCore` (`src/sim/core.ts`), testada sem worker. A thread principal guarda só uma
  cópia das cores, atualizada por **remendos** (retângulos alterados, buffers transferidos sem cópia).
  Pinceladas são agrupadas: enquanto o worker processa uma, as seguintes acumulam tempo e posição,
  sem formar fila. Sem `SharedArrayBuffer` (o GitHub Pages não permite os cabeçalhos exigidos).
  Medição (build de produção, Radeon 610M, tela de celular): gerar mundo novo leva ~1,65 s nos dois
  casos, mas o maior intervalo entre quadros caiu de **1.658 ms (tela congelada) para 17 ms**.
  Pincel 30 segurado: 60 fps (máx. 19 ms entre quadros). Mesma semente, mesmo mundo (teste).

- **2026-10-15 — fps "cravado em 60" na T2: não é limite do jogo.**
  O laço de desenho é só `requestAnimationFrame`, que segue a taxa que o navegador oferece. Sem limite
  de tela (notebook, build de produção), a T2 desenha 741–907 fps, no mesmo patamar da v1.1
  (948–1.097). No Android, quem escolhe 60/90/120 Hz é o sistema: economia de bateria e taxa
  adaptativa (muitos aparelhos só sobem com o dedo na tela) costumam derrubar para 60.
  Para comparar nas mesmas condições, o painel Dados agora mostra a taxa da tela (~Hz) e o menor e o
  maior intervalo entre quadros.

- **2026-10-15 — Tempo de geração no painel e barra de progresso.**
  Painel Dados: tempo total do pedido até o globo aparecer, tempo do worker e de cada etapa.
  Medido no notebook: 0,8–1,7 s (varia bastante entre rodadas), então ~3–5 s no celular, acima do
  limite de 2 s do usuário: a tela "Gerando mundo…" ganhou barra de progresso, que avança durante o
  terreno (a etapa pesada, ~65% do tempo). O ruído virou classe (`Noise3D`), o que ajuda o motor
  JavaScript a manter o código otimizado entre mundos; mundos idênticos aos da v1.1 (byte a byte).
  Próximo passo, se precisar: gerar o terreno em vários workers ao mesmo tempo (mesmo resultado,
  2–4× mais rápido em celulares com vários núcleos).

- **2026-10-15 — T3 do M2: placas tectônicas.**
  Voronoi com pesos e deformação de uma oitava (duas oitavas custavam ~2× sem diferença que se veja);
  distância de corda ao quadrado (sem `acos`) para escolher a placa. Placas continentais se afastam
  do centro do supercontinente. Fronteiras uniformizadas por voto da vizinhança (células isoladas de
  tipo diferente: ~5–10% → ~0,3%). Sorteio separado do terreno: relevo idêntico ao de antes.
  Custo: ~140 ms no notebook em ritmo normal (o processador deste notebook às vezes cai ~2,8× de
  velocidade com aquecimento: todas as etapas sobem juntas, inclusive as que não mudaram).

- **2026-10-15 — Medição do usuário na T3 (celular).**
  Geração: 2.373 ms total (2.355 no worker). fps 89–91, mínimo 71 (a tela agora sobe a 90 Hz, então
  o "cravado em 60" da T2 era escolha do aparelho). Pausar rápido enquanto gira derruba a 64–71 por
  instantes: registrado, sem correção por enquanto (investigar se voltar a incomodar).

- **2026-10-15 — "Placas se encontram no polo": sem viés, é geometria.**
  Medido em 300–1.500 sementes, por faixas de latitude de igual área (uniforme = 20% cada):
  centros das placas 19,7 / 20,3 / 19,7 / 20,8 / 19,5%; pontos triplos 19,6 / 20,7 / 20,0 / 20,2 /
  19,5% (equador → polo). Cada mundo tem ~16–20 pontos triplos e a região a menos de ~18° dos polos
  cobre 5% da esfera: a chance de ao menos um cair ali é ~60% (medido: 63%). A calota branca destaca
  as linhas. O sorteio das sementes já era uniforme na esfera (coordenada vertical uniforme, não a
  latitude). Efeito pequeno e esperado: sementes do mar pendem ~1,5 ponto para os polos porque
  precisam ficar longe das sementes da terra, e a Pangeia nasce em latitudes baixas e médias; não
  afeta centros nem pontos triplos. Teste de regressão: `tests/world/plates.test.ts`.

- **2026-10-15 — T4 do M2: movimento das placas por recomposição a partir do referencial da placa.**
  Cada placa guarda a crosta no próprio referencial (amostras + índice por placa e célula, ~22 MB no
  máximo de 14 placas); o mundo é recomposto quando alguma placa anda 1 célula. Motivo: copiar crosta
  de célula em célula a cada passo acumularia erro e deformaria os continentes.
  Descartado: avançar a crosta célula a célula no mapa global (deforma com o tempo).
  Ritmo: 6×10⁻⁶ rad/passo no máximo (≈ 9.000× a deriva real de ~5 cm/ano), com 20× e controle 100% a
  Pangeia se abre em ~2 min (decisão do usuário). Controle inicial 25%.
  Medição (notebook, processador em modo lento): recomposição com clima e cores ~530 ms, no worker;
  tela a 60 fps durante a deriva (p99 17 ms). No celular deve ficar ~1,5 s a cada ~5 s em 20× no
  máximo: o relógio segue. A T7 (clima que acompanha a deriva) vai recalcular só o que mudou.
