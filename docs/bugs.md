# Bugs

Formato: data — como reproduzir — causa — correção — commit.

## 2026-10-16 — Vale de rifte entre duas montanhas fica com neve (celular, `9d5f101`)

- **Como reproduzir:** Elevar numa fenda entre dois continentes que se afastam (correção 1); o vale
  que se abre entre as duas montanhas pintadas aparece com neve.
- **Causa provável (a confirmar):** o fundo do vale fica só 300–800 m abaixo das bordas; entre
  montanhas altas ele continua acima da linha de neve.
- **Correção:** na T7 (clima e neve), por decisão do usuário. Feito em 2026-10-17: neve e geleira de
  montanha só com chuva ≥ 250 mm; o vale (mais baixo, 2–5 °C mais quente, e na sombra de chuva das
  bordas) tende a ficar sem neve. **Confirmar no celular** (lista do fim do bloco Minerais e clima).

## 2026-10-16 — "Elevar" numa fronteira de placa forma um buraco (celular, `c0660ea5`)

- **Como reproduzir:** semente `terra`, Elevar na fronteira entre duas placas em terra, placas 100%,
  tempo 20×. Em ~2 recomposições, uma linha azul-escura de 1 célula atravessa o morro e a cordilheira.
- **Causa:** fenda entre dois continentes que se afastam vira fundo oceânico (−2.500 m) já na primeira
  célula aberta; um rifte de verdade começa como vale. Detalhes em `docs/M2-especificacao.md`
  ("G2 — Teste no celular").
- **Correção:** vale de rifte até 3 células de largura; rifte parado fica como vale (`9d5f101`).

## 2026-10-16 — Placas no máximo travam o tempo (celular, `c0660ea5`)

- **Como reproduzir:** placas 100%, tempo 20×: a data para ~1 s a cada ~3,6 s.
- **Causa:** a recomposição (~1 s no celular) segura o worker do relógio, e o relógio só recupera
  0,25 s depois. Custo medido em `docs/M2-especificacao.md` ("G2 — Teste no celular").
- **Correção:** recomposição no ajudante 2 com memória compartilhada (correção 2); no notebook, 240
  passos/s com placas 100% e "relógio esperou 0 ms". Falta confirmar no celular (fim do Bloco G).

## 2026-10-15 — Continentes migram dos trópicos para os polos e a deriva morre (celular, `d36c156b`)

- **Como reproduzir:**
  - Semente `terra`, placas 100%, tempo 20×, 10 min de jogo.
  - A terra acima de 60° vai de 1% para 26%; a latitude média, de 23,5° para 36,2°.
  - Entre 6 e 10 min, todas as placas continentais entram num único grupo soldado.
  - A velocidade relativa média nas fronteiras cai de ~0,7 para 0,05–0,24.
  - Números das 5 sementes no Bloco G de `M2-especificacao.md`; mapas em
    `docs/img/m2-deriva-10min-*.png`.
- **Investigação (descartado):**
  - Movimento em lat/lon ou em coordenada de face: o movimento é rotação rígida em torno de um polo
    de Euler, e a latitude segue a conta exata com menos de 1° de diferença até as primeiras soldas.
  - Costuras do cubo: com todas as placas no mesmo eixo, cruzando várias faces, a fração de terra fica
    constante e a latitude bate com a conta em 3 min.
- **Causa:**
  - Os eixos iniciais em "balão" mandam as placas por grandes círculos que, com a Pangeia no equador,
    passam pelos polos.
  - Os eixos nunca mudam.
  - A solda é permanente e transitiva e congela a terra no meio da dispersão.
  - Achado junto: placas sem movimento relativo nenhum se soldam (6 soldas em 3 min no teste das
    costuras), porque o consumo de crosta por arredondamento conta como frente de colisão.
- **Correção (G1):**
  - A frente de colisão só conta com aproximação de verdade.
  - O contador de colisão desce sem frente.
  - Suturas somem sem contato continental.
  - Os grupos ganham polo de Euler novo a cada estágio.
  - Guarda polar a 65°, também na dispersão inicial (que encurtou para 20–25°).
  - Crosta consumida que ainda aparece em outra célula não morre mais (o "vazamento" de continente
    pela divisa).
- **Resultado:**
  - Na `terra` (N = 128), a terra acima de 60° aos 10 min caiu de 26% para 9,5%.
  - No teste das costuras, 0 soldas.
  - Testes em `tests/world/drift-latitude.test.ts`.
  - O G1 foi aprovado pelo usuário no celular (relatório `bcfba4b2`).
- **Correção (G2):** ciclo de Wilson. O supercontinente racha depois do mandato, e a deriva não
  morre: em 15 min, nas 5 sementes, um grupo só dura no máximo ~2,5 min.
- **Pendente:** confirmar o G2 no celular.

## 2026-10-15 — Lagos e costas com bordas retas, cantos de 90° e formas em V (celular)

- **Como reproduzir:** no celular do usuário, usar Rebaixar com pincel 29 (perto das bordas entre
  faces do cubo fica mais evidente). Surgem lagos/costas com bordas perfeitamente retas, cantos em
  90° e, perto de um canto do cubo, formas em V.
- **Investigação (descartado):**
  - Emenda na geração/clima: diferença média de elevação entre vizinhos dentro da face 42 m vs.
    entre faces 49 m; troca de bioma 2,8% vs. 2,3%. Sem emenda.
  - Pincel cortado na borda ou quadrado: pincel 29 sobre a borda das faces 0/4 mudou exatamente as
    3.344 células do círculo (faces 0 e 4), e sobre o canto as 3.264 (faces 0, 2 e 4), nenhuma fora
    do raio. Os **dados** sempre estiveram certos; o pincel já era um círculo na esfera.
- **Causa:** no desenho. Depois de cada pincelada, só um retângulo por face era reenviado à GPU,
  lido direto do array completo com `UNPACK_ROW_LENGTH` + `UNPACK_SKIP_PIXELS/ROWS` +
  `UNPACK_IMAGE_HEIGHT`. Alguns drivers de celular tratam esses parâmetros errado em texturas 3D:
  o retângulo recebe pixels de outro lugar da face, gerando bordas retas e cantos de 90°; onde os
  retângulos de três faces se encontram, num canto do cubo, aparece o V. Simulando um driver que
  ignora os parâmetros de "pular", o defeito descrito é reproduzido exatamente.
- **Correção:** o retângulo é copiado para um bloco contínuo (`packRect` em `src/render/dirty.ts`)
  e enviado sem nenhum parâmetro de desempacotamento especial. Com o mesmo driver defeituoso
  simulado, o desenho fica idêntico, pixel a pixel, ao correto. Testes novos: pincel sobre borda e
  sobre canto do cubo afeta as faces vizinhas e exatamente o círculo; `packRect` copia o retângulo
  certo.
- **Imagem:** `docs/img/bug-2026-10-15-antes-depois.png` (esquerda: antes; direita: depois).
- **Pendente:** confirmar no celular do usuário, pelo link publicado.

## 2026-10-15 — Celular trava em "Gerando mundo… 92–96% (cores)" para sempre

- **Como reproduzir:** abrir a prévia do marco-2 no celular do usuário. A barra para em 92–96%
  ("cores"), o relógio continua andando e o mundo nunca aparece. No notebook funciona.
- **Análise:** 92% é exatamente a soma das etapas antes de "cores", a última da geração. O relógio
  andando prova que o worker estava vivo. Então algo lançou uma exceção **em silêncio** logo no fim:
  no worker, depois da etapa "cores", ou na tela, ao receber o mundo (criação do desenho e
  compilação do shader). Ninguém escondia o "carregando" quando dava erro, então a espera nunca
  terminava.
- **Hipóteses:**
  1. *Cache do service worker misturando versões:* improvável, porque os arquivos do worker e da
     página têm hash no nome e uma página sempre carrega o próprio worker. Mesmo assim, agora a
     tela e o worker conferem a versão um do outro.
  2. *Shader novo (interpolação das placas) falhando na GPU do celular:* é a principal suspeita,
     porque o shader estreou nesta versão e é o que roda ao receber o mundo. Limites de recurso
     foram descartados por medição: o shader usa 93 vetores de uniforms (o mínimo garantido em
     celular é 224) e 5 texturas (mínimo 16). Ele compila na GPU do notebook e no SwiftShader (GPU
     por software, com limites mínimos). Sobram defeitos de compilador de driver de celular:
     vetores locais com índice dinâmico e laços com `break`, que o shader usava.
  3. *Worker sem memória:* possível; agora apareceria na tela como erro.
- **Correção:**
  - Shader reescrito sem vetores locais nem laços (candidatas e sondas desenroladas).
  - Se o shader completo falhar, o desenho cai sozinho num shader **simplificado** (sem
    interpolação: as placas andam aos saltos de 2 células, mas o jogo abre). O painel de depuração
    mostra "desenho: completo" ou "simplificado (motivo)", com o texto do erro do driver.
  - Nunca mais espera infinita: erro no worker, no shader ou em qualquer parte da tela abre uma tela
    "Algo deu errado" com o texto do erro (pode ser selecionado e copiado), a versão e o aparelho,
    e um botão "Tentar de novo" (limpa o cache do jogo e recarrega). Um vigia mostra a mesma tela se
    a geração passar 20 s sem dar notícia.
  - Protocolo com aperto de mão: o worker manda a versão dele; se não for a da tela, a página limpa
    o cache e recarrega sozinha uma vez (no máximo uma vez por minuto, para não entrar em laço) e,
    se persistir, mostra o erro.
- **Verificado no navegador:** GPU real e SwiftShader abrem com desenho completo; compilação do
  shader de placas forçada a falhar cai no simplificado e o jogo abre; os dois shaders falhando
  mostram a tela de erro; erro forçado no worker mostra o texto e a pilha; worker mudo mostra o erro
  do vigia em 20 s; versão diferente recarrega uma vez e depois mostra o erro; o botão recarrega.
  Movimento suave sem regressão (0 saltos, máximo 0,45% dos pixels por quadro).
- **Pendente:** confirmar no celular do usuário. Se ainda falhar, o texto da tela de erro (ou o
  "desenho: simplificado (motivo)") diz a causa exata.

## 2026-10-15 — Pedaços de placa que se soltam e colidem para sempre (celular caía a 5 fps)

- **Como reproduzir:** placas em 100%, tempo 20×, deixar 2–5 min. Pedaços de continente se soltam e
  ficam batendo uns nos outros sem parar; na vista "Ver placas", as fronteiras no oceano ficam cheias
  de fiapos e as placas mudam de forma. No celular o fps caía a 5–10 (somado ao desfoque atrás do
  painel Dados, ver D2).
- **Medição (sonda de 5 min, 5 sementes):** ~10% das trocas de dono de célula voltavam ao dono de duas
  recomposições antes (A→B→A), quase todas em fronteiras entre duas placas oceânicas; pares de placas
  colidindo por 11–14 recomposições seguidas sem soldar; pedaços de 1–4 células soltos.
- **Causas:**
  1. Entre duas oceânicas que se aproximam, quem mergulhava era decidido célula a célula (mais
     velha; empate, mais funda). A crosta inicial tem toda a mesma idade, então o desempate pela
     profundidade mudava de célula para célula: cada placa comia a outra num trecho e era comida no
     vizinho, trocando a cada recomposição (a oscilação).
  2. Cada placa girava em eixo fixo para sempre: continentes que se encontravam continuavam
     empurrando um contra o outro sem fim.
  3. A solda (1ª versão) só contava frentes de colisão de 3+ células: lascas pequenas que só raspavam
     nunca soldavam. Contando qualquer frente, placas quase só oceânicas com uma lasca de continente
     passavam a se soldar a continentes inteiros.
  4. Rotacionar a grade arredonda: a frente das placas tinha "dentes" de 1 célula que iam e voltavam,
     e a sobreposição sem aproximação real trocava de dona junto com o arredondamento.
  5. Pedaços pequenos eram absorvidos numa passada só; dois pedaços encostados trocavam de dona ao
     mesmo tempo e deixavam uma célula solta nova.
- **Correção:** polaridade da subducção por par de placas; solda só entre continentes de verdade
  (≥ 1,5% do planeta cada) depois de 8 recomposições de colisão; acreção da lasca continental da placa
  pequena na outra placa; histerese e preenchimento dos dentes de arredondamento; absorção de pedaços
  repetida até não sobrar nenhum. Detalhes em `docs/03-mundo-geologia.md` (D3).
- **Depois (mesma sonda):** zero pedaços soltos em qualquer recomposição; nenhuma colisão passa de 8
  recomposições; trocas A→B→A no pior caso 0,02–0,08% das células (arredondamento de 1 célula na linha
  da fronteira). Critério de "bonito" mantido em N = 256 aos 2 min: 5–7 continentes, o maior com no
  máximo 37% da terra. Teste automático de 5 min no CI. "Medir desempenho" ganhou o cenário "deriva
  longa c/ colisões" (60 s), com soldas e pedaços absorvidos no relatório.
- **Imagem:** `docs/img/m2-placas-antes-depois.png` (semente "mundo", 2 min; esquerda antes, direita
  depois; em cima o mapa, embaixo a vista de placas).
- **Pendente:** confirmar no celular do usuário.

## Imagem engasga e data pula com placas 100% a 20× (2026-10-16, `f18969a2`)
- **Como reproduzir:** Hot 50i, placas 100%, tempo 20×. A imagem engasga e a data pula de 20 em 20
  anos, mas o relatório diz "relógio esperou 0 ms".
- **Causa:** em investigação. O "relógio esperou" só mede o relógio parado à espera do ajudante; não
  mede quadros lentos da tela nem a tela aplicando uma recomposição. No notebook não aparece.
- **Correção:** registro de travadas no painel Dados (hora, duração e causa provável de cada uma), para
  o próximo teste no celular dizer de onde vem.
- **2026-10-17 (`0155233d`):** o registro mostrou 147 travadas da tela e 11 da data, todas de
  110–130 ms, "fora do jogo". Achado: o ajudante 2 criava e jogava fora ~117 MB por recomposição
  (N = 256), forçando limpeza de memória o tempo todo. Reduzido para ~20 MB (−83%), recomposição 24%
  mais rápida, mesmo mundo (detalhes na especificação do M2, "Teste da rodada no celular"). Não dá para
  provar no notebook que era a causa (lá não trava); o registro agora mostra "recomposição há X s" em
  cada travada para o próximo teste separar limpeza de memória, GPU e disputa de núcleos.

## 2026-10-17 — "Elevar" sobe uma listra em vez de um morro (celular, `0155233d`)
- **Como reproduzir:** painel Dados → "Girar (fps)" ligado; fechar o painel; Elevar e segurar o dedo
  num ponto. Sai uma faixa leste–oeste atravessando o continente.
- **Causa:** o giro de teste continuava com o dedo na tela (a inércia parava no toque; o giro de teste
  não). O pincel é aplicado a cada quadro no ponto embaixo do dedo, e o globo andava por baixo dele.
- **Correção:** qualquer toque no globo desliga o giro de teste (o botão volta a "Girar (fps)").
  Conferido no notebook: só o morro no ponto tocado. Se a listra aparecer com o giro desligado, é outro
  caso.

## 2026-10-17 — Pontos azul-forte e rosa no gelo e nas montanhas nevadas (notebook, `50f0dca`)
- **Como reproduzir:** clima frio (ou gelo pintado com o pincel); olhar a calota e os picos nevados.
  Mais pontos no gelo pintado (mais alto, mais claro).
- **Causa:** a cor do gelo claro (bioma claro × brilho de altitude × sombreado + variação) passava de
  255, e a textura de cores é `Uint8Array`, que dá a volta em vez de prender (260 vira 4): um canal ia
  a quase 0 e a célula ficava rosa ou azul. Não era o limite de 16 biomas (são 16, cabem nos 4 bits).
- **Correção:** cada canal preso em 0–255 antes de gravar (`clampByte` em `src/render/colors.ts`);
  teste em `tests/render/colors.test.ts` (falha sem a correção).

## 2026-10-17 — Ruptura forçada podia aparecer 1 passo atrasada com o ajudante 2 atrasado (achado nos testes)
- **Como reproduzir:** teste "o mundo é o mesmo com o motor no relógio ou num ajudante atrasado"
  (`tests/sim/geology.test.ts`) depois da T9: com o ajudante "muito atrasado", a recomposição da
  ruptura do passo 12.000 aparecia no 12.481 em vez do 12.480, e o mundo divergia dali em diante.
- **Causa:** o comando de ruptura era carimbado com o passo atual do relógio, que já tinha rodado. Se
  nesse mesmo passo outro comando (uma erupção, que ergue o terreno) fazia o motor avisar "terminei o
  passo T", a ruptura chegava depois com o mesmo passo T e entregava uma recomposição de T que o
  relógio já não esperava. Existia antes; os desastres só mudaram a ordem das mensagens.
- **Correção:** a ruptura vale no passo seguinte (T + 1); e o motor, enquanto um comando do passo T
  espera, só avisa T − 1. O commit `ec4976c` foi publicado com este teste falhando (o encadeamento do
  commit não olhou o código de saída do `npm run check`); corrigido no commit seguinte.

## 2026-10-19 — Visão desligando sozinha / mundo escurecendo do nada (notebook, `d644319`, E9/E5)
- **Como reproduzir:** placas andando; ligar ou desligar "Ver placas" ou "Ver recursos". Uns segundos
  depois a visão some (ou volta: "Ver recursos" acinzenta e escurece o terreno) sem tocar em nada.
- **Causa:** o ajudante 2 pinta as cores de cada recomposição com as visões que valiam quando ela
  começou, e o relógio a mostra APPLY_DELAY_TICKS passos depois. Ao aplicar, o relógio copiava essas
  cores sem conferir as visões. Junto: o halo das jazidas ("Ver recursos") guardado no relógio não era
  refeito quando as jazidas andavam.
- **Correção:** o resultado leva as visões com que foi pintado; se forem outras, o relógio repinta com
  as de agora; o halo é refeito a cada recomposição (`src/sim/core.ts`). Teste em
  `tests/sim/core.test.ts` ("visão ligada no meio de uma recomposição…", falha sem a correção).
  Também entra o "um efeito por vez" (decisão do usuário): duas visões juntas não existem mais.

## 2026-10-19 — Tempestade de areia no mar (notebook, `d644319`, E4)
- **Como reproduzir:** tempestade natural num deserto perto da costa, ou provocada em qualquer terra.
- **Causa:** a poeira desenhada vai até ~2,5 raios do centro (o shader a alonga no sentido do vento),
  bem além da área de efeito (0,8 raio), e o caminho seguia pelo vento até o mar. O jogador podia
  provocar em qualquer terra.
- **Correção:** nasce só em deserto ou seca com espaço até a água; o raio de cada ponto do caminho é o
  que cabe em terra (conferido célula a célula perto da costa) e ela se desfaz antes do mar; o jogador
  provoca no deserto ou seca mais perto do toque (até 6 células), senão nada
  (`src/world/disasters/sandstorm.ts`). Testes em `tests/world/sandstorm.test.ts`.

## 2026-10-19 — Clima e gelo mudando de uma vez (notebook, `d644319`, E6)
- **Como reproduzir:** meteoro gigante; ou o controle de temperatura subindo até +10 °C.
- **Causa (medida):** (1) o inverno do impacto entrava inteiro num passo (−3 °C e o mar −50 m: 58% das
  células trocavam de cor num quadro) e a volta aparecia 40 anos atrasada (o resultado do ajudante 2
  entra 480 passos depois); (2) em terra, o brilho pela altura e os degraus do relevo contavam do
  nível do mar atual: cada degrau de 10 m do mar deslocava os degraus do mundo inteiro (16% das
  células mudando de uma vez).
- **Correção:** o frio do impacto chega em 3 anos e é cuidado só pelo relógio, em degraus de 0,5 °C,
  sem mexer no nível do mar; em terra, altura e degraus contam do nível de base do mar
  (`src/world/climate.ts`, `src/sim/core.ts`, `src/render/colors.ts`). Depois: 5–7% das células por
  degrau de 0,5 °C, e 1–2% de mudança visível por degrau do mar. Teste em `tests/world/meteor.test.ts`.

## 2026-10-19 — Ciclone 1 dura ~1 s, Furacão 5 ~10 s (notebook, `d644319`, E7)
- **Como reproduzir:** provocar em terra perto da costa.
- **Causa:** o furacão do jogador perdia em terra a mesma força por passo em qualquer categoria; a
  categoria 1 tinha pouca força para gastar (1,5–8 s medidos), a 5 chegava a 9–15 s.
- **Correção:** o do jogador segura a força em terra por um tempo que cresce com a categoria (1: +2 s;
  2: igual, aprovado; 3: +4 s; 4: +8 s; 5: +12 s), com o teto de 24 s (`PLAYER_LAND_HOLD`). Teste em
  `tests/world/hurricane.test.ts`.

## 2026-10-19 — Gelo derretido por vulcão não voltava com as placas andando (revisão E13)
- **Como reproduzir:** vulcão acordando sob o gelo com as placas a 100%; desastres desligados; esperar
  200 anos num lugar frio. O gelo apagado continua apagado.
- **Causa:** o modo do gelo (pintado/apagado) fica no lugar, não anda com a placa; a agenda da volta
  andava com a placa e, na hora, devolvia outra célula.
- **Correção:** a agenda também fica no lugar (`src/world/disasters/index.ts`). Teste em
  `tests/world/ground.test.ts`. Sonda de 600 anos com tudo ligado + 500 de calma: 0 células sobrando.

## 2026-10-19 — Estados do chão escondidos em água e gelo (revisão E13)
- **Como reproduzir:** seca, lama do tsunami ou areia; depois o mar sobe (ciclo glacial, costa raspada)
  ou o gelo cobre a célula. O estado ficava lá, invisível, até vencer.
- **Correção:** na passagem anual, estado de terra firme sai se a célula virou mar; seca, fogo, cinzas e
  areia saem debaixo do gelo; lava e basalto ficam (`src/world/disasters/ground.ts`). Teste em
  `tests/world/ground.test.ts`.

## 2026-10-19 — Tempestade de areia no mar e em outros biomas; não funciona no deserto quente (notebook, `58f53e79`, F1)
- **Como reproduzir:** Desastres → Tempestade de areia, tocar num deserto quente (faixa perto da costa):
  nada acontece ou some em ~1 s. Num deserto frio grande: a poeira passa por cima de campo e floresta e,
  com as placas andando, encosta no mar.
- **Causa:** a E4 só conferia água, com um círculo menor que a elipse desenhada, no mundo do relógio
  (o globo desenha as placas até ~3 células à frente); "lugar seco" não era regra. Os desertos quentes
  são estreitos e o vento sopra para a costa: a tempestade não cabia para nascer e se desfazia logo.
- **Por que o teste não pegou:** repetia o mesmo círculo do código, só olhava água, nunca tocava num
  deserto quente e o mundo do teste ficava parado (detalhes em `docs/M2-especificacao.md`, F1).
- **Correção:** bit da areia seca na textura de cores (`SAND_BIT`) e poeira só nessas células no
  shader; o centro anda só sobre areia seca e para na borda; raio pelo espaço até a borda
  (`src/world/disasters/sandstorm.ts`, `src/render/colors.ts`, `src/render/shaders.ts`). Testes em
  `tests/world/sandstorm.test.ts` (desertos quentes e frios em N = 256) e `tests/render/colors.test.ts`.

## 2026-10-19 — Tsunamis 9,5 seguidos travam o jogo (notebook, `58f53e79`, F3)
- **Como reproduzir:** Desastres → Tsunami M 9,5, tocar várias vezes seguidas no mar (em 20× fica pior).
  A tela continua lisa, mas o mundo congela (o relógio para) e a ventoinha dispara.
- **Causa:** (1) a costa raspada de um M 9,5 (costas do mundo todo) passava pelo pincel como uma área do
  tamanho do planeta e refazia o clima inteiro num passo (~430 ms por tsunami); (2) o plano da onda pelo
  oceano inteiro (~270 mil células) era feito de uma vez no toque (~200–300 ms).
- **Correção:** clima refeito só em volta das células raspadas (`applyTerrainDeltas(..., local)` em
  `src/input/tools.ts`); plano da onda em pedaços de 25 mil células por passo com memória contínua
  (`TsunamiPlanner` em `src/world/disasters/tsunami.ts`), um por vez. Testes em
  `tests/world/tsunami.test.ts`.

## 2026-10-19 — Tsunami e incêndios do meteoro (e fogo da lava) nunca andavam (achado na F3)
- **Como reproduzir:** meteoro Médio ou maior no mar: aparece o aviso "Tsunami do meteoro", mas a onda
  não vem. Meteoro em floresta: nenhum incêndio.
- **Causa:** o processo nascido dentro do passo de outro processo era posto na lista antiga, que em
  seguida era trocada pela filtrada (`this.processes = this.processes.filter(...)`), sem o novo.
- **Correção:** os novos entram depois dos que já andavam (`src/world/disasters/index.ts`). Testes em
  `tests/world/meteor.test.ts` (falham no código antigo). O teste de incêndios naturais esperava só
  "raio" e "lava" porque o do meteoro sumia; pelo desenho (C12), o meteoro também acende.
