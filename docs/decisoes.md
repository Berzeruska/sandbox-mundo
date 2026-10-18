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

- **2026-10-15 — Movimento suave das placas no desenho (pedido do usuário: "nenhum salto visível").**
  O shader interpola a rotação rígida de cada placa entre recomposições: cada pixel descobre a placa
  (busca entre a placa que estava ali e as vizinhas, com tolerância de ~0,7 célula ao arredondamento
  da textura) e desfaz a rotação dela desde a composição. Fenda onde as placas se afastam aparece
  como fundo oceânico novo; sem afastamento, fica com a placa de antes (mesma regra da recomposição).
  Ruído de borda e textura de detalhe ficam presos à placa. Na chegada de cada recomposição, 350 ms
  de transição misturando a composição anterior e a nova (as bordas sempre diferem ~1 célula, porque
  a textura já é arredondada por célula e a recomposição lê o referencial da placa).
  O worker manda a textura de placas (placa, crosta continental, "perto de fronteira") e os ângulos;
  o App adianta o ângulo entre mensagens do worker (no máximo 0,3 s, nunca para trás).
  Medição quadro a quadro (leitura de pixels a 60 fps, placas em 100%, tempo 20×): antes, 7 saltos
  em 40 s com 17–21% da região mudando de uma vez; depois, 2.252 quadros, mediana 0,11% e máximo
  0,75% por quadro, **zero** quadros com mais de 2%.
  Custo de GPU: ~30–40% a mais só enquanto as placas andam (atalho para o miolo das placas: longe
  de fronteira só pode ser a própria placa); parado, no patamar da T3.

- **2026-10-15 — Regressão de geração no celular (2,4 → ~6 s): memória da tectônica.**
  No notebook a T4 custava só +50–70 ms; o que pesava no celular era memória: índice denso de
  placas × células (~22 MB) mais o mundo antigo vivo durante a geração do novo. Correção: índice só
  das amostras novas (as iniciais valem por identidade), mundo antigo solto antes de gerar e
  tectônica montada no primeiro passo. Notebook: mesmo tempo da T3. Painel Dados mostra a memória
  estimada do worker (~35 MB + tabelas) e o tempo por etapa.

- **2026-10-15 — Resolução continua N = 256 até o Marco 3** (decisão do usuário). A escala do
  planeta versus humanos é questão aberta da especificação do M3.

- **2026-10-15 — Formas dos continentes (critério de "bonito" do usuário) e T5 (relevo).**
  Antes (T4, 5 sementes, 2 min a 20× no máximo): 1–4 continentes, o maior com 46–100% da terra,
  riftes como canais estreitos. Causas: poucas placas na Pangeia (3–5), direções parecidas entre
  vizinhas, fronteiras em arcos lisos, contorno de bolota. Depois: 5–7 continentes, o maior com
  23–37%. Mudanças: placas por crescimento de regiões com custo por ruído; 5–8 sementes na terra e
  teto de 35% da terra por placa; expansão radial da Pangeia (todo par de vizinhas se afasta);
  deriva ~2,3× mais rápida com recomposição a cada 2 células; cicatrização só de buracos isolados;
  geração v2 (ruído costeiro + bacias internas); relevo da T5. Tentativa descartada: repulsão entre
  placas continentais (pedaços se reencontravam depois de 2 min).
  Imagens: `docs/img/m2-formas-antes.png`, `docs/img/m2-formas-depois.png`.

- **2026-10-15 — Relógio do desenho próprio e raio de busca da composição anterior.**
  Com o relevo, cada recomposição ocupa o worker por mais tempo e o relógio parava de chegar; o
  desenho passou a ter um relógio próprio que segue o ritmo nominal e corrige aos poucos, sem voltar
  nem saltar (`advanceDisplayTick`). Na transição, a composição anterior usa o próprio raio de busca
  (antes usava o da nova, ~5× menor, e errava as bordas no primeiro quadro). Medido de novo: zero
  quadros com salto (máximo 0,47% dos pixels por quadro) com placas em 100% e tempo 20×.

- **2026-10-15 — Erros sempre visíveis, desenho de reserva e conferência de versão.**
  Todo erro (worker, shader, tela) vira uma tela com o texto e "Tentar de novo"; um vigia de 20 s
  cobre o caso de silêncio. O globo tem dois shaders: o completo (interpolação das placas) e um
  simplificado de reserva, escolhido sozinho se o completo não compilar. Worker e tela trocam a
  versão do build (`__BUILD_ID__`, o hash do commit no CI) e recarregam uma vez se diferirem.
  Alternativa descartada: só mostrar o erro, sem reserva (o jogo ficaria inutilizável num celular
  com driver defeituoso).

- **2026-10-15 — Sem desfoque nos painéis; worker dorme pausado; relógio à tela até 10×/s (D2).**
  O 1º relatório do aparelho-alvo mostrou 91 fps com tempo rodando e o painel escondido, e o worker
  0% ocupado: a queda para 48 que o usuário via não vinha do worker. O painel Dados (onde ele lê o
  fps) tinha `backdrop-filter: blur`, que a GPU refaz sobre o globo a cada mudança na tela. Painéis
  passam a ter fundo quase opaco. O laço do worker só roda com mundo e tempo correndo, e o relógio vai
  à tela no máximo a cada 100 ms (o desenho das placas já adianta os ângulos sozinho entre mensagens).
  Alternativa descartada: manter o desfoque só fora da deriva (complica e não resolve tempo rodando).

- **2026-10-15 — Placas com identidade fixa: polaridade por par, solda e pedaços (D3).**
  Medido em 2 min de deriva no máximo (3 sementes, N = 128): ~10% das trocas de dono de célula eram
  A→B→A, quase todas em fronteiras oceano–oceano, porque quem mergulhava era decidido célula a célula
  e a crosta inicial tem toda a mesma idade. Agora a polaridade é do par de placas (decidida uma vez).
  Continentes que colidem por 8 recomposições se soldam (giram juntos); pedaço solto < 0,4% do planeta
  passa para a vizinha. Trocas A→B→A: 2.276/1.591/1.949 → 457/207/227 (o resto é arredondamento de
  1 célula). Critério de "bonito" segue valendo (4–7 continentes, nenhum > 40%, nas 5 sementes aos
  2 min; "mundo" ficou em 4 continentes com o maior em 40% — no limite, porque continentes que se
  encontram agora ficam juntos). Consequência de design a decidir depois: sem rifte, com o tempo os
  continentes tendem a se juntar (ciclo de supercontinente). "Tamanho fixo" ao pé da letra não é
  possível com placas rígidas cobrindo a esfera (dorsais fazem crescer, subducção encolhe); o que
  ficou fixo é a identidade e a forma: nada de placas comendo umas às outras alternadamente.

- **2026-10-15 — Resultado da rodada de desempenho no aparelho-alvo (Infinix Hot 50i, Mali-G52).**
  Relatório do botão "Medir desempenho" (versão 5d83bca), rodado pelo usuário: tempo 20× com placas
  paradas 91 fps; placas em 100% 82 fps (mínimo 66, pior quadro 44 ms); geração 2,7 s do pedido ao
  globo. Bate as metas (tempo rodando ≥ 60; deriva ≥ 30, nunca abaixo de 20; geração ≤ 3 s). O
  usuário encerrou aqui as otimizações de shader. Entraram depois disso, já prontas e verificadas:
  painéis sem desfoque, worker dormindo pausado e relógio até 10×/s (D2), e o shader de deriva com
  candidatas guardadas na textura de placas, atan por polinômio e texturas reaproveitadas a cada
  recomposição (D4: no notebook, o custo de GPU somado pela deriva caiu de 0,33 para 0,19 ms por
  quadro; pior quadro 3,69 → 3,24 ms). As quedas a 5–10 fps vistas jogando vinham das colisões sem
  fim (ver D3) e do desfoque atrás do painel Dados.

- **2026-10-15 — Solda só entre continentes; lasca pequena gruda na placa maior (acreção).**
  Contar qualquer frente de colisão na solda acabava com a moagem sem fim, mas soldava placas quase só
  oceânicas a continentes logo na abertura da Pangeia (na semente "mundo", o maior continente ia a 57%
  da terra aos 2 min). Agora a solda exige ≥ 1,5% do planeta em crosta continental nas duas placas;
  senão a lasca continental do lado pequeno passa para a outra placa. Junto: histerese nas
  sobreposições sem aproximação e preenchimento dos "dentes" de arredondamento na frente das placas.
  Alternativa descartada: exigir frente mínima para soldar (deixava lascas moendo para sempre).

- **2026-10-15 (noite) — Ciclo de Wilson, prioridades do Bloco G e desempenho só no aparelho (usuário).**
  Depois de testar a `d36c156b` no celular (oscilação resolvida), o usuário decidiu:
  1. **Ciclo de Wilson:** o supercontinente se forma, fica um tempo e racha de novo, de preferência
     pelas suturas antigas. A solda deixa de ser permanente.
  2. **Riftes inspirados na Terra:** nascem em junções tríplices, às vezes com um braço que falha e
     vira vale interior; costas que se encaixam dos dois lados; margens recortadas;
     microcontinentes de vez em quando. Continua valendo o critério de 4 a 7 continentes variados,
     com penínsulas, golfos e mares internos, e nenhum com mais de ~40% da terra.
  3. **Latitude sem tendência:** a latitude média da terra deve flutuar sem ir para os polos, com
     teste automático de 10 min simulados.
  4. **Prioridade:** G1 (latitude, provável bug), depois G2 (ciclo), depois G3 (formas).
     Diagnóstico medido e especificação aprovados antes de codar.
  5. **Desempenho:** só vale medido no Hot 50i.

  Diagnóstico (Bloco G em `M2-especificacao.md`): o movimento já é rotação rígida em torno de um polo
  de Euler, e as costuras do cubo não criam nem perdem crosta (medido). A ida aos polos vem de três
  coisas juntas: os eixos iniciais em "balão" (grandes círculos que saem do centro da Pangeia e passam
  pelos polos quando ela está no equador), os eixos que nunca mudam e a solda permanente e transitiva,
  que congela a terra no meio da dispersão. A deriva morre porque todas as placas continentais acabam
  num grupo só, entre 6 e 10 min nas 5 sementes.

  Alternativa descartada: só limitar a latitude à força (empurrar a terra de volta para os trópicos).
  Esconderia a causa e não tem base física.

- **2026-10-15 — G1: suturas, estágios com polo novo e guarda polar.**
  - **Solda:** só com aproximação de verdade (≥ 0,05 de velocidade relativa) e com contato
    continental (até 2 células). O contador de colisão desce sem frente. A sutura some depois de 3
    recomposições sem contato.
  - **Estágios:** a cada estágio (30–45° de giro a velocidade 1; o primeiro, a dispersão da Pangeia,
    20–25° ≈ 2 min), cada grupo ganha polo novo. O rumo vira até ±60°, e a velocidade é 0,4–1,0, mais
    lenta com muito continente.
  - **Guarda polar a 65°**, inclusive na dispersão inicial, onde o desvio é escolhido sem sorteio novo
    para não mudar o resto da geração.
  - **Defeito antigo corrigido:** crosta consumida só morre se não aparece em outra célula.
  - **Teste de formas aos 3 min**, com o critério do usuário (4–7, ≤ 40%). Antes era aos 2 min, com
    folga de 8 e 45%.
  - **Motivo:** o diagnóstico do Bloco G (balão + eixos fixos + solda permanente e transitiva) e as
    medições em N = 128 e N = 256 (tabela em `M2-especificacao.md`, "G1 — Resultado").
  - **Alternativas descartadas:**
    - Rumo totalmente aleatório a cada estágio: zigue-zague sem física.
    - Guarda só no fim do estágio: a trajetória cruzava o polo e voltava.
    - Guarda pelo centro da placa inteira: inclui oceano, e a terra da placa passava do limite.
    - Primeiro estágio de 30–45°: com a guarda desviando mais, a `terra` ficava com um continente de
      48% aos 2 min.

- **2026-10-15 — Menu e painel Dados compactos (pedido do usuário).**
  No celular, o menu cobria ~48% da altura da tela e o painel Dados ~44%. Agora:
  - **Menu:** botões de baixo com 52 px (eram 64), abas com 42 px (eram 58) e ferramentas com
    40 px, com o ícone ao lado do nome (eram 70 px, com o ícone em cima). Em telas com até 420 px de
    largura são 3 colunas, para os nomes caberem sem corte. O menu fica entre ~30% e 35% da tela.
  - **Painel Dados:** 7 linhas curtas (eram 14) em fonte de 10 px, e os dois botões pequenos numa
    linha só. Fica em ~20% da tela.

  Alternativa descartada: menu em gaveta lateral (mudaria a navegação aprovada na T1).

- **2026-10-16 — G2: ciclo de Wilson.**
  - **Fases:** dispersão de 50° (~4,3 min) → reunião de até 65° (~5,6 min), rumo a um ponto a
    20–40° do último supercontinente e a até 35° de latitude → supercontinente (≥ 70% do continente
    num grupo soldado, quase parado) por um mandato de 23° × 0,8–1,25 → ruptura.
  - **Ruptura:** 1 a 3 suturas; as mais antigas e os pedaços mais equilibrados, nenhum com ≥ 70%.
    Cada pedaço gira em torno do polo que abre a fenda continental (oposto da soma de p × n). Entre
    os sorteios, fica o que passa na guarda polar e menos empurra os vizinhos.
  - **Regra secundária:** um bloco com ≥ 35% racha no fim de uma reunião sem supercontinente.
  - **Motivo:** decisões do usuário (ciclo de Wilson; ~2 min de supercontinente; ciclo de 8–12 min;
    tempos em constantes).
  - **Calibração:** com 60%, dois blocos grandes que se encostavam já "eram" supercontinente e o
    ciclo caía para ~3 min. Com 75%, algumas sementes não formavam nenhum em 20 min. Com reunião de
    50°, faltava tempo. A dispersão de 35° dava ciclos de 6–7 min.
  - **Alternativas descartadas:**
    - Pedaços "para longe do centro da fenda": numa fenda curva, parte fechava e soldava de novo.
    - Ponto de reunião a 90° (ortoversão): a 11,6°/min no máximo, não cabe num ciclo de 8–12 min.
    - Não reconhecer supercontinente durante a dispersão: o grupo único durava 4,5 min na `42`.
  - **Teste de oscilação:** recomposições logo após uma troca de polo têm teto de 0,5%. Inverter o
    rumo devolve as células recém-tomadas; é um evento único.

- **2026-10-16 — Fluxo: o Project de orientação lê os docs direto do GitHub (regra do usuário).**
  - **Decisão:** o usuário discute cada relato com um Project do claude.ai que lê os docs no branch
    mais recente do marco atual. Ao fim de cada tarefa, commit e push nesse branch, com
    `docs/estado-atual.md` atualizado. Todo conhecimento que importa fica no git.
  - **Motivo:** os dois lados (Claude Code e orientador) trabalham sobre os mesmos fatos, sem cópia
    manual.
  - **Alternativa descartada:** pasta local `project-conhecimento/` com script de cópia e upload
    manual dos arquivos para o Project (removida; dependia de o usuário lembrar de subir).

- **2026-10-16 — Plano de 3 ajudantes (workers) do M2 ao M7 e teto de 150 MB (decisão do usuário).**
  - **Decisão:** thread principal + ajudante 1 "relógio" + ajudante 2 "Terra" (M2) + ajudante 3 "vida
    e sociedade" (M3); detalhes em `docs/01-arquitetura.md`. Dados do jogo ≤ 150 MB de RAM no Hot 50i
    (4 GB), medido no fim de cada marco.
  - **Motivo:** só 2 núcleos fortes; trabalho grande e raro sai do relógio para o tempo não parar, e
    pode rodar num núcleo fraco.
  - **Alternativa descartada:** um ajudante por sistema (mais memória, sem núcleo forte livre).

- **2026-10-16 — Tempo travando com placas no máximo: recomposição no ajudante 2 com memória
  compartilhada; recomposição mais barata depois (decisão do usuário).**
  - **Decisão:** opção (b) completa com SharedArrayBuffer. Primeira tarefa: testar no celular se a
    memória compartilhada funciona (isolamento entre origens pelo service worker). Se não funcionar,
    perguntar antes de seguir com cópia. A opção (a) entra depois, como complemento.
  - **Motivo:** o tempo não para enquanto o celular acompanhar, e o ajudante 2 serve aos marcos
    seguintes. Compartilhar evita copiar o mundo (+45–48 MB → ~+15–20 MB, estimativa).
  - **Alternativas descartadas:** (b) mínima (ainda para ~0,3–0,4 s e seria jogada fora); só (a)
    (a data ainda para ~0,5 s).

- **2026-10-16 — Rifte que para de abrir fica como vale em terra (decisão do usuário, correção 1).**
  - **Decisão:** fenda entre dois continentes nasce como vale de rifte (300–800 m abaixo das bordas);
    com 3 células de largura, o meio vira dorsal. Se parar de abrir antes disso, o vale fica (aulacógeno).
  - **Motivo:** o morro pintado numa fronteira não ganha mais um rasgo de fundo oceânico; é o que a
    Terra faz (riftes abortados).
  - **Consequência aceita:** istmos de vale ligam continentes; os testes de formas de `terra` e `mundo`
    aos 3 min viram falha conhecida até o fim do G3, com o critério intacto.
  - **Alternativas descartadas:** vale sempre abaixo do mar (volta o corte no morro); vale parado vira
    mar com o tempo (regra nova).

- **2026-10-16 — Teste por bloco, não por tarefa (regra do usuário, vale para os próximos marcos).**
  - **Decisão:** o Claude Code segue de tarefa em tarefa (commit, push e `estado-atual.md` a cada uma)
    e só para no fim de cada bloco, com a prévia e uma lista numerada do que testar no celular, tarefa
    por tarefa (o que fazer, o que deve aparecer, o que seria defeito, e o "Medir desempenho"). Blocos
    do M2: G (correção 2, G3, G4); minerais e clima (T6, T7); desastres (T8–T12); final (T13, T14).
  - **Paradas obrigatórias no meio do bloco:** decisão de design; teste de portão; meta de desempenho
    quebrada na estimativa no notebook.
  - **Motivo:** menos idas e vindas; o usuário testa um conjunto que faz sentido junto.
  - **Alternativa descartada:** parar a cada tarefa com mudança visível (regra de 2026-10-15).

- **2026-10-16 — Recomposição aparece 480 passos depois de feita (correção 2).**
  - **Decisão:** o motor da geologia anda nos mesmos passos do relógio e a recomposição feita no passo T
    aparece no passo T + 480 (40 anos; 2 s a 20×). O relógio nunca fica mais de 480 passos à frente do
    motor (espera se precisar). Pinceladas vão ao motor como "placa + ponto do referencial"; as feitas
    na janela valem de novo quando a recomposição aparece.
  - **Motivo:** determinístico (não depende de quanto o aparelho demora) e o tempo não para enquanto o
    ajudante acompanhar; 480 passos cabem numa recomposição de ~1–1,3 s num núcleo forte do Hot 50i e
    mantêm o deslize do desenho em ~3 células, dentro do alcance do shader (3,5).
  - **Alternativas descartadas:** aplicar quando o ajudante terminar (o mundo dependeria da velocidade
    do aparelho); recompor mais vezes com menos deslize (dobra o trabalho do ajudante).

- **2026-10-16 — G3: riftes traçados por busca de caminho; geração v3; rifte que abre como zíper.**
  - **Decisão:** toda fenda continental (na quebra da Pangeia, já na geração, e em toda ruptura) é
    traçada célula a célula (`src/world/rifts.ts`), com junção tríplice, braço que falha (aulacógeno),
    terceiro braço que corta um pedaço, microcontinente e margem passiva igual dos dois lados. Onde a
    fenda já virou mar, o mar avança pelo vale que ainda liga as margens enquanto as placas se afastam.
  - **Motivo:** costas que se encaixam com dentes e degraus, em vez de cortes retos de Voronoi; e o fim
    dos istmos de vale que ligavam continentes (falha conhecida da correção 1).
  - **Detalhes decididos no caminho:** placa com mais de 35% da terra é cortada na geração;
    microcontinente anda com a média das duas placas da fenda (com metade da velocidade da placa-mãe,
    era engolido de volta); a primeira dispersão fica como no G1 (a regra das seguintes não melhorou
    as formas: 11 contra 12 de 20 sementes).
  - **Alternativas descartadas:** deformar a fronteira antiga com ruído (não traça braços novos dentro
    de uma placa); votação por componente para dividir os lados (uma brecha entre braços passava um
    pedaço inteiro para o vizinho).
  - **Custo:** geração +67 ms de mediana no notebook (~+0,2 s no celular, ~2,9–3,0 s no total).

- **2026-10-16 — G4: montanha na placa de cima; planalto sem limite extra (se a medida confirmar).**
  - **Decisão do usuário:** a crosta consumida na colisão vira montanha toda na placa que fica por
    cima (como o Himalaia). O planalto não ganha limite extra se a colisão terminar sozinha na solda num
    tamanho realista (estimativa: 300–470 km de cordilheira, menor que o Himalaia–Tibete com ~1.000 km);
    se passar disso na medida, limite baseado no Tibete.
  - **Pedido junto:** relevo variado com base no mundo real (proposta na especificação, versão 2).
  - **Registro de método:** mecanismo novo com efeito de jogo, mesmo para fazer um critério passar,
    é decisão de design: perguntar antes (o "rifte que abre como zíper" do G3 foi feito sem perguntar;
    o usuário aprovou depois).

- **2026-10-16 — Erosão mais lenta (decisão do usuário, G4).**
  - **Decisão:** erosão de 0,5% (antes 3,5%) do que passa de 2.500 m e alisamento de 3% (antes 25%)
    acima de 1.200 m, por recomposição.
  - **Motivo:** com os valores antigos a cordilheira de colisão sumia ~1 min depois de a colisão parar
    (na solda) e quase nada ficava acima de 4.000 m aos 10 min. Agora 4 de 5 sementes ficam no alvo
    do mundo real (2.000 / 4.000 / 6.000 m); a `7` é falha conhecida.
  - **Alternativas descartadas:** colisão que continua empurrando depois da solda (regra de placas,
    mais risco); deixar como estava até a T7.

- **2026-10-16 — Direção geral do usuário: o mundo real é a base, não uma cópia exata.**
  O que precisar mudar para o jogo funcionar bem pode mudar, desde que o usuário decida as mudanças com
  efeito de jogo.


- **2026-10-16 — Geração de volta abaixo de 3 s (decisão do usuário: correções técnicas, mesmo mundo).**
  - **Mundo novo larga o velho na hora:** o ajudante 2 é encerrado (mesmo no meio de uma recomposição)
    e um **ajudante reserva**, já carregado e vazio, assume. Motivo do reserva: um worker criado pelo
    relógio só termina de carregar quando o relógio fica livre; criado na hora do mundo novo, nunca
    ajudava na geração.
  - **Terreno dividido entre o relógio e o ajudante** (`src/world/cell-pool.ts`): a primeira passada
    do terreno (16 ruídos por célula) vai em pedaços de 4.096 células, que os dois pegam de um contador
    em memória compartilhada; cada célula é calculada pela mesma função, então o mundo é idêntico
    (26 mundos conferidos byte a byte, N = 128 e 256). Se o ajudante sumir, o relógio refaz os
    pedaços dele depois de 10 s.
  - **Limiar da fração de terra sem ordenar tudo** (seleção rápida, mesmo valor exato).
  - **Medido (notebook, Chromium preso a 3 núcleos, geração logo depois da deriva):** mediana 903 ms,
    contra 893 da versão que deu 2,7 s no celular (antes destas correções, +30%). O relatório mostra
    "ajudante fez X% do terreno".
  - **Descartado:** cortar o custo da etapa "placas" do G3 (tudo espalhado em pedaços de 5–20 ms; o
    ganho que sobrava com mesmo resultado era pequeno).

- **2026-10-16 — Meta de "pausado" medida girando; "desenhados X de Y" (decisão do usuário).**
  Pausado e parado, o jogo não desenha nada e o fps é o ritmo que o aparelho dá a uma página parada
  (o Android baixa a taxa da tela). A meta de pausado (≥ 85) vale para "pausado, girando".

- **2026-10-16 — Registro de travadas sempre ligado (pedido do usuário).** Painel Dados e relatório:
  quadro da tela acima de 100 ms e data parada acima de 300 ms com o tempo correndo, com a hora, a
  duração, a causa provável (tela aplicando recomposição, desenho, relógio esperando o ajudante,
  relógio aplicando recomposição, fora do jogo) e a velocidade/placas. Lógica pura em `src/ui/stalls.ts`.

- **2026-10-16 — Vista de perto: células quadradas (pedido do usuário; aparência a aprovar no celular).**
  De longe nada muda (bordas orgânicas, globo redondo). Entre 6 e 14 px por célula, as bordas
  orgânicas e a textura manchada somem aos poucos e entram: cor 25% mais saturada, variação leve por
  célula (±4% na terra, ±1,5% na água), contorno fino onde o bioma muda (não entre os dois tons de
  oceano) e sombra na água junto da terra. Só desenho: a simulação não muda.
  - **Custo (notebook, sem limite de fps):** igual de longe e no zoom máximo; 10–15% mais lento no
    meio do caminho (as duas aparências juntas na transição).
  - **Limite conhecido:** perto dos 8 cantos do cubo as células são losangos, e na aresta entre duas
    faces não há contorno.

- **2026-10-16 — Registros do teste do Bloco G (decisões do usuário).**
  - Semente `42` com terra demais perto dos polos (33% acima de 60° em N = 256): **falha conhecida**.
  - Critério de formas mantido; pedacinhos de terra no oceano depois de colisões: aceitável.
  - Polos (duas manchas brancas que não interagem com as placas e não parecem gelo), neve demais (vale
    do rifte e todas as montanhas) e biomas pouco variados: **T7**.
  - O Hot 50i continua como aparelho-alvo; no fim do M2, com o relatório, o usuário decide se mantém.

- **2026-10-17 — Sem lixo de memória nos caminhos quentes da recomposição (técnica).** O ajudante 2
  criava ~117 MB de objetos temporários por recomposição (N = 256). Regras para código que roda em
  todas as células a cada recomposição ou passo: nada de vetor `[x, y, z]` temporário, nada de lista
  zerada com `length = 0` a cada célula (use array tipado e contador), nada de objeto de parâmetros por
  célula, e não passar números com vírgula soltos a funções que podem não ser embutidas (use
  `pointToCellOf(vetor)` ou passe a célula). Arrays do tamanho do mundo usados só durante a conta ficam
  guardados e são reaproveitados. Resultado: ~20 MB por recomposição, 24% mais rápida, mesmo mundo.
  - **Guarda:** `tests/sim/geology-golden.test.ts` (impressão digital do motor da geologia depois de 40
    recomposições). Otimização não pode mudar o mundo; se o teste falhar sem mudança de regra de
    propósito, a otimização errou.
  - **Descartado:** reescrever as funções grandes (`recompose`, `relief`) em pedaços menores só para o
    otimizador do navegador; o que sobrou (~20 MB) está espalhado e cada corte daria pouco.

- **2026-10-17 — Toque no globo desliga o giro de teste (correção de bug).** O "Girar (fps)" do painel
  Dados para no primeiro toque, como a inércia. Com ele ligado, segurar o pincel desenhava uma listra.

- **2026-10-17 — Registro de travadas: "fora do código da tela" e "recomposição há X s".** O nome
  antigo ("fora do jogo") sugeria que o jogo não tinha culpa. Quer dizer só que a tela não estava no
  código dela: pode ser GPU, outro trabalho no mesmo núcleo, limpeza de memória (inclusive a provocada
  pelo ajudante) ou o sistema. O tempo desde a última recomposição mostra se as travadas coincidem com
  ela.

- **2026-10-17 — Vista de perto alisada: o planeta não fica "cubado" (decisão do usuário: "dá um jeito
  de alisar e manter funcional").** De perto, cada ponto olha as 4 células em volta do canto de célula
  mais perto (também do outro lado de uma emenda do cubo) e mostra o bioma com mais peso somado (peso
  pela distância ao centro, 1 no centro e 0 a 1 célula). A cor vem da célula mais perto com esse
  bioma, então cada célula guarda a sua cor e variação. Divisas e costas viram curvas: sem escadinha,
  sem a dobra em ângulo reto nas emendas, e o contorno entre biomas passa a existir também nas emendas
  (largura fixa na tela). Só desenho: a simulação, o pincel e os dados continuam na grade.
  - **Custo (notebook, sem limite de fps):** de longe igual (~610); de perto ~200 contra ~330 antes. A
    tangente de cada centro sai de uma série curta a partir da tangente do ponto (a Mali-G52 é lenta em
    tangente). Falta o celular medir de perto.
  - **Limite:** perto dos 8 cantos do cubo o miolo das células continua um pouco torto (vira um mosaico
    arredondado), mas sem quina.
  - **Descartado:** trocar a grade (semanas, outro marco); malha de quadrados presa à tela (escorrega ao
    girar); só misturar bordas orgânicas nas emendas (dois estilos na mesma tela).
  - Imagens: `docs/img/m2-perto-alisado-emendas.png` (em cima antes, embaixo agora: emenda e canto do
    cubo, semente `42`) e `docs/img/m2-perto-alisado-face.png` (meio de uma face, do zoom máximo ao
    médio).

- **2026-10-17 — Vista de perto mais leve, mesma imagem (meta de desempenho quebrada: "de perto está
  travando muito" no celular).** Medido no notebook (GPU real, sem limite de fps, semente `terra`, zoom
  máximo, 720×1600): antes do alisamento 489 fps; com o alisamento **264**; agora **~395 girando** e
  **~340–420 com placas a 100%** (varia com a posição das placas); de longe igual (~775). A imagem é a
  mesma: comparação pixel a pixel com a versão anterior em 5 vistas (meio da face, emenda, 2 cantos),
  no máximo 13 pixels diferentes em 1,15 milhão (uma borda 1 pixel ao lado). Os hexágonos dos cantos
  ficam (o usuário gostou). O que mudou no shader:
  1. **Sem arrays com índice variável:** as 4 células são escritas por extenso; guardam só bioma,
     distância e endereço, e a cor é lida uma vez, no fim, só da escolhida.
  2. **Bits dos cantos na textura de cores:** o canal alfa leva o bioma em 4 bits e, nos outros 4, um
     bit por canto da célula: "as 3 células na direção deste canto estão na face e têm o mesmo bioma".
     Nesse caso (a maior parte da tela) o pixel só escolhe a célula mais perto e lê 1 ou 2 texels em vez
     de 4, sem divisa. O pincel repinta também o anel de 1 célula em volta da área pintada (`withRing`).
     **Limite: 16 biomas** (hoje são 16); bioma novo na T7 exige mover os bits para outra textura (teste
     em `tests/render/colors.test.ts` avisa).
  3. **Métrica local da grade** em vez do centro exato de cada célula: perto de 1–2 células, a distância
     na esfera é `X·du² − 2xy·du·dv + Y·dv²` (com X = 1 + x², Y = 1 + y² na face); erro máximo 0,55% de
     uma célula (0,3 pixel no zoom máximo). Tira 4 divisões e 4 raízes por pixel. O termo cruzado é o que
     inclina a grade perto dos cantos (losangos de ~120°, células hexagonais). Do outro lado da emenda o
     cálculo continua por vetores (raro).
  - **Testado e descartado:** usar o desenho simplificado quando o jogo está pausado. Pausado no meio da
    deriva as placas estão fora da posição da última recomposição e precisam do desenho completo;
    recompor ao pausar mudaria o mundo (determinismo).
  - **Medido e não é o gargalo:** a segunda cópia da função de perto (transição suave, só 8% dos quadros
    com placas a 100%) e a quantidade de variáveis vivas.
  - **Custo na CPU:** pintar as cores do mundo todo 16,4 → 20,0 ms no notebook (N = 256): uns +15–20 ms
    na geração do celular (2,8 s, meta 3 s) e na recomposição do ajudante 2 (fora do relógio).
  - **"Medir desempenho":** cenários novos "de perto, girando" (pausado) e "idem, de perto" (tempo 20×,
    placas 100%). O giro de teste anda na mesma velocidade na tela em qualquer zoom. A "deriva longa"
    começa 10 s mais tarde que nos relatórios anteriores.
  - A impressão digital do motor da geologia (`tests/sim/geology-golden.test.ts`) passa a olhar só o
    bioma no canal alfa: com ela, o valor antigo bate (o mundo não mudou).


- **2026-10-17 — Metas de desempenho "de perto" (decisão do usuário, depois do relatório `751d6e39`).**
  De perto (zoom máximo), parado ou girando: ≥ 60 fps. De perto com placas andando: ≥ 30, nunca abaixo
  de 20 (a mesma da deriva de longe). Medidas nos cenários "de perto, girando" e "idem, de perto" do
  "Medir desempenho". No Hot 50i, `751d6e39`: 61 e 46 (mínimo 33): batidas; travadas 147 → 1. "Não
  precisa otimizar mais agora."

- **2026-10-17 — T6, recursos minerais: decisões técnicas.**
  - **Código de 1 byte por célula** (tipo em 5 bits, tamanho em 2, petróleo revelado em 1), gravado na
    amostra de crosta da tectônica: anda com a placa e some quando a crosta afunda, sem custo na
    recomposição. Crosta nova ou copiada de vizinha não herda jazida (não duplica); crosta que passa de
    placa (acréscimo) leva a jazida.
  - **Pincelada só liga o bit de revelado** na amostra (nunca apaga nem troca o tipo): o motor da
    geologia pode ter uma jazida mais nova que o mundo do relógio.
  - **Formação medida no relógio da deriva**, não em recomposições (que dependem da resolução):
    períodos 0,27 rad (arco), 0,34 (colisão), 0,2 (rifte), chance 0,6 a cada período; frente com menos
    de 3 células não conta. Sorteios próprios na ordem das recomposições (determinístico; teste repete
    e compara).
  - **Geração em províncias com amostragem** (1 célula em 5 entra na busca de lugares; o ambiente,
    inclusive o cráton pelo mesmo ruído das províncias do G4, só é calculado onde precisa): 13–19 ms no
    notebook. Descartado: avaliar todas as células (27 ms) e filtrar candidatos por província (15 ms).
  - **Desenho:** a tela recebe o array de jazidas inteiro (0,4 MB) com o mundo e a cada recomposição, e
    numa pincelada só quando ela revela petróleo; vira uma textura de 1 byte por célula (e a cópia da
    composição anterior, para a transição suave). O bit mais baixo do azul na textura de cores marca as
    células com algo a desenhar de perto: só elas leem a textura das jazidas (desempenho de perto igual).
  - **Filtro da legenda na CPU** (repinta as cores do mundo ao trocar, como "Ver placas"), não na GPU como
    proposto: uma repintura por toque na legenda, sem código a mais no shader.
  - **Halo de 5 células** em volta das jazidas, só com a camada ligada: de longe uma jazida tem 1–2
    pixels.
  - **Toque com a camada ligada:** o pincel espera 300 ms parado (ou começa ao arrastar) para separar
    toque curto de pincelada; o nome vem do relógio (`query`), na célula tocada ou numa vizinha.

- **2026-10-17 — T7, clima: decisões técnicas.**
  - **Desvio global com amplificação polar** (0,5 + 1,3·|lat|/90°): "−8 °C" do usuário é o valor do
    ciclo; o equador esfria ~4 °C e os polos ~14 °C. Calibrado em 5 sementes (calota em ~62–65° no
    clima normal, ~45–50° no máximo glacial). Limites: calota em terra −10 °C, geleira de montanha
    −12 °C com chuva ≥ 250 mm, tudo gelo abaixo de −18 °C, mar −10 °C ± 4 °C de corrente.
  - **Nível do mar** só desce (o gelo em terra guarda a água): 15 m/°C, degraus de 10 m. A geologia
    passa a usar `heightAboveBase` (nível de referência fixo): crosta continental ou oceânica não muda
    com o mar baixo. Clima, água e biomas usam o nível atual.
  - **Recálculo do clima no ajudante 2** a cada 0,2 °C ou degrau do mar, entregue como "composição de
    clima" (mesma fila e mesmo atraso de 480 passos das recomposições, determinístico). Parcial (só
    temperatura, gelo e bioma; mesma conta do total, testado) quando o mar não muda. A tela recebe só
    os retângulos com cor nova.
  - **Pinceladas no mundo do ajudante:** a tectônica diz em que célula está cada amostra
    (`syncSample` devolve a célula); o motor grava a pincelada e refaz o clima dela. Sem isso, um
    recálculo de clima entre duas recomposições desfazia o morro pintado.
  - **Controle de temperatura:** manda ao soltar o controle; o relógio faz uma prévia na hora (o mesmo
    cálculo do ajudante, que chega depois).
  - **Umidade:** alcance 0,25 → 0,8 rad e chuva base ×1,35 (chuva mediana 595 mm, desertos 16%).
  - **Erosão pela chuva:** taxa × chuva/700 mm, entre 0,25× e 2×.
  - **Fronteira de placas de perto:** só células da própria placa (bit de "encosta em outra placa" da
    textura de placas decide quando olhar); a cópia de tolerância continua só de longe (células < 6 px).

- **2026-10-17 — Aparelho-alvo passa a ser o notebook (decisão do usuário).**
  - **Decisão:** o alvo é o ASUS Vivobook Go E1504FA com Ubuntu (Ryzen 5 7520U, Radeon 610M, 16 GB,
    tela 1080p a 60 Hz com toque). O celular (Infinix Hot 50i) sai do projeto **sem meta nenhuma**.
    O "Medir desempenho" passa a ser rodado no notebook. O usuário joga pelo toque.
  - **Motivo:** manter dois aparelhos dobraria o trabalho.
  - **Descartado:** manter o celular como alvo mínimo.
  - **Medição de partida (notebook, 1920×1080, Chrome, versão de 2026-10-17):** 60 fps (teto da tela)
    em todos os cenários, inclusive "de perto" e placas 100%; pior quadro 17 ms, nenhum > 50 ms;
    geração 0,79 s (primeira abertura 1,48 s); recomposição média ~330 ms (pior 505), relógio sem
    esperar; recálculo do clima ~88 ms no ajudante.
  - **Metas propostas (aprovadas pelo usuário em 2026-10-17, ver a entrada do teste da `b3297292`):**
    1. Todos os cenários (pausado, girando, de perto, tempo 20×, placas 100%, deriva longa, ruptura):
       **60 fps de média** (o teto da tela), **mínimo ≥ 50**, **nenhum quadro > 50 ms**.
    2. **Geração ≤ 1,5 s** do pedido ao globo (primeira abertura ≤ 2,5 s).
    3. **Recomposição ≤ 1 s** no ajudante e o relógio **nunca esperando** em 20× com placas 100%.
    4. **Folga para os marcos seguintes:** o desenho do globo ≤ 8 ms de GPU por quadro em 1080p (metade
       do quadro de 60 Hz), medido com consulta de tempo de GPU.
    5. Memória: o teto de 150 MB de dados vira **≤ 400 MB** (o notebook tem 16 GB).

- **2026-10-17 — Teste da 50f0dca: correções e decisões.**
  - **Pontos rosa e azuis no gelo:** a cor do gelo claro passava de 255 e a textura (`Uint8Array`) dava
    a volta (260 → 4). Cor presa em 0–255. Não era o limite de 16 biomas (são 16 exatos, cabem).
  - **Costa reta (aprovada):** de perto fica a célula de centro mais perto, sem alisamento por pesos;
    o contorno sai da diferença de distância (√) até a célula de outro bioma. Custo menor por pixel.
  - **Quadrados mais cedo:** as células viram quadrados a partir de 3–6 px (antes 6–14). Entre 6 e
    14 px a borda orgânica ainda agia sobre pixels já visíveis e fazia formas redondas e "lascas"
    pontudas na costa. A borda orgânica fica só onde a célula tem menos de ~3–6 px.
  - **Fronteiras de placa de longe:** a borda orgânica desloca o ponto até ~0,7 célula e perto da
    fronteira ele caía na textura da outra placa, lida com a rotação desta: faixas arrastadas ao longo
    da costa, maiores quanto mais as placas andaram. Agora, se o ponto deslocado é de outra placa, lê
    sem o deslocamento (1 leitura de textura a mais por pixel, só com placas fora da composição).
  - **Minério de perto:** mosaico 3×3 de pixels quadrados na cor do tipo (sem bolinhas). Jazidas
    maiores (pequena 3–6, média 10–20, grande 25–45 células), mesmo número (~45–55): 0,67% da terra.
  - **Formação de jazidas pelo relógio do jogo:** cada frente ativa forma uma jazida a cada intervalo
    sorteado de 1.000–10.000 anos (pedido do usuário). Medido: ~2,5 jazidas novas por 1.000 anos no
    mundo todo com placas 100%. A formação só roda nas recomposições (placas paradas = geologia parada).
  - **Plataforma continental larga:** a faixa rasa da geração vai a 28% da faixa de profundidades
    (antes 6%), até −160 m. No máximo glacial (mar −120 m) a terra sobe de 30% para ~32–33,5% (antes
    ~30,5%). Efeito colateral: a crosta continental (acima de −500 m) passa de ~31% para ~35% do
    planeta (a Terra tem ~40%); a semente "7" passou a cumprir o critério de altitudes (era falha
    conhecida); dois testes longos passaram por menos de uma amostra e ganharam essa folga.
  - **Controle de temperatura suave:** o controle manda o alvo já ao arrastar; o aplicado anda até ele
    a 1 °C por segundo real (também pausado) e o mundo é refeito a cada 0,5 °C.
  - **Teclado e mouse no notebook:** setas ↑/↓ aproximam/afastam no centro, ←/→ giram (velocidade na
    tela igual em qualquer zoom); mãozinha (grab/grabbing) sobre o globo no modo mover; toque curto no
    modo mover sempre mostra o bioma e a jazida à vista. Norte/sul pelo teclado: não há (arrastar faz).

- **2026-10-17 — T8, terremotos e tsunamis: decisões técnicas.**
  - **Desastres no relógio (ajudante 1)**, um sorteio por ano de jogo, com sorteios próprios na ordem dos
    passos (determinístico). Em "Placas 0" a geologia congela: sem terremoto natural.
  - **Tensão por trecho de fronteira** (par de placas + tipo), não por célula: não depende da resolução e
    sobrevive às recomposições (a fronteira anda, o trecho continua). "Ver tensão" (T11) pinta o trecho.
  - **Animações em tempo real** (camada de cima, canvas 2D), separadas dos efeitos no mundo (anos de
    jogo): a 20× um ano passa em 0,05 s. Descartado: animar no tempo do jogo.
  - **Marcas temporárias em anos de jogo** (alagado 8, cinzas 25, queimado 60, seco 12), repintadas a
    cada 3 anos enquanto somem; o relógio pinta por cima das cores que vêm do ajudante 2.
  - **Onda com velocidade mínima de 0,4** da do oceano fundo: com √profundidade pura ela ficava presa
    na plataforma continental larga.
- **2026-10-17 — T9, vulcões: decisões técnicas.** Erupção ergue o terreno pelo mesmo caminho do pincel
  de Elevar (gravado na placa, anda com ela). Ponto quente medido pela distância que a placa anda por
  cima (3.500 m por célula em média, em pulsos de 3 células, teto 150 m/ano): sem o pulso nascia uma
  crista contínua em vez de ilhas em fila. O crescimento do ponto quente não é desastre (não conta na
  frequência); só as erupções visíveis dependem dela.
- **2026-10-17 — T10, clima: decisões técnicas.** Furacão desenhado no shader do globo (espiral nas
  nuvens, até 4 ao mesmo tempo), andando pela trilha em 9 s reais; seca, enchente e incêndio piscam na
  camada de cima. Nuvens animadas só com o tempo correndo e de longe (parado, o globo continua sem
  redesenhar). Ruído das nuvens em eixos girados e deformado pela escala maior: com os eixos da textura
  de ruído, as nuvens viravam blocos. Incêndio só a partir do ano seguinte ao início da seca.

- **2026-10-17 — Teste da `b3297292` no notebook: decisões do usuário.**
  1. **Metas do notebook aprovadas** (as cinco propostas acima; `CLAUDE.md` regra 6 e
     `docs/01-arquitetura.md`). Medição do usuário (Firefox, 1920×1080): mínimo 59–60 fps em todos os
     cenários, pior quadro 34 ms, nenhum acima de 50 ms, geração 0,96 s, primeira abertura 2,25 s.
     Faltaram o tempo de GPU e a memória: o "Medir desempenho" passa a mostrar os dois.
  2. **Controles ficam como estão**, sem tecla para norte e sul.
  3. **Polos: trocar pela proposta** (`docs/img/m2-polos-proposta.png`), desde que o losango de perto
     não deforme o que passa por cima; calotas polares e variação de cor no gelo; textura fina no M8.
  4. **A mancha oval sem nuvens em volta do polo tem que sumir** (parece uma tampa). As nuvens em si
     estão boas.
  5. Floresta tropical fica como está. 6. Minérios aprovados.
  7. **Prioridade visual:** o que o desastre faz no mundo, legível; acabamento fino no M8.
  8. **Redesenho dos desastres** (refaz T8–T12): todo desastre muda o mundo (terreno, bioma,
     vegetação), não uma "rodela" por cima; furacões vários, das nuvens, ciclone para os pequenos;
     terremoto treme a tela e destrói o que há no epicentro; tsunami recua, avança e raspa a costa,
     com alcance maior; magnitude ao provocar terremoto, tsunami e furacão; seca esquenta e mata a
     vegetação; incêndio célula a célula, campo pega fogo; enchente melhorada e diferente do tsunami;
     vulcão com cratera, lava, adormecido/acordado; raio novo; sem lista, aviso no canto inferior
     esquerdo. Especificação e imagens antes de codar (`docs/M2-especificacao.md`, Bloco Desastres v2).
     Sobre "mais parecidos com os do WorldBox": a regra 8 continua valendo; segue-se a ideia (desastre
     agindo célula por célula no mapa), com cores, regras e números nossos.
  9. Para os docs de marcos futuros: seca −30% de vida, furacão "puxa as coisas", terremoto destrói o
     que há em cima, características do mundo em porcentagem (`docs/04-ecologia.md`); nômades caçam
     depois de "dominar o fogo" (`docs/02-marcos.md`, M4); eventos de exemplo da crônica ("Fim da
     Pangeia", "Ora, temos um Sócrates aqui", "Piromania") em `docs/07-cronica-nomes.md`.

- **2026-10-18 — Redesenho dos desastres: respostas e ajustes do usuário** (detalhes em
  `docs/M2-especificacao.md`, Bloco Desastres v2).
  1. Velocidade: provocar um desastre volta o jogo para 1×; desastre natural não mexe na velocidade.
     Motivo: os desastres andam no relógio do jogo (determinismo), e em 20× o provocado passaria em
     menos de 1 s; frear no natural frearia o tempo toda hora.
  2. **Reversão da decisão de 2026-10-15** ("só o vulcão muda o relevo para sempre; os outros se
     recuperam"): agora o tsunami raspa a costa e o terremoto derruba encostas, para sempre e pouco.
     Alternativa descartada: só a vegetação mudar.
  3. Raio e vulcão: os dois sentidos (erupção solta raios que acendem fogo; raio acorda vulcão
     adormecido). Raio do jogador num furacão cria um **furacão de fogo**.
  4. Enchente aprovada. Tsunami aprovado com alcance de 3 a 28 células pela magnitude (o usuário
     dobrou o máximo proposto, 14).
  5. Ajustes: seca maior e semiárida (caatinga), desenhada célula a célula, sem mancha por cima;
     terremoto com fenda e estrago pela magnitude, fenda irregular, deslizamentos seguindo a encosta;
     vulcão em tamanhos variados, lava seguindo o terreno, cone e basalto bem separados; seletor do
     furacão por categoria. Relevo do terreno mais legível: proposta antes de fazer.
  6. Aprovados como estão: raio e incêndio, enchente, desenho do tsunami, nuvens e correção da tampa
     no polo. A R1 (polos, nuvens, GPU e memória no relatório) pode começar.

- **2026-10-18 — R1: polos, nuvens no polo e GPU/memória no relatório (decisões técnicas).**
  - Polos pela proposta aprovada (patch guardado da proposta, reaplicado). O "losango" de perto: perto
    do polo as células aparecem giradas 45° (o polo é o centro de uma face do cubo); o gelo é só a cor
    de cada célula, então não entorta nada que passa por cima (terra, nuvens).
  - Nuvens: a tampa vinha da emenda das faixas de vento (cada lado girando para um lado) e de quase
    nenhuma nuvem acima de 60°. Solução: misturar os dois lados numa faixa de ~6° (o ruído é calculado
    duas vezes só nessa faixa) e +0,32 de cobertura perto do polo. Descartado: vento variando suave
    com a latitude (as nuvens se esticariam sem fim com o tempo).
  - GPU: consulta de tempo da GPU (EXT_disjoint_timer_query_webgl2) quando existe; no Firefox ela não
    existe, e o relatório mede cada desenho esperando a GPU (lendo 1 pixel), o que inclui a CPU.
    Memória: `measureUserAgentSpecificMemory` (Chrome, página isolada) para a página inteira; os
    "dados do jogo" são a soma dos arrays do mundo, da geologia e da tela (já existia no painel Dados).
  - **Achado: a meta de GPU (≤ 8 ms) está quebrada de perto com as placas andando** (~8,1 ms; ~14,6 ms
    na transição suave depois de cada recomposição, quando a superfície é desenhada duas vezes).
    Longe e de perto parado ficam em ~4 ms. Parada obrigatória: opções levadas ao usuário.

- **2026-10-18 — Respostas do usuário à R1 e às imagens do `35a5ceb`.**
  1. **Meta de GPU de perto com as placas andando: opção (a), otimizar para caber em 8 ms**, depois
     de implementar o relevo (que também pesa na GPU; otimizar antes faria o trabalho duas vezes).
     Se a transição de perto mudar de aparência, mostrar antes. A meta é 8 ms; não otimizar além.
     Descartadas: (b) meta pela média do cenário; (c) meta separada de 12 ms.
  2. **Relevo do terreno: opção (b), degraus** (níveis a cada 150 m, sombra e borda iluminada pela
     luz de noroeste), o quadro 7 da proposta. Vale também de perto; se ficar ruim, o usuário avisa.
     Descartadas: (a) sombra suave de encosta; (c) sombra + cor pela altura.
  3. Imagens aprovadas: terremoto v2, vulcão v2 e seletores de força. A seca v2 fica como está por
     enquanto; o semiárido deve ficar mais bonito com a ecologia (M3, `docs/04-ecologia.md`).
  4. Ordem do bloco: R2 → RL (relevo) → RG (GPU) → R3 a R9.
  5. Docs: referência da câmera em primeira pessoa (vídeo do Andrezitos) em `docs/02-marcos.md`.

- **2026-10-18 — R2: base dos desastres v2 (decisões técnicas).**
  - O chão (vegetação e estados) vive só no relógio, com as células fixas no lugar: a recomposição
    das placas leva décadas para andar uma célula e quase tudo volta antes disso. O que dura séculos
    (basalto) passa a andar com a placa na R7. O ajudante 2 continua pintando o mundo sem o chão; o
    relógio repinta por cima só as células com algo (lista de células ativas).
  - Vegetação em ponto flutuante (0–1) por célula (~1,5 MB em N = 256); a tela só recebe a célula
    quando a aparência muda de degrau (4% de cobertura ou 1/8 da força do estado), para não mandar
    remendos a cada ano em 20×.
  - Uma célula tem um estado de cada vez; o novo substitui o anterior, menos lava e basalto (só lava
    cobre). Descartado: vários estados por célula (mais memória e cor ambígua).
  - Provocar volta para 1× pela tela (o seletor de velocidade acompanha); pausado continua pausado
    (a decisão do usuário fala em "se estiver mais rápido").

- **2026-10-18 — RG: GPU de perto com as placas andando (decisões técnicas).** Medido no notebook:
  o custo não era a sobreposição de placas nem o tamanho do código, e sim (1) a busca larga de placas
  vizinhas (4 sondas por pixel) virando o caso comum com placas a 100% em 20×, porque elas andam até
  ~3,2 células entre recomposições e o alcance guardado era 3,5 células com folga de 1,5×; e (2) a
  transição desenhando o globo duas vezes. Decidido: candidatas a 8 passos (alcance 5,6 células), a
  distância até a outra placa mais perto nos bits livres da textura de placas (bits 5 e 7), e a
  transição lendo uma imagem guardada na recomposição (reprojetada pela câmera e pelo giro de cada
  placa; fora dela, o desenho completo de antes). Descartados, medidos sem ganho: busca em laço,
  reaproveitar a placa da composição atual na anterior, imagem guardada em 16 bits, ler a imagem
  guardada antes do resto do pixel. A leitura da imagem guardada custa ~1,4 ms nesta GPU (medido; não
  é falta de banda). O pior caso que sobra é a distância média (células de ~5 px, onde bordas
  orgânicas e vista de perto se sobrepõem): média 7,1–7,8 ms, quadros isolados até 8,4 ms. Como o
  usuário pediu ("a meta é 8 ms; não otimize além disso"), parei aqui.

- **2026-10-18 — R3: incêndio e raio (decisões técnicas).**
  - O fogo é um processo de percolação: perto do ponto crítico, o tamanho muda muito com a chance de
    passar (medido: com 30% a mais de chance a mediana vai de 3 para 160 células). Calibrado para ficar
    abaixo do ponto crítico sem seca (a favor do vento ~55% por célula ao longo da queima) e acima na
    seca (×3). Descartado: tamanho sorteado de antemão (o de antes), que não deixa o vento e o terreno
    decidirem a forma.
  - Incêndio do jogador mais forte (foco de raio 2, chance ×1,2), mantendo a regra da T11 de que os
    desastres provocados são fortes. Sem isso, metade dos fogos do jogador morria em 2–3 células.
  - Raio natural só entra na simulação (e na tela) quando acende fogo: os que caem no mar ou na chuva
    seriam dezenas de clarões por segundo a 20×, sem efeito.
  - O aviso do incêndio sai quando ele apaga (só então se sabe o tamanho).

