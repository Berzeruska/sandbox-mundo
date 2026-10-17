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
