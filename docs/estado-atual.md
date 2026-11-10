# Estado atual do projeto

Atualizado em: **2026-11-09**, branch `marco-3`. **M2 no `main` com a tag `v2.0`. Bloco "fechar o M3" em andamento (mensagem do usuário de 2026-11-09): o Claude Code segue sozinho até o relatório final.**
Jogo: **https://berzeruska.github.io/sandbox-mundo/** · Prévia: **https://berzeruska.github.io/sandbox-mundo/previa/atual/**
O Claude Code reescreve este arquivo ao fim de cada tarefa. Se outro documento disser outra coisa sobre "onde
estamos", vale este.

## Bloco "fechar o M3" (2026-11-09)
Regras deste bloco em `docs/decisoes.md` ("Fechar o M3 com o máximo de autonomia"): o Claude Code decide design e mecânica como **provisório**, testa tudo no Firefox a 1920×1080 e só para no relatório final. Decisões provisórias: `docs/decisoes.md` e, no fim, `docs/M3-revisao.md`.

**Para continuar do zero:** ler esta seção, depois `docs/M3-especificacao.md` e a entrada de 2026-11-09 em `docs/decisoes.md`. A próxima tarefa é a primeira caixa vazia abaixo.

### Parte 1: fidelidade às referências (página `docs/M3-fidelidade.md`)
- [x] P1 terraços limpos · [x] P2 montanhas · [x] P3 jazidas com a cor do minério · [x] P4 animais iguais às folhas, com mar e míticos · [x] P5 plantas, água, gelo, deserto e vulcão · [x] P6 recomposição da maquete ≤ 1 s (865 ms) · [x] P7 intervalos de 130 a 380 ms

### Parte 2: ecologia (`docs/M3-especificacao.md`)
- [x] E1 · [x] E2 · [x] E3 (números no relógio; falta a maquete ler) · [x] E4 · [x] E5 · [x] E6 · [x] E7 · [x] E8 · [x] E9 · [x] E9b

### Parte 3: fechamento (E10)
- [ ] "Medir desempenho" no Firefox contra a linha de base · [ ] CHANGELOG e `docs/M3-revisao.md` · [ ] PR do `marco-3` para o `main`, **sem merge** · [ ] prévia final em `/previa/atual/`

### Onde a sessão parou (2026-11-09, limite de uso) e como continuar
- **Feito e no git:** Parte 1 inteira (P1 a P7, `docs/M3-fidelidade.md`) e os números da ecologia (E1 a E3).
- **E1 a E3, o que existe:** `src/world/species.ts` (tabela das espécies) e `src/world/ecology.ts` (classe `Ecology`): biomassa de planta e população de cada espécie por **bloco de 8×8 células** (um pedaço da maquete), capacidade pelo bioma e pela vegetação, crescimento logístico, caça com saturação, refúgio, migração, anos bons e ruins de chuva. Anda no relógio (`SimulationCore.stepTick`), um doze avos dos blocos por passo. O teste de aceite de 1.000 anos passa nas 5 sementes (`tests/world/ecology.test.ts`), sem falha conhecida. Já estão escritos e testados, mas **ainda sem uso na tela:** `hit` (desastres, E4), `place`, `kill`, `setTrait` (poderes, E6), míticos (E7), `moisture` (floresta e chuva, E9), a mensagem `life` e o campo `life` na cópia para a maquete.
- **Custo medido (N = 256, Node):** 0,75 ms por passo (pior 3,4 ms no passo que fecha o ano), 1,5 MB. Está abaixo do 1 ms da especificação, mas **pesa no Máx** (cerca de 1.400 passos/s hoje): falta medir no jogo e, se preciso, baixar o custo (ideias: lista de espécies presentes por bloco; atualizar mar e terra em anos alternados).
- **E4 feita:** cada estado que chega a uma célula (fogo, lava, água, fenda, cratera) mata e espanta ali (`Ground.onState` → `Ecology.hit`); a seca baixa a capacidade em 30%; a recomposição das placas manda refazer as capacidades; os avisos de espécie em risco, último indivíduo, extinção e recuperação aparecem no canto, e tocar leva a câmera até lá.
- **E5 e E8 feitas:** cada pedaço da maquete mostra a população do bloco dele (`src/render/maquete-animals.ts`): nasce filhote pequeno quando o número sobe, morre um quando desce; com caçador da espécie no pedaço, a morte é uma caçada (corre, a presa foge, cai, ele come ao lado). Corpo fica 26 s e some encolhendo; mancha de sangue baixa e escura só em quem foi caçado, sem pedaços. Conferido no Firefox (savana, ~1.000 indivíduos à vista; matar com o poder de deus derruba os bichos na tela).
- **E6, E7 e E9b feitas:** categoria **Vida** no menu: grade das 29 espécies (o ícone é o próprio modelo, com o total do mundo); tocar numa espécie mostra ícones no globo onde ela vive. Ferramentas de toque: **Pôr** (um grupo da espécie; mítico, um indivíduo), **Matar** (no raio do pincel; a espécie escolhida ou todas), **Acompanhar** (na maquete, tocar num animal: a câmera segue; arrastar solta) e **Mudar** (tamanho, fome, agressividade, velocidade e fertilidade da espécie inteira, de 50% a 200%). Míticos: só postos por deus, andam atrás de caça, comem, o dragão põe fogo; aparecem na maquete (rondando) e no globo (ícone). Conferido no Firefox.
- **E9 feita:** a vida reage aos extremos pelo bioma e pelo gelo (planeta congelado e calor extremo testados: quem não cabe some; o camelo fica no deserto); floresta grande em volta dá até 30% a mais de crescimento às plantas do bloco, e onde ela some tudo em volta cresce mais devagar. **Ritmo do tempo (opção 5) feito:** na maquete, em 1×, um mês por segundo; o selo mostra "1× · 1 mês/s"; 2×, 5×, 20× e Máx não mudam.
- **Próximos passos:** (5) Parte 3: medição final no Firefox, CHANGELOG, `docs/M3-revisao.md`, PR sem merge, prévia.
- **Pendências anotadas:** travada de 213 ms ao gerar o mundo de novo no fim do "Medir desempenho"; sucessão das plantas na maquete (capim antes das árvores) ainda não ligada à biomassa.

### Feito neste bloco
- [x] **P1 e P2, terraços e montanhas (2026-11-09):** reproduzido no Firefox (lascas e riscos em zigue-zague; montanhas em bolotas com grama em espiral). A malha do chão agora corta cada triângulo pelas curvas de nível: patamar plano, parede de terra limpa entre dois patamares, e nada de lasca (crista ou vala com menos de 3 vértices de largura fica no patamar vizinho). As montanhas viraram o próprio chão em degraus altos: parede de rocha, patamar de grama com pinheiros e pedras, neve a partir de um patamar inteiro e cume em ponta. Cada pico pertence à célula do mundo: sai igual em pedaços vizinhos e dos dois lados da aresta do cubo. Código: `src/maquete/chunk-build.ts` (`steppedTriangle`, `prepareSteps`, `surfaceY`) e `src/maquete/world-fields.ts` (`Peaks`, `fill`). Testes: `tests/maquete/terraces.test.ts`.
- [x] **P3, jazidas (2026-11-09):** reproduzido (lajes cinza-escuras, mancha fraca). Cores tiradas de `recursos/jazidas.png` (cobre laranja com verde-azulado e azul, ferro com ferrugem, urânio com cristais verdes, enxofre amarelo, sal e lítio com cubos brancos); lajes maiores, duas por célula, e mancha forte no chão. Continua afloramento (decisão de 2026-11-06), sem montes. A cava de petróleo é única e grande (opção 2), com o chão aplainado em volta.
- [x] **P4, animais (2026-11-09):** os modelos foram refeitos como cascos facetados (um tubo de seção em polígono que segue dorso, pescoço, crânio e focinho), com medidas e cores de cada folha: rena de peito creme e galhada alta, lobo de dorso escuro, alce com pá, javali com crina, bisão de corcova e frente escura, zebra com listras de verdade (fatias do corpo), leão de juba, onça com pintas e cauda de anéis, elefante com orelhas, tromba e presas, camelo de uma corcova, cabra-montesa com chifres em arco, águia de cabeça branca. Mar: baleia, cachalote, tubarão, lula e lula-gigante aparecem inteiros, azulados onde estão dentro da água. Classe mítica só no desenho (dragão, kraken, baleia branca colossal): modelos prontos, sem nascer sozinhos. Código: `src/maquete/animals.ts`; conferência em `prototipo/folhas.html?folha=animais1` a `4`; teste `tests/maquete/animals.test.ts`.
- [x] **P5 a P7 (2026-11-09):** rios em curva (o curso é alisado; antes vinha em escada e em cruz), dunas cor de areia, cratera menor, gelo sem pontas penduradas, pico não nasce dentro de vulcão. Recomposição da maquete: 865 ms (antes 3.374), porque os pedaços sobem para a GPU por tempo e não 2 por quadro. Intervalos entre quadros: aparecem também numa página que só limpa a tela (tela virtual); um caso era do jogo (leitura do tamanho do canvas a cada quadro, até 65 ms) e foi corrigido. Tudo em **`docs/M3-fidelidade.md`**, com as capturas ao lado das referências.
- **Medição parcial (2026-11-09, Firefox real, relógio da GPU, build de produção, na tomada):** GPU do globo ≤ 6,6 ms (pior 7,5), da maquete ≤ 3,4 ms (pior 3,9); trabalho da tela 0,2 a 1,2 ms por quadro (pior 24); pior recomposição 711 ms, relógio esperou 0; recomposição da maquete 865 ms; 2 travadas (uma de 213 ms ao gerar o mundo de novo no fim da medição, a investigar no fechamento). O ritmo de quadros dessa tela virtual não vale (ela não limita a 60 Hz).
- Também corrigido no caminho: buraco na margem de lago encostado em outro nível de água; frestas na água do mar; água sobrando para fora do rio em lascas azuis (dique baixo onde o rio corre acima do chão ao lado). As opções de URL `relevo=`, `pedras=`, `oleo=` e `aa=` saíram: as escolhas estão feitas.
- [x] Regras do bloco e decisões pendentes registradas; lista de lugares da Bahia em `docs/02-marcos.md` (variedade de geologia, sem marco).

## Bloco "fazer a maquete funcionar"
**Bloco encerrado em 2026-11-09:** o usuário respondeu as decisões (ritmo 5, petróleo 2, FXAA, lista de espécies 1) e abriu o bloco "fechar o M3", acima.

Decisões em `docs/decisoes.md`. **A medição que vale é o "Medir desempenho" no Firefox do usuário, em tela cheia, na tomada;** as capturas também saem do Firefox, em janela de 1920×1080.
- [x] A1 tranco no corte (`docs/M3-defeitos.md`) · [x] A2 setas (parcial, ver `docs/M3-defeitos.md`) · [x] A3 pausa · [x] A4 animal sem cabeça · [x] A5 bolas brancas · [x] A6 mancha do terremoto · [x] A7 fumaça · [x] A8 GPU da transição (`docs/M3-defeitos.md`)
- [x] B1 opções de ritmo (`docs/M3-ritmo-do-tempo.md`; sem código até a escolha) · [x] B2 animação lisa · [x] B3 seca suave
- [x] C1 meteoro · [x] C2 tsunami · [x] C3 furacão · [x] C4 raio · [x] C5 fogo (ritmo depende de B1) · [x] C6 tempestade de areia · [x] C7 terremoto
- [x] D1 animais (corpo e rig; conferir nas folhas) · [x] D2 grupos · [x] D3 geleira · [x] D4 deserto · [x] D5 montanhas · [x] D6 terraços · [x] D7 jazidas · [x] D8 petróleo

## Modo de trabalho (usuário, 2026-11-04)
O usuário só faz testes objetivos e decide design e mecânica; o resto é do Claude Code, que para só no fim.

## Bloco de opções do portão do M3
- [x] Triagem das referências: 27 imagens em `docs/img/referencias/`, índice em `indice.png`, ressalvas em `LEIAME.md`.
- [x] Decisões, reversões (petróleo misto, dragão mítico) e itens de marcos futuros registrados em `docs/decisoes.md`, `03`, `04` e `02-marcos.md`.

- [x] `/previa/atual/` e deploy que não apaga as prévias (PR #4, no `main`); "Jogar" do README e "Website" apontando para ele.
- [x] Protótipo novo: globo 2D, corte, maquete em pedaços com detalhe 4×, sombra em partes, FXAA, botão "Medir desempenho" e linha de versão (`prototipo/index.html`; motores em `antigo.html`).
- [x] Opções com imagem: `docs/M3-decisoes-visuais.md` (paleta, relevo, 2D), `docs/M3-escala.md`, `docs/M3-meteoro.md`.
- [ ] **Parado esperando:** a medição do usuário no Chrome e as decisões de paleta, relevo, aplicação do 2D, escala, suavização e meteoro.

Medição do Claude Code: `docs/medicao-m3-bloco-opcoes.txt`. Portão e primeira rodada: `docs/M3-portao.md`. O código do protótipo fica em `prototipo/` e o jogo não o usa.

## Antes do merge (teste da `3238cd7b`, usuário, 2026-11-05)
Aprovados: relatório do Chrome (60 fps, nenhum quadro > 50 ms, relógio esperou 0, 0 travadas da data), tempo geológico; tsunami "bem melhor".
- [x] **Impacto do meteoro em alta velocidade:** batia 12 passos depois de entrar (50 ms em 20×) e a rocha levava 1 s. Agora o passo do impacto
  conta 1 s na velocidade atual (natural: sorteado 2.200 passos antes, mundo igual em qualquer velocidade). Medido quadro a quadro em 1×, 5×, 20× e Máx (5 tiros
  cada, build de produção): clarão e tremor no mesmo quadro em que o impacto chega; a cratera apareceu nesse quadro em 18 de 20 tiros (nos outros 2, no Máx, a
  medida não separou a cratera do resto da mudança do globo). A rocha estava a 98–100% do caminho em 1×, 5× e 20× e a 92–100% no Máx (ritmo variável).
  Imagens: `docs/img/m2-meteoro-20x-quadros.png`, `docs/img/m2-meteoro-max-quadros.png`.
- [x] **Data rolando:** os números sobem até o salto novo em ~630 ms, como um contador, e assentam no valor exato. Só um número por quadro
  durante a rolagem; 0,015 ms por troca, nenhum quadro lento em 60 s (20×) e 20 s (Máx).
- [x] **"Medir desempenho" de novo (build de produção):** 15 cenários a 60 fps, pior quadro 17 ms, 0 travadas, relógio esperou 0 (`docs/medicao-2026-11-05-final.txt`).
- [x] **Registrados em `docs/02-marcos.md`:** alcance do tsunami M 9,5 (atinge o planeta inteiro) e as travadas de 1.852 ms e 717 ms.

## Última rodada (mensagem do usuário, 2026-11-05)
Aprovados no teste da `2d9a2156`: crateras com limite, arquipélago, cartões, desenho novo do meteoro, clima sem
tranco. O fogo em volta da cratera fica. Quadros "janela sem foco" não contam.
- [x] 1. **Modo de tempo geológico:** em 20× ou Máx com placas andando, planeta inteiro, zoom travado, data de 500 em
  500 anos (20×) ou de 1.000 em 1.000 (Máx), com aviso. Voltando a 1×–5× (ou parando as placas), o zoom de antes volta.
  Pausado, o zoom destrava. **O Máx agora freia conforme o ajudante trabalha, em vez de correr até o limite e parar:**
  medido 40 s com placas 100%: relógio esperou 0, 0 travadas, 60 fps, pior quadro 24 ms, 1.407 passos/s (117 anos/s; antes
  ~1.930 passos/s, 160 anos/s, com 41 s parados em 60 s). Saltos: ~8,5 s no Máx e 25 s em 20× (20 anos/s).
- [x] 2. **Meteoro liso em 1×:** a posição vinha do passo do jogo, que a tela conhece em degraus (10 por segundo). Agora
  anda em tempo real e só para se o jogo parar. Medido quadro a quadro: 60 quadros em 1 s, passo igual (0,015–0,018), nenhum parado.
- [x] 3. **Cartões na primeira abertura:** link sem semente abre em "Escolha o seu mundo" e o mundo só nasce depois de
  Criar (sem cancelar). Link com semente ou tipo, ou recarregar depois de criar, vai direto para o mundo. A medida "primeira
  abertura" desconta o tempo do jogador escolhendo. Conferido no Chromium, por toque.
- [x] 4. **Tsunami:** M 9,5 entra até ~1/5 da largura do continente atingido, pelo terreno baixo (imagem
  `docs/img/m2-tsunami-quinto.png`). Magnitudes menores: 1/20 · 1/12 · 1/8 · 1/6 da largura. Medido: 12 M 9,5 seguidos, 60 fps, pior
  quadro 23 ms, relógio esperou 0, 0 travadas. Isso muda a R6 e tira o alcance do tsunami do ajuste fino.
- [ ] 5. **Travada de 3,5 s pausado: causa NÃO achada; nada corrigido.** Não reproduzida (ver `docs/bugs.md`). O registro agora
  separa "tela ocupada" (e quanto) de "tela livre esperando o quadro": se voltar, a linha diz de que lado está.
- [x] 6–10. **Registrados em `docs/02-marcos.md`:** ilhas estilo mar Egeu, formato dos continentes, modo econômico, B5, B7 e B8 no
  ajuste fino depois do M3; camadas estranhas sobrepostas no portão do M3.
- [x] 11. Três testes do usuário: aprovados na `3238cd7b`.


## Medição do Claude Code nesta rodada
`docs/medicao-2026-11-05.txt` (`cd49610`, build de produção, Chromium headless com GPU real, 1080p, na tomada): 15 cenários a 60 fps, pior
quadro 17 ms, nenhum > 50 ms, GPU pior média 6,2 ms, memória 202 MB, geração 0,96 s, abertura 1,48 s, pior recomposição 780 ms, relógio
esperou 0, 0 travadas. **Máx com placas 100%: 1.562 passos/s, relógio esperou 0, 0 travadas da data, 60 fps** (antes 1.930 passos/s, 41 s
parados em 60 s, 74 travadas). O relatório do Chrome do usuário é a palavra final.

## Rodada de 2026-11-04 (feito, com commit)
B1 + B2 `5da8db9` · B3 `40211f6` · tipo de mundo `1c7c43e` · README, ajuste fino e portão `0c6dce7` · T14 e este arquivo.

## Rodada de 2026-11-03, segunda (feito, com commit)
Docs e regras `0ae298d` · B1/B2/B4 `592a427` · proposta das crateras `42f4d7d` ·
meteoro `97f1211` · B5/B8 `ce37dc9` · B7 `135a67c` · B10 `13e1323` · tsunami `5121edd` · este arquivo.

## Onde estamos
- **Marco:** M2 — Geologia viva (`docs/M2-especificacao.md`).
- **Aparelho-alvo mudou (decisão do usuário, 2026-10-17): o notebook** (Vivobook Go E1504FA, Ubuntu,
  Radeon 610M, tela 1080p 60 Hz com toque). O celular saiu do projeto, sem meta. O "Medir desempenho"
  roda no notebook. **Metas aprovadas (2026-10-17):** 60 fps de média, mínimo ≥ 50, nenhum quadro
  > 50 ms em todos os cenários; geração ≤ 1,5 s (primeira abertura ≤ 2,5 s); recomposição ≤ 1 s sem
  o relógio esperar; globo ≤ 8 ms de GPU; memória ≤ 400 MB. O relatório tem que passar a mostrar
  GPU e memória (entra na R1).
- **Feito na rodada do teste da `50f0dca`** (detalhes em `docs/decisoes.md` e na especificação):
  pontos rosa/azuis no gelo corrigidos (cor estourava o byte); costa reta; quadrados a partir de 3–6 px
  (sem formas redondas entre os pixels); faixas arrastadas nas fronteiras de placa de longe corrigidas;
  minério em pixels quadrados; jazidas maiores (mesmo número) formando-se a cada 1.000–10.000 anos por
  frente; plataforma continental larga (pontes de terra no máximo glacial); controle de temperatura
  suave (1 °C/s); setas ↑/↓ zoom e ←/→ giro, mãozinha sobre o globo, toque curto mostra bioma e jazida.
- **Bloco Desastres (T8–T12), terminado:** T8 feita (terremotos por tensão nas fronteiras,
  tsunamis que andam pelo mar e alagam costa baixa, marcas temporárias, animações na camada de cima);
  T9 feita (vulcões em arcos e dorsais, pontos quentes formando cadeias de ilhas, cinzas que somem);
  T10 feita (seca, enchente, furacão com trilha, incêndio sob seca, nuvens com furacões em espiral);
  T11 feita (provocar cada desastre tocando no globo, frequência de Nenhum a Muitos, "Ver tensão");
  T12 feita (aviso dos grandes no alto, "Lista" no menu Desastres, tocar leva a câmera até lá).
  Medido no notebook (1080p): 60 fps com "Muitos" a 20× e placas 100%, de longe e de perto.
- **Teste da `b3297292` (2026-10-17), decisões do usuário** (detalhes em `docs/decisoes.md`):
  metas aprovadas; controles ficam (sem tecla para norte/sul); polos trocam pela proposta (sem
  deformar o que passa por cima perto do polo; calotas e variação de cor; textura fina no M8); a
  "tampa" sem nuvens em volta do polo tem que sumir; floresta tropical e minérios aprovados; prioridade
  visual = o que o desastre faz no mundo (acabamento no M8); **redesenho dos desastres**.
- **T13 feita (2026-10-19):** teste automático `tests/sim/long-run.test.ts`: o relógio inteiro
  (placas, clima, gelo, desastres) no padrão do jogo por 12.000 anos, 3 sementes, N = 128. Terra entre
  20% e 40% o tempo todo, nenhum valor inválido, ≥ 3 continentes no fim, montanhas, os 10 tipos de
  desastre e avisos na frequência do "Raro". Passa (~40 s). Achado: em N = 64 a lava que vira terra no
  mar sobe a terra para 40–42% (a lava anda em células, muita área numa grade pequena); no jogo
  (N = 256) a terra fica estável em 28–32% (medido). Registrado em `docs/decisoes.md`.
- **R9 feita (2026-10-18):** "Raro" recalibrado (um aviso a cada ~1–1,4 min em 1×, medido) e cenário
  "desastres Muitos, 20×" no "Medir desempenho": 60 fps, relógio a 240 passos/s.
- **R8 feita (2026-10-18):** furacão e ciclone andando no relógio (até 2 por quadrante, 8 no mundo),
  desenhados com as nuvens do globo torcidas em espiral, olho nos fortes; estrago no caminho (vegetação
  derrubada, ressaca na costa, enchentes pela chuva); raio do jogador vira furacão de fogo.
- **R7 feita (2026-10-18):** vulcões no mapa desde o começo (arcos e pontos quentes), cone de verdade
  com cratera, dormindo séculos e acordando com lava na cratera; erupção com a lava descendo por um canal
  e seguindo o terreno, esfriando em basalto (no mar vira terra); cinzas e raios nas fortes; raio acorda
  vulcão; o jogador acorda um vulcão ou cria um novo. O chão (vegetação, estados, rocha) e os vulcões
  andam com as placas.
- **R6 feita (2026-10-18):** tsunami nas células, passo a passo: o mar raso recua, a faixa de espuma
  chega às costas, a água entra em terra pela magnitude (3 a 28 células, parando no terreno alto), volta
  e deixa lama; a costa perde 5–20 m para sempre. M 7,5–9,5 no cartão.
- **R5 feita (2026-10-18):** terremoto com fenda irregular ao longo da fronteira e deslizamentos
  descendo as encostas, crescendo com a magnitude (M 6–9,5 no cartão); encosta perde altura para sempre;
  tela tremendo (só a câmera) pela magnitude e pela distância. Sem os anéis por cima.
- **R4 feita (2026-10-18):** seca grande e irregular virando semiárido célula a célula (vegetação
  morrendo ano a ano, mais no miolo; calor +2 a +6 °C no toque) e voltando depois; enchente subindo em
  ~1 s a partir do ponto mais baixo pelo terreno baixo, ficando 1–3 anos e deixando solo fértil (e lago
  numa bacia fechada). Sem "rodela" por cima.
- **R3 feita (2026-10-18):** incêndio andando célula a célula no relógio (vento, seca ×3, combustível
  por célula), frente amarela, queimada e a vegetação voltando; raio como desastre novo (Desastres →
  Raio): clarão e, em vegetação, fogo; raios naturais acendem os incêndios (mais na seca); incêndio do
  jogador mais forte (foco maior). Aviso do incêndio grande quando ele apaga.
- **RG feita (2026-10-18):** GPU do globo dentro da meta no notebook (médias: de perto andando 5,0 ms,
  de perto na transição 6,8, meio andando 7,1, meio na transição 7,8; quadros isolados até 8,4 ms a
  média distância). Placas vizinhas guardadas a 8 passos, distância até a outra placa na textura, e a
  transição lendo uma imagem guardada na recomposição em vez de desenhar o globo duas vezes. A imagem
  não muda (conferido pixel a pixel).
- **RL feita (2026-10-18):** relevo em degraus (níveis a cada 150 m, sombra ao pé do degrau e borda
  clara, luz de noroeste), igual ao quadro 7 da proposta; vale de perto e de longe.
- **R2 feita (2026-10-18):** vegetação por célula em % e estados de célula (em chamas, queimada, lava,
  basalto, alagada, lama, fenda, solo fértil, calor, cinzas) com cor célula a célula e recuperação na
  velocidade do bioma; desastres podem andar passo a passo no relógio (os de hoje ainda instantâneos,
  refeitos nas R3–R8); provocar voltava para 1× (revertido em 2026-10-19); fileira de força no cartão; avisos no canto inferior
  esquerdo; a lista saiu; tocar mostra estado e vegetação. Verificado no Chromium (Vulkan, 1080p).
- **Bloco Desastres v2 (R1–R9, mais RL relevo e RG GPU), especificado e aprovado em `docs/M2-especificacao.md`:**
  vegetação por célula em %, estados de célula (em chamas, queimado, lava, basalto, alagado, lama,
  fenda, solo fértil, calor) que mudam a cor e se recuperam; desastres andando passo a passo no
  relógio; incêndio célula a célula (campo queima) e raio novo; seca com calor; enchente nova (chuva,
  terreno baixo, solo fértil); terremoto com tela tremendo, fenda e deslizamentos; tsunami que recua,
  avança 3–14 células e raspa a costa; vulcões no mapa com cratera, adormecido/acordado e lava;
  furacões das nuvens, vários, ciclone/furacão, estrago no caminho; magnitude ao provocar; avisos no
  canto inferior esquerdo, sem lista. Imagens: `docs/img/m2-dv-*.png` e `docs/img/m2-nuvens-polo.png`.
  **Respostas do usuário (2026-10-18):** provocar volta para 1× (revertido em 2026-10-19); tsunami e terremoto
  mudam o relevo para sempre, pouco (reverte 2026-10-15); raio e vulcão nos dois sentidos; raio num
  furacão cria furacão de fogo; enchente aprovada; tsunami de 3 a 28 células; seca maior e semiárida
  (caatinga) célula a célula; terremoto pela magnitude, fenda irregular; vulcão com tamanhos, lava pelo
  terreno, cone e basalto separados; seletor do furacão por categoria; relevo do terreno: proposta
  antes. Aprovados: raio e incêndio, enchente, desenho do tsunami, nuvens, tampa do polo.
- **Fronteiras de placa:** o usuário não voltou a reclamar no teste da `b3297292`.
- **Limite:** a textura de cores guarda o bioma em 4 bits (16 biomas, o número de hoje). Bioma novo
  exige mudar isso; bioma novo só perguntando ao usuário, com o custo.
- **Decidido em 2026-10-16 (teste do Bloco G):** `42` é falha conhecida de latitude; critério de
  formas mantido; pedacinhos de terra no oceano depois de colisões são aceitáveis; polos, neve demais
  e biomas pouco variados vão para a T7.
- **Direção geral do usuário (2026-10-16):** o mundo real é a base, não uma cópia exata; o que precisar
  mudar para o jogo funcionar bem pode mudar, com o usuário decidindo o que tiver efeito de jogo.
- **Regra reforçada pelo usuário (2026-10-16):** mecanismo novo com efeito de jogo, mesmo para fazer
  um critério passar, é decisão de design: perguntar antes.
- **Método (regra do usuário, 2026-10-16):** teste por bloco. Sigo de tarefa em tarefa e só paro no
  fim do bloco, com prévia e lista numerada do que testar; paradas obrigatórias: decisão de design,
  teste de portão, meta de desempenho quebrada na estimativa. Blocos do M2: G (correção 2, G3, G4);
  minerais e clima (T6, T7); desastres (T8–T12); final (T13, T14).
- **Correção 1** (`9d5f101`) está na prévia; o teste dela entra na lista do fim do Bloco G.
- **Ordem aprovada:** correção 1 → correção 2 (ajudante 2) → G3 → G4 (continente amassa e vira
  montanha, especificação antes) → T6 em diante.
- **Direção do usuário (2026-10-16, corrigida por ele):** uma coisa por vez, bem feita, cada módulo
  respeitando o seu limite, sem virar bagunça. Não é "não mexer mais em placas": é não misturar.
  Fechar o G3 dentro do que já foi especificado e seguir a lista do marco. Melhoria nova (de placas ou
  de outro módulo) que não seja bug vai para os docs e entra na sua vez; reclamação fora do módulo atual:
  registrar e seguir na prioridade.
- **Prévia:** berzeruska.github.io/sandbox-mundo/previa/marco-2/ — a linha "versão" do painel Dados
  tem que mostrar o último commit do `marco-2` com mudança no jogo.
- **Publicado em `main`:** v1.1.

## Decidido em 2026-10-16
1. Correção 1 aprovada: fenda entre continentes com menos de 3 células nasce como vale de rifte.
2. Tempo travando: opção (b) completa, a recomposição vai para o ajudante 2 com memória compartilhada
   (SharedArrayBuffer); a opção (a), recomposição mais barata, vem depois. Primeiro: testar no celular
   se a memória compartilhada funciona; se não funcionar, perguntar antes de seguir com cópia. O "pior"
   do relatório passa a ser por cenário.
3. Plano de 3 ajudantes do M2 ao M7 e teto de 150 MB de RAM para os dados do jogo (Hot 50i com 4 GB),
   medido no fim de cada marco: `docs/01-arquitetura.md`.
4. Continente apagado na colisão vira G4 (amassar e virar montanha), especificação aprovada antes.
5. Registrados para depois: nuvens, tempestades e furacões em redemoinho na T10; humanos nômades com
   caça antes da agricultura no M4.

## Perguntas respondidas (2026-10-16)
- **Placas em zero liberam o ajudante 1?** Já liberam: sem deriva não há recomposição, e o ajudante 1
  só trabalha quando há passo a dar; o núcleo fica para a tela (placas paradas 91 fps contra 82–85 em
  100%). O plano não muda trabalho de ajudante conforme a velocidade das placas (o resultado
  dependeria do momento, quebrando o determinismo). Com o ajudante 2, nem em 100% as placas pesam no
  ajudante 1.
- **Pré-calcular geologia ao gerar o mundo?** O futuro das placas não (o pincel e a ruptura forçada
  mudam o rumo, e guardar estados futuros custa ~10 MB cada). Geometria e tabelas do clima já são
  pré-calculadas. O ganho real é "recalcular só o que mudou": hoje, depois de cada recomposição, o
  clima, a distância da água e as cores são refeitos no mundo inteiro, quando só a faixa das fronteiras
  e o que fica a favor do vento mudam. Isso entra na opção (a).

## Feito no M2
- T1 menu por categorias, T2 Web Worker, T3 placas, T4 movimento e controle "Placas",
  T5 fronteiras e relevo (critério de "bonito" passa em 5 sementes).
- Geração v2 (costas e bacias), aceita.
- Correção do travamento do celular em "Gerando mundo… 92%".
- D1–D5 desempenho: metas batidas no celular.
- Correção dos pedaços de placa que colidiam para sempre (`d36c156`), confirmada no celular.
- Menu e painel Dados compactos no celular (`f55e289`).
- G1 latitude (`bcfba4b`), aprovado no celular.
- G2 ciclo de Wilson (`c0660ea`), testado no celular: "bem mais liso".
- Etiqueta "PRÉVIA" não cobre mais o fps do painel Dados (`4a11cf8`): some com o painel aberto.
- G3, riftes traçados: fendas traçadas célula a célula (serpenteiam, degraus de falha transformante,
  junção tríplice, aulacógeno, terceiro braço, microcontinente, margem igual dos dois lados, rifte que
  abre como zíper); geração v3 (a Pangeia nasce soldada e se parte por riftes). Os testes de formas de
  `terra` e `mundo` voltaram a ser testes normais e passam. Geração ~+0,2 s no celular (estimativa
  ~2,9–3,0 s, no limite da meta).
- G4, colisão vira montanha: cordilheira e planalto na placa de cima, crátons com escarpa, oblíqua
  mais baixa e larga, picos e passagens, ombreira de rifte; erosão 0,5% e alisamento 3% (decisão do
  usuário). Altitudes aos 10 min no alvo do mundo real em 4 de 5 sementes.
- Correção 2, ajudante 2 "Terra": memória compartilhada "sim" no Hot 50i; recomposição, clima e cores
  em outro worker, aparecendo 480 passos depois; "pior" do relatório por cenário; "relógio esperou".
- Correção 1, vale de rifte: fenda entre continentes nasce como vale; com 3 células de largura o meio
  vira mar; rifte parado fica como vale em terra (aulacógeno, opção 1 do usuário).

## Pendente no M2
- [ ] Teste do usuário e ok para o merge (acima).
- [ ] A1, metas na bateria: aberta até a medição do usuário na bateria (na bateria a GPU passou de 8 ms em 2026-11-03).
- [ ] Temperatura "no máximo" depois de uma era do gelo: não reproduzida; o usuário não voltou a relatar.
- [ ] Travadas de 1,8 s e 3,5 s (tela, pausado): não reproduzidas; o registro agora separa a causa.
- [ ] **Falha conhecida:** semente `42` com 33% da terra acima de 60° em N = 256 aos 10 min.
- [ ] Opção (a), recomposição mais barata e clima só onde mudou (complemento da correção 2).
- [x] T13 e T14. B10 (v) virou o tipo "Continentes menores" (o padrão fica como está: 12 de 20 sementes no critério).
- Depois do M3: ajuste fino dos desastres (B5, B7, B8; `docs/02-marcos.md`).

## Últimas medições no notebook (aparelho-alvo desde 2026-10-17)
- 2026-11-05, última rodada: ver "Medição do Claude Code nesta rodada", acima.
- 2026-11-04, T14 (`0c6dce7b`, Claude Code, build de produção, Chromium com GPU real, 1080p, na tomada): 60 fps nos 15
  cenários, pior quadro 17 ms, GPU ≤ 6,2 ms, memória 215 MB, geração 0,95 s, abertura 1,46 s, pior recomposição 743 ms,
  relógio esperou 0, 0 travadas. Falta o relatório no Chrome do usuário.
- `9b5ba0d4`, medido pelo usuário (Chrome, na tomada): 60 fps, GPU ≤ 5,7 ms, 246 MB, abertura 1,7 s, recomposição ≤ 631 ms;
  28 travadas da data e uma de tela de 1,8 s no rodapé.
- 2026-11-03 (Claude Code, build de produção, Chromium com GPU real, **na bateria** 57%, perfil
  "balanced"): 854×407 → 60 fps, nenhum quadro > 50 ms, relógio esperou 0, 0 travadas, geração 1,41 s,
  primeira abertura 1,65 s, pior recomposição 924 ms. 1920×1080 depois das correções → 60 fps, nenhum
  quadro > 50 ms, relógio esperou 0, 0 travadas, geração 1,47 s, primeira abertura 1,62 s, pior
  recomposição 997 ms, memória 107 MB de dados / 213 MB a página; **GPU acima de 8 ms na bateria**: longe
  5,7, de perto 10,6 (pior 15,9), de perto andando 8,5, meio andando 9,5, meio na transição 9,1 ms.
- `d7479ae2`, medido pelo usuário (Chrome, 29/10, desenho 854×407): quadros de 83, 67 e 83 ms em três
  cenários; relógio esperou 195 ms na deriva longa; primeira abertura 2.666 ms; geração 1.489 ms; pior
  recomposição 976 ms; 3 travadas de 233–767 ms ao abrir. Diagnóstico e correções na rodada de 2026-11-03.
- 2026-10-20 (rodada da noite, prévia `66ca7041`, Chromium com GPU real, pelo Claude Code): ver "Testes
  que o Claude Code rodou" acima. Resumo: todas as metas; pior recomposição 600 ms; relógio nunca
  esperou; 0 travadas em 5 min de 1× com placas 100% e com 12 tsunamis 9,5 seguidos.
- `58f53e79`, medido pelo usuário (Chrome): 60 fps, nenhum quadro > 50 ms, GPU ≤ 3,7 ms, memória 158 MB,
  geração 1,0 s, primeira abertura 2,3 s; relógio esperou 114 ms ("deriva longa"); 4 travadas de ~300 ms
  em 1× com placas 100%; pior recomposição 980 ms ("aplicar" 223 ms). Corrigidos na F3/F4.
- 2026-10-19 (correções E1–E13): no notebook, 150 s em 1× com placas 100% sem outra carga: 0 travadas.
  Recomposição no Node (N = 256, mesmo trecho): ~430 ms (placas 230 · clima 74 · cores 80 · aplicar 40)
  contra ~390 ms na RG. "Medir desempenho" do Claude Code **não vale** desta vez (o jogo do usuário
  estava aberto no Firefox, dividindo CPU e GPU): fica para o relatório do usuário (item 13).
- `d6443190`, medido pelo usuário: relógio esperou 81 ms em "desastres Muitos, 20×"; 195 travadas da
  data de 300–376 ms em 1× com placas 100% por volta das 07:27; recomposições ~650–720 ms. Na mesma hora
  o Claude Code rodava sondas e testes pesados no notebook.
- R1 (2026-10-18, Chrome, 1080p): 60 fps em todos os cenários, pior quadro 17 ms; **GPU do globo**
- Depois da C12 (2026-10-18, Chrome headless no notebook, 1080p): 60 fps em todos os cenários, pior quadro
  17 ms, **0 travadas** (a medição de GPU não conta mais); "desastres Muitos, 20×": relógio 240 passos/s,
  0,7 ms por passo, ocupado 16%; GPU: longe 2,2, de perto 4,1 (um quadro isolado de 18 ms na medição;
  na rodada anterior o pior foi 3,8), de perto andando 3,9, transição 5,2, meio andando 5,5, meio na
  transição 6,1, longe com desastres 3,0 ms; memória: dados 90 MB, página 181 MB; geração 0,85 s.
- `30e5e93`, medido pelo usuário (Chrome, notebook): 60 fps em todos os cenários (inclusive desastres
  "Muitos" 20×), pior quadro 36 ms, GPU ≤ 6,8 ms, memória 160 MB, geração 0,93 s; 6 travadas no rodapé
  (117–217 ms em 20× logo depois de recomposição; ~1 s em 1× mexendo na temperatura): em correção (C1).
- R9 (2026-10-18, Chrome headless no próprio notebook, 1080p): 60 fps em todos os cenários, inclusive
  "desastres Muitos, 20×" (placas 100%), pior quadro 17 ms; relógio nesse cenário 240 passos/s, 0,5 ms
  por passo, ocupado 12%; GPU: longe 2,9, de perto 4,3, de perto andando 4,6, de perto na transição 6,1,
  meio andando 6,8, meio na transição 7,6 (um quadro isolado 9,7), longe com desastres 3,4 ms; memória:
  dados 90 MB, página 180 MB.
- RG (2026-10-18, Chrome headless no próprio notebook, 1080p): 60 fps em todos os cenários, pior quadro
  17 ms; GPU do globo: longe 2,8 ms, de perto 4,3, de perto com placas andando 5,0 (pior 6,6), de perto
  na transição 6,8 (pior 8,2), meio andando 7,1 (pior 8,4), meio na transição 7,8 (pior 8,3); memória:
  dados ~84 MB, página 176 MB; geração ~0,9 s, primeira abertura 1,6 s; recomposição 330–520 ms,
  relógio sem esperar. As "travadas" de 200–350 ms no fim do relatório são da própria medição de GPU
  (40 desenhos seguidos esperando a GPU).
  longe ~4 ms, de perto parado ~4 ms, de perto com placas andando ~8 ms (14,6 ms na transição de 0,35 s
  depois de cada recomposição) — **acima da meta de 8 ms**; memória: dados ~78 MB, página 186 MB;
  geração 0,84 s, primeira abertura 1,59 s; recomposição ~320–510 ms, relógio sem esperar.
- `b3297292`, medido pelo usuário (Firefox, 1920×1080): mínimo 59–60 fps em todos os cenários, pior
  quadro 34 ms, nenhum acima de 50 ms, geração 0,96 s, primeira abertura 2,25 s. Faltaram GPU e memória.
- Fim do bloco Desastres (`b357aaa`), 1920×1080: "Medir desempenho" 60 fps em todos os cenários (com
  as nuvens), pior quadro 17 ms; desastres em "Muitos" a 20× com placas 100%: 60 fps, pior quadro
  16,7 ms, relógio a 240 passos/s sem esperar.
- 2026-10-17, 1920×1080: 60 fps (teto da tela) em todos os cenários, inclusive de perto e placas 100%;
  pior quadro 17 ms; geração 0,79 s (primeira abertura 1,48 s); recomposição ~330 ms, relógio sem
  esperar; clima ~88 ms no ajudante.

## Histórico: medições no celular (Infinix Hot 50i, fora do projeto desde 2026-10-17)
- Metas: pausado ≥ 85 fps; tempo rodando ≥ 60; placas em deriva ≥ 30 (nunca < 20); geração ≤ 3 s.
- `0155233d` (rodada depois do Bloco G, relatado pelo usuário): geração **2,8 s** (meta 3 s); metas de
  fps batidas; primeira abertura 5,0 s (antes 4,6); travadas 147 da tela e 11 da data, todas de
  110–130 ms, com placas 100% a 20× (tratado na rodada seguinte, falta medir).
- `f18969a2` (fim do Bloco G, relatado pelo usuário): geração **3,9 s (acima da meta; corrigido na
  rodada seguinte, falta medir)**; pausado parado 81 (a tela não desenha nada nesse cenário; a meta
  agora vale para "pausado, girando"); "relógio esperou 0 ms", mas o usuário viu a imagem engasgar e a
  data pular de 20 em 20 anos com placas 100% a 20×.
- `c0660ea5`:
- Pausado: 80 fps parado (**abaixo da meta**, antes 91; vigiar no próximo relatório), 91 girando.
- Tempo 20×, placas paradas: 91. Placas 100%: 82–85 (mín. 59). Deriva longa: 84. Ruptura forçada: 84.
- Geração: 2,7 s.
- Recomposição: 900–1.260 ms em média (placas 620–990 · clima ~170). Worker 192 passos/s em vez de
  240 (é o "tempo travando").

## Ressalvas conhecidas (G2/G3)
- O "supercontinente" é um aglomerado de continentes encostados, não uma massa compacta.
- Nas sementes `mundo` e `42`, às vezes o supercontinente volta em ~2 min; em geral, quando o critério
  de formas falha, é porque dois continentes colidiram e se soldaram logo depois da quebra (12 de 20
  sementes passam aos 3 min).

## Ideias registradas para marcos futuros (não fazer agora)
- 2026-10-18: M8 com lua (bolinha cinza orbitando) e sol (bola amarela ao fundo); furacão com cara de
  mapa de meteorologia.
- 2026-10-18: o semiárido da seca mais bonito com a ecologia (M3, `docs/04-ecologia.md`); referência
  da câmera em primeira pessoa: vídeo do Andrezitos com o WorldBox em 3D (`docs/02-marcos.md`).
- 2026-10-18: câmera em primeira pessoa de um indivíduo (M8 ou depois; depende das criaturas e do
  pseudo-3D).
- 2026-10-17: características do mundo em porcentagem; seca −30% de vida; furacão "puxa as coisas";
  terremoto destrói o que há em cima (`docs/04-ecologia.md`); nômades caçam depois de "dominar o
  fogo" (M4); eventos de exemplo da crônica: "Fim da Pangeia", "Ora, temos um Sócrates aqui",
  "Piromania" (`docs/07-cronica-nomes.md`).
- M3: escala do planeta × tamanho dos humanos (sem humanos de 1 pixel; 3 opções em `docs/02-marcos.md`);
  base do feedback ambiental; floresta grande afeta o clima; criaturas vistas de cima (confirmar na
  especificação do M3 que a vista de perto e a escala permitem).
- M6: floresta grande muda a doutrina de guerra.
- M3/M4: água potável; M4: humanos escavando revelam petróleo; M4/M7: fontes de energia para usinas.
- M3, M4 e M8: zoom maior que o de hoje, para caberem humanos pequenos (montanha de 50 pixels com homem
  de 5 fica estranho).
- T10 (neste marco): nuvens translúcidas que somem ao aproximar; tempestades e furacões em redemoinho
  alterando só o clima da região.
- M4: humanos começam nômades, com caça, antes da agricultura; uso econômico dos minerais; desmatamento; cidade sobre terreno que muda.
- M5: quatro classes sociais; crônica permanente.
- M6/M7: doutrinas de guerra, recursos estratégicos, consequências ambientais da guerra.
- M8: acabamento visual do menu de ferramentas; formações de erosão vistas de perto (pilares de
  arenito, "braços" de pedra).
