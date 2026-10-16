# M2 — Especificação do Marco 2: geologia viva

Pré-requisito: Marco 1 concluído (`v1.0`).
Branch: `marco-2`.
Estado: **aprovada pelo usuário em 2026-10-15** (decisões no fim do documento). A T1 (menu) só é
codada depois que o usuário aprovar o esboço do layout.

## Objetivo
A Pangeia se parte em continentes que derivam com velocidade controlada pelo jogador (inclusive
zero). As colisões erguem montanhas, as dorsais abrem oceanos, e terremotos, vulcões, tsunamis e
desastres climáticos surgem onde a geologia e o clima indicam. Tudo roda num Web Worker: a tela
nunca trava, nem em velocidade máxima, nem no celular.

## Como vai funcionar (visão de jogador)
- Todas as ferramentas ficam num **menu por categorias** (Tempo, Relevo, Desastres, Geologia, Clima).
  Na tela fica só a ferramenta escolhida e um botão de pausa sempre visível.
- Um controle **"Placas"** (0 a máximo) define a velocidade da deriva. No máximo, com o tempo em 20×,
  a Pangeia se parte em **~2 minutos reais**. Em 0 a geologia congela, mas o clima e os desastres
  climáticos continuam.
- Um controle de **frequência de desastres** (de "nenhum" a "muitos"), com padrão **"raro"** (um
  desastre notável a cada ~1–2 minutos em 1×).
- Um controle de **temperatura global** (deus), somado ao ciclo glacial automático e suave.
- Uma camada **"Ver placas"** desenha as fronteiras coloridas por tipo: convergente (vermelho),
  divergente (azul) e transformante (amarelo).
- Desastres aparecem no globo (ondas, cinzas, trilha de furacão, área queimada). Só os **grandes**
  geram aviso na tela; a **lista completa** fica no painel. Tocar num aviso leva a câmera até o lugar.
- **Vulcão muda o relevo para sempre** (pode criar ilha); os demais desastres deixam marcas
  temporárias que se recuperam.
- O jogador pode provocar qualquer desastre manualmente, com ferramentas novas na barra.
- Pincéis do M1 continuam valendo. Uma montanha pintada viaja junto com a sua placa.
- Uma camada **"Ver recursos"** (menu Geologia) mostra os depósitos minerais e de petróleo, que
  nascem onde a geologia real os formaria e viajam com as placas.

## Modelo técnico (resumo; detalhes viram decisões registradas durante as tarefas)

### Web Worker
- O estado do mundo, o relógio, a geração, o clima, as placas e os desastres passam a viver num
  Web Worker. A thread principal fica só com câmera, entrada, interface e a cópia das cores.
- Comunicação por mensagens com buffers transferíveis (sem cópia). O worker manda **remendos**:
  retângulos de cores alteradas, que reaproveitam o envio parcial já corrigido no M1. A thread
  principal manda comandos: pincel, novo mundo, velocidade, provocar desastre.
- Sem `SharedArrayBuffer`: ele exige cabeçalhos HTTP que o GitHub Pages não permite configurar.

### Placas
- De 8 a 14 placas por mundo (sorteadas pela semente), formadas por um Voronoi na esfera deformado
  por ruído, para as fronteiras não ficarem retas.
- Cada célula pertence a uma placa e tem tipo de crosta: continental (terra e plataforma) ou
  oceânica, além de idade e espessura.
- A Pangeia é dividida entre várias placas (pelo menos 3), para que ela se parta.
- Cada placa gira em torno de um eixo próprio (polo de Euler), com velocidade angular sorteada e
  multiplicada pelo controle do jogador.

### Movimento sem deformar os continentes
- Cada placa guarda a sua crosta no **próprio referencial**: o continente não é recopiado de célula
  em célula a cada passo, o que acumularia erro e "derreteria" a forma dele.
- Quando as placas andam o suficiente (~meia célula), o mapa global é recomposto. Para cada célula,
  pergunta-se qual placa a cobre agora, testando primeiro a dona anterior. Assim quase toda célula
  custa uma consulta só.
- **Divergência** (buraco entre placas): nasce crosta oceânica nova na dorsal (~-2.500 m), que
  afunda com a idade.
- **Convergência** (duas placas na mesma célula):
  - oceânica contra continental: a oceânica afunda (subducção), forma-se uma fossa no mar e um arco
    vulcânico em terra;
  - continental contra continental: colisão que ergue cordilheira;
  - oceânica contra oceânica: a mais velha afunda e nasce um arco de ilhas.
- **Transformante:** deslizam lado a lado e só acumulam tensão.
- Erosão leve: picos isolados baixam devagar, para o planeta não virar só montanha ao longo de
  milhões de anos.

### Clima acompanhando a deriva
- O clima é recalculado por inteiro no worker de tempos em tempos (~150 ms no notebook) e entre
  um recálculo e outro, só onde o terreno mudou.
- Eras glaciais leves: um ciclo lento e automático de temperatura global faz o gelo avançar e recuar;
  o controle de temperatura global do jogador soma a esse ciclo.

### Desastres (todo desastre tem probabilidade base, intensidade, área e duração)

| Desastre  | Onde surge | Gatilho | Efeito no M2 (ainda sem vida) |
|-----------|------------|---------|-------------------------------|
| Terremoto | fronteiras de placa | tensão acumulada passa do limite | tremor visível; libera tensão; magnitude pela tensão e área |
| Vulcão | arcos de subducção, dorsais (fraco), pontos quentes | tensão + aleatório semeado | ergue terreno, pode criar ilha; cinzas temporárias em volta |
| Tsunami | costa perto de terremoto submarino forte | terremoto no oceano | onda que se espalha pelo mar; costa baixa alagada por um tempo |
| Seca | regiões secas ou sob anomalia | anomalia de chuva negativa | biomas ressecam temporariamente |
| Enchente | vales e planícies úmidas e baixas | anomalia de chuva positiva | terra baixa alagada por um tempo |
| Furacão | oceano tropical quente | mar quente (latitude ~8–20°) | trilha para oeste, curva para o polo, enfraquece em terra |
| Incêndio | florestas secas | seca + calor | floresta vira área queimada e se recupera em décadas |

- **Pontos quentes** ficam fixos no manto, então a placa passa por cima e forma **cadeias de
  ilhas**, como o Havaí.
- Efeitos temporários ficam numa camada de "perturbação" por célula, que se recupera com o tempo.
  Vegetação e vida de verdade só chegam no M3.
- Toda aleatoriedade vem da semente do mundo: mesma semente + mesmos comandos = mesmos desastres.

## Proposta: costas recortadas pela geologia (geração v2 aceita pelo usuário em 2026-10-15, opção a)
Decisão: entrou a geração v2 (ruído costeiro + bacias internas); a mesma semente passa a gerar um
mundo inicial diferente do da v1.1. O recorte pela geologia segue com as placas (T5 e D3).

Pedido do usuário (2026-10-15): baías, penínsulas, arquipélagos e ilhas pequenas, no estilo de Europa
e Ásia. A ideia é que o recorte **nasça da geologia** ao longo do tempo, e não de enfeite.

### O que cabe na resolução atual
N = 256 → cada célula tem **~33–39 km** num planeta do tamanho da Terra (1.024 células no equador).
O menor detalhe que se lê como forma tem ~3 células (~110 km); 1 célula aparece como um ponto.
| Cabe bem (≥ 3 células) | Cabe como ponto ou traço (1–2 células) | Não cabe (< 1 célula) |
|---|---|---|
| Itália, Grécia continental, Crimeia, Jutlândia, Coreia, Kamchatka | Creta, Chipre, Córsega, ilhas menores do Havaí, ilhas de arcos (Antilhas, Aleutas) | Fiordes, ilhas do Egeu e da Dalmácia, recifes e atóis pequenos |
| Mar Vermelho, Adriático, Golfo Pérsico, Mar do Japão, Báltico, Golfo de Biscaia | Canal da Mancha (como canal de 1 célula), Golfo da Califórnia estreito | Estreitos de Bósforo e Gibraltar (viram 1 célula exagerada ou fecham) |
| Japão, Filipinas, Indonésia (ilhas grandes), Sri Lanka, Taiwan | | Deltas e lagunas em detalhe |
O deslocamento orgânico do shader (T13) deixa as costas curvas abaixo de 1 célula, mas não cria
ilhas novas. Para fiordes e ilhotas seria preciso N = 512 (~20 km, 4× as células e a geração) ou
a camada de detalhe local que é questão aberta do M3.

### Mecanismos propostos (cada um no lugar onde a geologia o cria)
1. **Riftes e microcontinentes (T5):** onde uma placa continental se abre, nasce um mar estreito e
   comprido (como o Mar Vermelho) e, às vezes, uma lasca de continente se solta e vira ilha grande
   (como Madagascar, Japão, Córsega–Sardenha). Cria golfos, penínsulas e ilhas grandes.
2. **Arcos de ilhas em colisão oceano–oceano (T5/T9):** a placa mais velha afunda e, ~100–200 km
   atrás da fossa, nasce uma fileira de vulcões que vira cadeia de ilhas de 1–3 células espaçadas
   (Antilhas, Aleutas, Marianas). Atrás do arco pode abrir uma **bacia de retroarco** (Mar do Japão).
3. **Cadeias de pontos quentes (T9):** o ponto quente fica parado e a placa passa por cima, deixando
   uma fileira de ilhas que envelhecem, erodem e afundam (Havaí); as mais velhas viram baixios.
4. **Plataforma continental alagada e nível do mar (T7):** a borda rasa dos continentes fica perto
   do nível do mar; quando o gelo derrete nas eras quentes, o mar sobe e alaga as planícies baixas,
   criando mares rasos, baías e ilhas (como o Mar do Norte e a Plataforma de Sunda); nas eras frias
   recua e reconecta. As costas mudam com o clima.
5. **Colisões continentais (T5):** além das cordilheiras, criam mares interiores e golfos na frente
   das montanhas (como o Golfo Pérsico) e penínsulas entre zonas de colisão (Itália, Grécia).
6. **Ruído fino só na faixa costeira (geração):** acrescentar detalhe de alta frequência (período de
   2–3 células) e pequena amplitude (±100–200 m) só onde o terreno está perto do nível do mar; células
   na beira viram terra ou água e surgem baías e ilhotas de 1–3 células. É o único item que muda o
   **mundo inicial**.

### Decisão necessária antes de implementar o item 6
Mudar a geração faz a mesma semente gerar costas diferentes das da v1.x. Opções:
- **(a)** aceitar a mudança agora, registrando uma "versão de geração" (sementes antigas passam a dar
  mundos com costas mais recortadas);
- **(b)** manter o mundo inicial idêntico e deixar todo o recorte surgir com o tempo (itens 1–5),
  partindo de uma Pangeia de costa mais lisa.
Recomendação: (a), porque a Pangeia inicial também deve ter costa recortada e o M2 já muda como os
mundos evoluem.

## Tarefas (fazer em ordem; cada uma = um commit)

- [x] **T1 — Menu de ferramentas por categorias** (`src/ui/`)
  Um botão abre um menu por categorias e o jogador escolhe o que fica ativo:
  - **Tempo:** pausa e velocidades;
  - **Relevo:** mover, elevar, rebaixar, água, gelo, derreter, tamanho do pincel;
  - **Desastres:** provocar cada desastre e frequência (as ferramentas chegam nas T8–T11);
  - **Geologia:** velocidade das placas (chega na T4) e camada de recursos (chega na T6);
  - **Clima:** temperatura global (chega na T7).
  Na tela fica só a ferramenta escolhida e um atalho de pausa sempre visível. Confortável no celular
  com uma mão; não pode cobrir o planeta mais do que a v1.1. **Esboço do layout aprovado pelo usuário
  antes de codar.** Ferramentas de tarefas futuras aparecem desativadas ("em breve") até a tarefa delas.
  Esboço aprovado: `docs/img/m2-t1-esboco-menu.png`. Feito: menu fechado cobre 8,8% da tela do
  celular (v1.1: 24,3%); aberto ~50%, só enquanto aberto.
  Testes: estado do menu (categoria aberta, ferramenta ativa, troca de categoria) em lógica pura.
  Verificação manual: celular com uma mão e notebook; área coberta medida e comparada à v1.1.

- [x] **T2 — Simulação no Web Worker** (`src/sim/worker.ts`, `src/sim/protocol.ts`)
  Mover o mundo, o relógio, a geração, o clima e os pincéis para o worker. A thread principal recebe
  os remendos de cor e manda comandos.
  Testes: codificar/decodificar mensagens; o mundo gerado no worker é idêntico ao da thread principal
  (mesma semente).
  Verificação manual: pincel e novo mundo funcionam como na v1.1 e a tela não trava durante a geração.

- [x] **T3 — Placas** (`src/world/plates.ts`)
  Voronoi deformado, tipo de crosta, eixos e velocidades pela semente. Camada "Ver placas".
  Testes: toda célula tem placa; cada placa é contígua; número de placas dentro da faixa; a Pangeia
  cobre ≥ 3 placas; determinismo.

- [x] **T4 — Movimento, recomposição e controle "Placas"** (`src/world/tectonics.ts`)
  Crosta no referencial da placa, recomposição global, controle de velocidade em Geologia (0 congela).
  Ritmo: no máximo, com o tempo em 20×, a Pangeia se parte em ~2 minutos reais.
  Testes: velocidade 0 não muda nada; uma placa sozinha gira sem deformar (forma preservada dentro
  de uma tolerância); área total de crosta conservada sem fronteiras ativas; determinismo.

- [x] **T5 — Fronteiras e relevo**
  Classificação convergente/divergente/transformante; dorsais com profundidade pela idade;
  subducção com fossa; colisão erguendo montanhas; rifte continental; erosão leve.
  Testes: em cenários sintéticos de duas placas, montanha/fossa/dorsal aparecem onde devem; em
  10.000 passos a fração de terra fica entre 20% e 40% e nada vira NaN.
  Critério de "bonito" do usuário (2026-10-15): depois da Pangeia se partir, 4 a 7 continentes de
  tamanhos variados, com penínsulas, golfos e mares internos, fronteiras irregulares, nenhum com mais
  de ~40% da terra. Feito: 5 sementes fixas passam em 1 e 2 min (imagens em `docs/img/m2-formas-*`).

### Desempenho no aparelho-alvo (pedido do usuário em 2026-10-15; T6 congelada até terminar)

Aparelho: Infinix Hot 50i (Helio G81, Mali-G52 MP2, 720p 120 Hz). Medição do usuário antes:
pausado 91 fps; tempo rodando com placas paradas ~48; placas se afastando 27–39 (pior 10);
colisões pior 5; geração 4.000 ms no painel (6–7 s percebidos). Metas: pausado ≥ 85; tempo
rodando ≥ 60; deriva ≥ 30, nunca abaixo de 20; geração ≤ 3 s. Sem opção de qualidade.

- [x] **D1 — Botão "Medir desempenho"** (painel Dados): roda sozinho, em ~2 min, pausado parado,
  pausado girando, tempo 20× com placas paradas, tempo 20× com placas 100% (também com o painel aberto, com e sem o desfoque antigo), deriva
  longa com colisões (60 s) e geração de mundo.
  Relatório em texto com botão de copiar: fps médio, mínimo (pior janela de 1 s), pior quadro e
  quadros acima de 50 ms por cenário; trabalho da tela por quadro; worker (passos/s, ms por passo,
  ocupação, recomposições divididas em placas/clima/cores/envio); geração por etapa; GPU detectada.
- [ ] **D2 — Tempo rodando sem placas ≥ 60 fps:** o worker trabalha só o necessário e não manda
  atualização à tela sem mudança. *Implementado, aguardando o relatório do aparelho:* o 1º relatório
  (5d83bca) deu 91 fps com o painel escondido e worker 0% ocupado, então o worker não era a causa;
  suspeita principal: o desfoque por trás do painel Dados (onde o usuário lia o fps). Desfoque
  removido; worker dorme quando pausado; relógio à tela no máximo 10×/s (61 → 9 mensagens/s; tela
  2,8 → 1,2 ms por quadro com CPU 6× mais lenta). O medidor ganhou cenários com o painel aberto com e
  sem o desfoque antigo, para confirmar no aparelho, e o tempo da primeira abertura.
- [x] **D3 — Placas com tamanho e identidade fixos:** continentes que colidem se soldam e erguem
  cordilheira; fragmento pequeno gruda na placa maior; nada de pedaços colidindo para sempre
  (achar a causa da oscilação). *Causas e correção:* ver `docs/bugs.md` (2026-10-15, pedaços de
  placa) e 03-mundo-geologia (D3). Teste automático de 5 min a 20× e 100% sem pedaços soltos;
  "Medir desempenho" com cenário de deriva longa com colisões.
- [x] **D4 — Shader de deriva mais leve para a Mali-G52.** Candidatas na textura de placas, atan por
  polinômio, texturas reaproveitadas. Encerrada pelo usuário: o relatório já bate as metas.
- [x] **D5 — Geração ≤ 3 s no aparelho.** Relatório: 2,7 s (sem mudança necessária).

- [ ] **T6 — Recursos minerais e petróleo** (`src/world/resources.ts`)
  Depósitos de ferro, cobre, ouro, nióbio, petróleo, carvão (e outros) gerados pela geologia real:
  cobre (e ouro) em arcos de subducção; ferro (e ouro) em crátons antigos; petróleo e carvão em bacias
  sedimentares; nióbio em carbonatitos raros. Cada depósito pertence a uma placa e **se move com ela**.
  Camada opcional "Ver recursos" no menu Geologia. Determinístico pela semente.
  Só a geração e a visualização; o **uso** fica para os Marcos 4 (economia) e 7 (militar).
  Testes: cada tipo só aparece no ambiente geológico certo (ex.: nenhum cobre longe de subducção
  antiga ou atual); nióbio é raro (abaixo de um limite de depósitos); depósitos acompanham a placa
  (após girar uma placa, os depósitos dela giram junto); mesma semente, mesmos depósitos.
  Detalhes em `docs/03-mundo-geologia.md`.

- [ ] **T7 — Clima que acompanha a deriva, eras glaciais e temperatura global**
  Recálculo periódico no worker e envio só do que mudou; ciclo glacial automático e suave; controle
  de temperatura global em Clima, somado ao ciclo.
  Testes: o recálculo parcial bate com o total; a área de gelo cresce com a temperatura global
  menor e recua com ela maior; ciclo e controle se somam.

- [ ] **T8 — Terremotos e tsunamis** (`src/world/disasters/`)
  Tensão nas fronteiras, liberação e magnitude; tsunami que se propaga no oceano e alaga costa baixa
  temporariamente; desenho das ondas na camada sobreposta.
  Testes: terremotos só perto de fronteiras; tsunami só a partir de terremoto no mar e forte;
  efeitos temporários se recuperam; determinismo.

- [ ] **T9 — Vulcões e pontos quentes**
  Arcos de subducção, dorsais (fraco), pontos quentes fixos; erupção ergue terreno **para sempre**
  (pode criar ilha) e espalha cinzas temporárias.
  Testes: ponto quente sob placa em movimento forma uma cadeia de ilhas; erupções só em lugares
  permitidos; relevo vulcânico persiste e as cinzas somem.

- [ ] **T10 — Desastres climáticos**
  Anomalias de chuva (seca, enchente), furacões com trajetória, incêndios; perturbação temporária
  com recuperação.
  Testes: furacão só nasce em oceano tropical quente e enfraquece em terra; incêndio só em floresta
  sob seca; frequências dentro da faixa esperada em 1.000 anos simulados.

- [ ] **T11 — Desastres na mão do jogador e frequência**
  Em Desastres: ferramenta para provocar cada desastre e controle de frequência (nenhum → muitos),
  padrão "raro". Camadas "Ver placas" e "Ver tensão".
  Testes: frequência 0 não gera desastre natural; "raro" fica na faixa de ~1 notável a cada 1–2 min
  em 1×; provocar manualmente funciona com qualquer frequência.

- [ ] **T12 — Avisos e lista de desastres**
  Aviso curto só para desastres grandes; lista completa no painel; tocar leva a câmera ao local.
  (Não é a crônica permanente, que fica no M5.)

- [ ] **T13 — Teste longo de estabilidade**
  Teste automático: partindo da Pangeia, em velocidade padrão, depois de X passos existem ≥ 3
  continentes grandes, a fração de terra está entre 20% e 40%, há montanhas, nenhum valor inválido,
  e os desastres aconteceram nas quantidades esperadas.

- [ ] **T14 — Medição de desempenho e comparação com a linha de base**
  Placas no máximo + tempo no máximo: tela ≥ 30 fps no celular (≥ 60 no notebook). Medir nas mesmas
  condições da linha de base da v1.1 (`docs/decisoes.md`) e comparar. Medir também quantos passos por
  segundo o worker aguenta. Registrar em `docs/decisoes.md`.

## Bloco G — Deriva viva, latitude e formas (pedido do usuário em 2026-10-15, noite)
Teste da `d36c156b` no celular: a oscilação sumiu, mas sobraram três problemas de design. Pedido:
diagnóstico medido e especificação **antes** de codar. Prioridade: G1 (latitude), G2 (ciclo de
Wilson), G3 (formas). Desempenho só vale medido no Hot 50i. T6 segue congelada.

**Como foi medido:** sonda fora do repositório (vitest no scratchpad), 5 sementes (`terra`, `mundo`,
`7`, `42`, `ilha`), N = 128, placas 100%, tempo 20×, 10 min de jogo (144.000 passos), amostra a cada
7,5 s. Médias de latitude **pesadas pela área da célula** (as células equiangulares não têm área
igual). "Linha de base rígida": a crosta continental inicial girada só pelo eixo inicial da sua
placa, sem colisão nem solda. Mapas: `docs/img/m2-deriva-10min-terra.png` e `-42.png` (0, 1, 2, 4, 7
e 10 min; terra tingida pela placa, branco = montanha, vermelho = fronteira convergente, linhas em
±30° e ±60°).

### G1 — Continentes indo para os polos: diagnóstico
1. **O movimento É rotação rígida em torno de um polo de Euler** (fórmula de Rodrigues sobre um eixo
   fixo, crosta guardada no referencial da placa). Não é vetor em lat/lon nem em coordenada de face.
   Conferido de dois jeitos:
   - até as primeiras soldas, a latitude simulada segue a linha de base rígida com menos de 1° de
     diferença (`terra` aos 3 min: 33,1° simulado × 33,1° rígido);
   - teste de costuras: todas as placas com o MESMO eixo, inclinado para cruzar várias faces do
     cubo: em 3 min a latitude seguiu a conta exata (27,0° × 27,2°) e a fração de terra ficou em
     30,1% do começo ao fim. **As costuras entre faces não criam nem perdem crosta.**
2. **A tendência vem do desenho do movimento, não de erro numérico:**
   - **Eixos iniciais:** toda placa da Pangeia anda num grande círculo que sai do centro da Pangeia
     (o "balão"). Todos esses círculos se cruzam de novo no ponto oposto. Os continentes se espalham
     até um anel a 90° do centro e depois voltariam a se juntar do outro lado do planeta. Quando a
     Pangeia nasce perto do equador (`terra` 2°, `ilha` 6°), **esse anel passa pelos dois polos**.
   - **Os eixos nunca mudam** (só numa solda): nenhuma placa muda de rumo no meio do caminho.
   - **A solda é para sempre e congela os continentes onde eles estão.** Na `terra`, aos 4 min a
     terra está no anel (24% dela acima de 60°); as soldas a congelam lá. De 4 a 10 min a linha de
     base rígida voltaria a 21°, mas a simulação fica parada em 36°, com 26% da terra acima de 60°.
3. **Soma do movimento na solda:** o grupo soldado recebe a média dos vetores de rotação, pesada pela
   área. É uma aproximação razoável (falta o momento de inércia), mas dois continentes que batem de
   frente se anulam e o grupo quase para. Isso ajuda a "matar" a deriva (G2).
4. **Bug achado de quebra:** no teste de costuras (nenhum movimento relativo entre placas) houve **6
   soldas em 3 min**. A regra que consome crosta "que entrou fundo no território da outra" dispara só
   por arredondamento e conta como colisão. Placas que só se encostam acabam soldadas.

| Semente | Centro da Pangeia | Latitude média: início → máx → 10 min | Rígida aos 10 min | Terra acima de 60°: início → máx → 10 min |
|---|---|---|---|---|
| terra | 2° | 23,5° → 36,2° → 36,2° | 21,1° | 1% → 26% → 26% |
| mundo | 31° | 34,7° → 35,4° → 31,9° | 34,9° | 18% → 18% → 12% |
| 7 | 25° | 32,5° → 38,2° → 37,0° | 21,5° | 15% → 17% → 14% |
| 42 | −9° | 37,0° → 42,3° → 37,2° | 18,1° | 17% → 33% → 19% |
| ilha | 6° | 23,6° → 28,8° → 25,5° | 16,4° | 1% → 16% → 8% |

Referência: com terra espalhada por igual no globo, a latitude média é 32,7° e 13,4% fica acima de
60°. A subida forte acontece nos 4 primeiros minutos, na dispersão. Dos 2 aos 10 min, a inclinação da
reta fica entre −0,8° e +0,6° por minuto. Ou seja, o problema é a dispersão "balão" somada ao
congelamento pela solda, e não um empurrão contínuo para os polos.

### G1 — Proposta
- **Reorganização das placas:** cada grupo de placas ganha polo de Euler novo (sempre numa
  recomposição, porque o desenho conta com eixo fixo entre elas) em três situações:
  - quando gira 30–45° (sorteado pela semente) desde a última troca;
  - numa solda;
  - num rifte.

  O rumo novo fica a até ±60° do rumo atual (sem zigue-zague) e a velocidade é sorteada de novo. Os
  grupos com muito continente andam mais devagar (como na Terra). Rumos sorteados não têm latitude
  preferida, então a terra flutua em volta do equilíbrio em vez de ir para um lado.
- **Dispersão "balão" só no primeiro estágio:** depois do primeiro giro de 30–45°, as placas se
  reorganizam e acaba a reconvergência no ponto oposto.
- **Solda só com aproximação de verdade** (corrige o bug do item 4): o consumo por arredondamento não
  conta como frente de colisão.
- **Testes (CI, N = 128, 5 sementes, 10 min a 20×, placas 100%):**
  - *rigidez e costuras:* todas as placas com o mesmo eixo; em 3 min, nenhuma solda, nenhuma crosta
    nova, latitude igual à conta (±0,5°). Hoje falha: 6 soldas.
  - *sem tendência de latitude:* latitude média continental (pesada pela área) a cada 7,5 s. Da
    dispersão (2 min) em diante: inclinação da reta de no máximo ±0,5°/min, valor sempre entre 22° e
    42° e no máximo 22% da terra acima de 60°. Os limites são proposta e serão calibrados contra as
    5 sementes antes de travar o teste.

### G1 — Resultado (2026-10-15)
Mudanças:
- Frente de colisão só com aproximação de verdade (≥ 0,05).
- Contador de colisão que desce sem frente.
- Suturas que somem sem contato continental (até 2 células, 3 recomposições de tolerância).
- Estágios com polo de Euler novo.
- Guarda polar também na dispersão inicial, que agora dura 20–25°, os ~2 min da decisão 1.
- Correção de um defeito antigo: crosta consumida que ainda aparecia em outra célula era morta, e a
  vizinha virava buraco preenchido com a crosta da outra placa ("vazamento" de continente pela
  divisa).

Medido (placas 100%, 20×, 10 min):

| | Antes (N = 128) | G1 (N = 128) | G1 (N = 256) |
|---|---|---|---|
| Teste das costuras (mesmo eixo para todas): soldas | 6 | 0 | — |
| `terra`: terra acima de 60° aos 10 min | 26% | 9,5% | 17% |
| `terra`: latitude média aos 10 min | 36,2° | 30,2° | 36,7° |
| Maior fração acima de 60° depois de 4 min (5 sementes) | 33% | 18,5% | 25% |
| Inclinação média da latitude (5 sementes) | — | −0,29°/min | +0,19°/min |
| Velocidade relativa nas fronteiras aos 10 min | 0,05–0,24 | 0,10–0,50 | 0,25–0,50 |
| Grupos continentais aos 10 min | 1 nas 5 | 1–2 | 1–2 |

Mapas depois do G1: `docs/img/m2-g1-deriva-10min-terra.png` e `-42.png` (mesmo formato dos de antes).

Em 20 sementes (N = 128): a latitude média vai de 32,7° no início a 37,7° aos 3 min, quando a Pangeia
termina de se espalhar, e volta a 34,9° aos 10 min. Depois de 4 min, fica entre 25,6° e 45,9°, com no
máximo 26% da terra acima de 60°.

O que **não** some no G1:
- Uma Pangeia equatorial (`terra`, `ilha`) sobe de ~24° para ~37° ao se espalhar pelo globo. Terra
  espalhada por igual dá 32,7°, então espalhar já sobe a média; não há acúmulo nos polos.
- Os continentes ainda acabam num grupo só em 2 das 5 sementes (N = 256): é o G2.
- O critério de formas passou a ser medido aos 3 min, com o critério de verdade (4 a 7 continentes,
  nenhum acima de 40%). Aos 2 min a quebra ainda está no meio. `terra`, `mundo` e `7` passam (maior:
  27%, 31%, 24%). `42` (44%) e `ilha` (61%) já estavam fora antes do G1: é o G3.

### G2 — Deriva morre: diagnóstico
Confirmado. Número de grupos soldados entre as placas com ≥ 1,5% de crosta continental, e atividade
nas fronteiras (velocidade relativa média entre placas vizinhas):

| Semente | Grupos continentais: início → 10 min | Um grupo só a partir de | Velocidade relativa média | Células de fronteira convergente |
|---|---|---|---|---|
| terra | 7 → 1 | 7,4 min | 0,65 → 0,10 | 1.248 → 272 |
| mundo | 8 → 1 | 9,8 min | 0,74 → 0,12 | 1.622 → 413 |
| 7 | 6 → 1 | 6,3 min | 0,66 → 0,24 | 1.389 → 496 |
| 42 | 8 → 1 | 9,4 min | 0,69 → 0,05 | 1.342 → 103 |
| ilha | 6 → 1 | 8,3 min | 0,70 → 0,13 | 1.496 → 505 |

A solda também é **transitiva e permanente**: A soldou com B e B com C, então A, B e C giram juntos
para sempre, mesmo que já não se toquem. Aos 10 min, a `terra` tem 6 massas de terra separadas por
oceano e todas as placas continentais no mesmo grupo rígido. Não chega a ser um supercontinente: é
um arranjo congelado. A `42` termina com 3 continentes e o maior com 44% da terra, fora do critério
de "bonito".

### G2 — Proposta: ciclo de Wilson
- **Suturas explícitas:** cada solda guarda par de placas, passo em que nasceu e comprimento do
  contato. O grupo é o conjunto de placas ligadas por suturas. **Sutura sem contato desaparece**
  (acaba a solda à distância).
- **Supercontinente:** um grupo soldado com ≥ 60% de toda a crosta continental.
- **Critério de ruptura (proposta):** o supercontinente se parte depois de um "mandato" medido em
  **giro de placa**, e não em passos. Assim o controle "Placas" em 0 congela o relógio do ciclo.
  - Mandato: ~23° de giro a velocidade 1 (≈ 2 min de jogo a 20× com Placas 100%), × 0,8–1,25
    sorteado pela semente. Motivo físico: o manto esquenta embaixo do supercontinente.
  - Regra secundária, para a deriva não morrer sem supercontinente: grupo com ≥ 2 placas
    continentais e ≥ 35% da crosta continental se parte depois de 2 mandatos.
- **Onde racha:**
  - As suturas candidatas ganham pontos por **idade** (as mais antigas primeiro) e por
    **equilíbrio** (cada pedaço fica com pelo menos 20% do continente do grupo).
  - Se 3 suturas se encontram num ponto, a ruptura começa ali (**junção tríplice**). Com chance de
    1/3, um dos 3 braços **falha**: não abre, mas vira um vale de rifte interior (aulacógeno; ver
    G3).
  - **Polos novos a cada ruptura (confirmado pelo usuário):** os pedaços recebem polos de Euler
    novos, sorteados para **não repetir o "balão"**. Cada pedaço se afasta **da fenda vizinha**
    (perpendicular à linha do rifte, ±45°), e não do centro do supercontinente. Os grandes círculos
    não se cruzam mais todos num mesmo ponto, e vale a guarda polar do G1: nenhum rumo leva o centro
    da terra do pedaço além de 65°, ficando mais perto do polo. Velocidade de 0,5 a 1,0. Depois, os
    estágios do G1.
  - **Tempos em constantes** fáceis de ajustar em `tectonics.ts`: mandato do supercontinente,
    fração que define supercontinente, regra secundária, chance do braço que falha, alcance e
    tolerância das suturas, estágio.
- **Ritmo do ciclo** (aprovado pelo usuário): dispersão ~2 min (decisão 1), reaproximação e solda
  de ~4 a 6 min, supercontinente ~2 min. Ciclo completo de ~8 a 12 min a 20× com Placas 100%.
- **Teste (CI):** em 15 min a 20× com Placas 100%, nas 5 sementes:
  - pelo menos um supercontinente se forma e se parte;
  - o número de grupos continentais nunca fica em 1 por mais que 1,5 mandato;
  - a velocidade relativa média nunca fica abaixo de 30% da inicial por mais de 2 min.

### G2 — Resultado (2026-10-16)
**Como funciona** (constantes em `src/world/tectonics.ts`, no bloco "Ciclo de Wilson"):
- **Dispersão (50°, ~4,3 min):** os continentes só se afastam.
  - Na primeira, a da Pangeia, nada muda em relação ao G1 até o G3.
  - Depois de uma ruptura, cada troca de polo escolhe, entre os sorteios, o rumo que menos empurra
    contra continentes vizinhos e não volta para o supercontinente antigo.
- **Reunião (até 65°, ~5,6 min):** sorteia-se um ponto de reunião a 20–40° do último supercontinente,
  sem passar de 35° de latitude. Os grupos com continente miram nele, com ±30° de desvio e
  velocidade de 0,6 a 1,0.
- **Supercontinente:** um grupo soldado com ≥ 70% da crosta continental. Ele é reconhecido em
  qualquer fase, quase para (velocidade 0,15–0,35) e dura um mandato de 23° × 0,8–1,25 (~2–2,5 min).
- **Ruptura:**
  - Corta 1 a 3 suturas. Prefere as mais antigas, pedaços equilibrados (cada um com ≥ 20%) e nenhum
    pedaço que continue com ≥ 70%.
  - Cada pedaço gira em torno do **polo que abre a fenda continental inteira**: o oposto da soma de
    p × n na divisa. Antes, "para longe do centro da fenda" deixava parte de uma fenda curva
    fechando, e os pedaços se soldavam de novo.
  - Entre sorteios que inclinam esse polo até 25°, fica o que passa na guarda polar e menos empurra
    contra os vizinhos.
  - Os outros continentes também saem da reunião.
  - Não há "balão": os polos vêm da forma da fenda, não do centro do supercontinente.
- **Regra secundária:** sem supercontinente até o fim da reunião, um bloco com ≥ 35% e ≥ 2 placas
  continentais racha mesmo assim. Senão, começa uma reunião nova onde a terra está.
- **Na tela:** linha "ciclo" no painel Dados (fase, supercontinentes, rupturas). O "Medir
  desempenho" ganhou o cenário "ruptura forçada" e conta rupturas.

Medido (placas 100%, 20×):

| | Antes do G2 | G2 (N = 128, 5 sementes, 15 min) | G2 (N = 256, 15 min) | G2 (20 sementes, N = 128) |
|---|---|---|---|---|
| Sementes com supercontinente e ruptura | — | 5 de 5 | 5 de 5 | 20 de 20 com supercontinente |
| Primeiro supercontinente | — | 7,9–11,4 min | 4,5–8,5 min | mediana 9 min |
| Maior tempo com um grupo só | até 7,5 min (para sempre) | ≤ 2,6 min | ≤ 2,5 min | — |
| Atividade nas fronteiras no fim | 0,05–0,24 | — | 0,29–0,51 | — |
| Inclinação média da latitude | — | — | — | −0,14°/min |

- **Ciclo** (do supercontinente ao seguinte): ~8,5 min na `terra` e na `ilha`. Na `mundo` e na `42`,
  às vezes um pedaço bate num vizinho logo depois da ruptura e o supercontinente volta em ~2 min.
  Isso é colisão de verdade, como a África contra a Europa.
- **Mapas:** um ciclo da `terra` (7 a 16,5 min) em `docs/img/m2-g2-ciclo-terra.png`.

O que **não** fica bom só com o G2:
- **O "supercontinente" é um aglomerado** de continentes encostados e soldados entre si, e não uma
  massa única e compacta. Os pedaços se afastam devagar, então o ciclo é sutil nos mapas.
- **Junção tríplice:** não aconteceu nenhuma. Cortando só pelas suturas, quase nunca sai uma divisão
  em 3 pedaços. Vem com os riftes traçados do G3, que também cortam dentro de uma placa.
- **Oscilação no teste longo:** recomposições logo depois de uma troca de polo têm um teto próprio
  (0,5%). Quando a placa inverte o rumo, devolve as células que tinha acabado de tomar; é um evento
  único, não placas se comendo alternadamente.
- **Custo:** a recomposição no notebook voltou para perto de antes do G1. Contato das suturas: 32 →
  5 ms. Total: 354 → 261 ms, contra 239 antes do G1. O celular decide.

### G3 — Formas: de onde vem hoje o formato das costas
1. **Costa da Pangeia inicial:** vem da geração v2. São lobos em volta de um centro, borda deformada
   por ruído, ruído fractal, 2 a 4 bacias internas e ruído fino só na faixa da costa.
2. **Costas novas, abertas pela deriva:** são as **fronteiras de placa da geração**. É um
   crescimento de regiões a partir de 5 a 8 sementes na terra, com custo por ruído de baixa
   frequência. Cada continente é a terra de uma placa, então os continentes saem como pedaços de
   Voronoi: compactos, de tamanhos parecidos, com bordas longas e quase retas. Nos mapas, as bordas
   retas e os blocos "recortados a faca" vêm daí.
3. **Margem passiva:** a borda que se abre afunda até virar plataforma (alcance de 3 células, ruído de
   frequência 14). Isso só arranha a borda; não cria golfo nem península.
4. **Encaixe:** os dois lados da fenda já se encaixam por construção (placas rígidas). Mas a linha da
   fenda é a fronteira lisa da geração, então o encaixe não tem a forma "dente e reentrância" de
   África e América do Sul.

### G3 — Proposta: riftes traçados na hora
O mesmo mecanismo serve à G2 e à G3. Dentro de um grupo soldado as placas não se movem umas contra as
outras, então dá para **recortar o bloco por uma linha nova antes de abrir**: as células de cada lado
passam para a placa daquele lado. A transferência de crosta entre placas já existe (acreção).
- **Junção tríplice:**
  - Um ponto sobre o continente (de preferência numa junção de suturas). Saem 3 braços a ~120°
    (±25°), cada um traçado por busca de caminho com custo baixo em suturas antigas e terreno baixo e
    custo alto em montanha nova.
  - Ruído no custo faz o caminho serpentear na escala de 2 a 6 células, com **degraus de falha
    transformante** (trechos perpendiculares à abertura, como no Atlântico Equatorial). É isso que
    faz as duas costas se encaixarem com dentes e reentrâncias.
- **Braço que falha (aulacógeno):** com chance de 1/3, um braço não abre. Ao longo dele o terreno
  afunda 300 a 800 m numa faixa de 1 a 2 células: vira vale comprido, lago ou golfo estreito, conforme
  o nível do mar.
- **Microcontinentes:** com chance de ~25% por ruptura, a fenda "pula". Abre-se um segundo braço
  paralelo, a 3 a 8 células da costa, e solta-se uma lasca de 0,5 a 2% do planeta (como Madagascar).
  A lasca vira placa própria, mais lenta.
- **Primeira quebra da Pangeia:**
  - A Pangeia passa a nascer como **um bloco soldado** e se parte pelo mesmo mecanismo. As fronteiras
    de Voronoi viram as "suturas antigas" que os braços preferem seguir, sem ser obrigados.
  - Muda as placas iniciais de toda semente ("geração v3"). O terreno inicial continua igual.
- **Margens:** a margem passiva continua, mas fica igual dos dois lados, para não apagar o encaixe.
- **Limite técnico:** o desenho aceita no máximo 16 placas (`MAX_SHADER_PLATES`; 4 bits por
  candidata na textura). Hoje há de 8 a 14. Microcontinentes e braços novos pedem números de placa
  novos. Plano: reaproveitar o número de placas que somem e, se não bastar, subir para 32 e medir no
  Hot 50i.
- **Medida e teste:** o critério combinado (4 a 7 continentes variados, nenhum com mais de ~40% da
  terra) é testado aos 2, 5 e 10 min, **fora da fase de supercontinente** (lá, por definição, um
  passa de 40%). Somam-se:
  - um índice de recorte (células de costa ÷ √área, por continente), comparado antes e depois;
  - o número de mares internos.

  Penínsulas e golfos são julgados por você nos mapas e no celular.

### Desempenho (só vale medido no Hot 50i)
- Reorganização e solda são contas por placa: custo desprezível.
- O rifte é um evento raro, com uma busca de caminho dentro do bloco no worker. Estimativa: dezenas de
  ms em N = 256, medir.
- Mais placas deixam a recomposição mais cara na faixa de fronteira, porque cada célula testa todas
  as placas.
- O "Medir desempenho" ganha um cenário com ruptura forçada, e o relatório do aparelho decide.

### Decisões do usuário (2026-10-15, noite)
1. (a) Pangeia como está, mas os polos de Euler novos a cada ruptura não repetem o "balão" (acima).
2. Ritmo aprovado; tempos em constantes fáceis de ajustar.
3. Sim: a Pangeia nasce soldada e a primeira quebra usa os riftes traçados (geração v3).
4. Sem prints agora; as formas são avaliadas depois do G3.
- O G1 corrige explicitamente a solda à distância e a falsa colisão por arredondamento, cada uma com
  teste.
- Antes de fechar o bloco G, repetir as medições de latitude e de grupos soldados em N = 256. Se
  subir para 32 placas, medir no Hot 50i antes de aceitar.
- Parar ao fim de cada G com algo visível na prévia.

### Perguntas que foram feitas antes de codar
1. **Latitude inicial da Pangeia:**
   - **(a, recomendada)** continua como está (centro entre ±34°). A dispersão sobe a latitude média
     até o equilíbrio (~33°) nos 2 primeiros minutos, e o teste mede a tendência daí em diante.
   - **(b)** sortear o centro para que a terra já comece perto do equilíbrio. Isso muda o mundo
     inicial das sementes.
2. **Ritmo do ciclo:** mandato do supercontinente ~2 min e ciclo de 8 a 12 min (a 20×, Placas 100%)?
3. **Geração v3:** a Pangeia nasce como bloco soldado e a primeira quebra usa os riftes traçados
   (muda as placas iniciais de toda semente)?
4. **Prints** das formas que você achou feias: a mensagem dizia "[anexar prints]", mas eles não
   vieram.

### Tarefas (depois da aprovação, nesta ordem; cada uma = um commit)
- [x] **G1 — Latitude:** solda só com aproximação; solda à distância corrigida (sutura some sem
  contato); reorganização dos polos com guarda polar; testes de rigidez/costuras, de solda à
  distância e de tendência de latitude. Resultado abaixo ("G1 — Resultado").
- [x] **G2 — Ciclo de Wilson:** suturas explícitas; sutura sem contato some; supercontinente,
  mandato e ruptura por sutura e junção tríplice; teste de 15 min; cenário no "Medir desempenho".
  Resultado abaixo ("G2 — Resultado").
- [ ] **G3 — Riftes traçados e formas:** braços serpenteando com degraus, aulacógeno,
  microcontinentes, geração v3 (se aprovada), números de placa; critério de formas aos 2, 5 e 10 min;
  mapas antes/depois.

## Estado em 2026-10-15 (noite) e próximos passos
Feito no `marco-2` (prévia em `/previa/marco-2/`): T1–T5, correção do travamento no celular, D1–D5 e
a correção dos pedaços de placa (commit `d36c156`, confirmada no celular: a oscilação sumiu; o
relatório do aparelho bateu todas as metas de fps e geração).

Bloco G aprovado. **G1 e G2 feitos** (G1 aprovado pelo usuário com o relatório do aparelho). G2
aguardando o teste na prévia; depois G3. Ainda pendentes: confirmar no celular o travamento em 92% e os lagos retos
(`docs/bugs.md`), avaliar as imagens de formas e a T5. T6 (minerais) segue congelada.

Questão em aberto que continua: **"tamanho fixo" das placas.** Ao pé da letra é impossível com placas
rígidas cobrindo a esfera, porque as dorsais fazem crescer e a subducção encolhe. Ficaram fixas a
identidade e a forma; confirmar se basta. A questão do rifte foi decidida: ciclo de Wilson (Bloco G).

## Critérios de aceite do usuário
1. Ligo as placas e acelero o tempo: a Pangeia se parte em continentes, e a tela não trava.
2. Onde continentes colidem nascem montanhas; onde se separam, abre-se oceano.
3. Terremotos e vulcões aparecem nas fronteiras e nos pontos quentes; tsunamis saem de terremotos
   no mar; furacões nascem em mar tropical; secas, enchentes e incêndios fazem sentido com o clima.
4. Placas em zero congelam a geologia.
5. Consigo provocar qualquer desastre e ajustar a frequência e a temperatura global.
6. Escolho ferramentas por um menu confortável com uma mão, e a tela fica livre para o planeta.
7. Tudo continua fluido no meu celular (comparado à linha de base da v1.1).

## Fora do M2 (não fazer agora)
Uso dos recursos minerais (economia no M4, militar no M7); feedback ambiental (M3/M4/M7); classes
sociais (M5); doutrinas de guerra (M6/M7). Vida (plantas, animais), humanos, cidades e dano a cidades (as regras de "cidade sobre terreno que
muda" ficam para quando houver cidades, no M4), crônica permanente (M5), som, sprites novos.

## Decisões de design do usuário (2026-10-15)
1. **Ritmo da deriva:** ~2 minutos reais para a Pangeia se partir, com placas no máximo e tempo em 20×.
2. **Desastres:** controle de frequência na tela, padrão "raro".
3. **Marcas:** vulcão muda o relevo para sempre; os outros desastres se recuperam.
4. **Eras glaciais:** automáticas e suaves, mais um controle de temperatura global.
5. **Avisos:** só os desastres grandes; lista completa no painel.
6. **Interface:** substituída pela T1 — menu de ferramentas por categorias (Tempo, Relevo, Desastres,
   Geologia, Clima), com só a ferramenta escolhida e a pausa na tela; esboço aprovado antes de codar.
