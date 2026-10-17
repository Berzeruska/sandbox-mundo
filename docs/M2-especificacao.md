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

**Blocos de teste (regra do usuário, 2026-10-16):** sigo de tarefa em tarefa e só paro no fim de
cada bloco, com a prévia e a lista numerada do que testar no celular (paradas obrigatórias no meio:
decisão de design, teste de portão, meta de desempenho quebrada na estimativa).
1. **Bloco G:** correção 2, G3, G4.
2. **Minerais e clima:** T6, T7.
3. **Desastres:** T8 a T12.
4. **Final:** T13, T14 (medição contra a linha de base da v1.1).

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
  **Observado pelo usuário no celular (2026-10-16, `c0660ea`), para tratar nesta tarefa:**
  terra em latitude alta sem gelo; polos simplificados demais; neve fraca. Diagnosticar na T7, não
  antes.
  **Também (2026-10-16, `9d5f101`):** o vale de rifte entre duas montanhas pintadas fica com neve e
  parece estranho (`docs/bugs.md`). Tratar aqui, não antes.
  **Também (2026-10-16, pedido do usuário):** nem toda montanha deve ter neve (depende da altura, da
  latitude e da chuva). E a erosão pelo clima: o lado chuvoso de uma cordilheira desgasta mais e vira
  escarpa; planalto seco sobrevive. Formações de erosão de perto (pilares de arenito, "braços" de
  pedra) são do Marco 8.
  **Também (2026-10-16, teste do Bloco G):** os polos hoje são duas manchas brancas que não interagem
  com as placas e não parecem gelo; neve demais (no vale do rifte e em todas as montanhas); biomas
  pouco variados. Os três são regra do clima e do gelo, não desenho: entram aqui. Para os biomas,
  diagnosticar primeiro se o clima (chuva e temperatura) varia pouco ou se faltam biomas na lista;
  bioma novo é decisão do usuário.

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
  Pedido do usuário (2026-10-16), especificar na T10: **nuvens** simples e translúcidas que somem ao
  aproximar a câmera, formando tempestades e furacões em redemoinho; o evento altera só o clima da
  região dele.

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

### G2 — Teste no celular (2026-10-16, `c0660ea`) e diagnósticos
Relatório do aparelho: pausado 80 fps (parado) / 91 (girando); tempo 20× com placas paradas 91; placas
100% 82–85 (mín. 59); deriva longa 84; ruptura forçada 84; geração 2,7 s. Recomposição no celular:
900–1.260 ms em média (placas 620–990 · clima ~170 · cores ~40 · envio ~55). "Pausado, parado" ficou
abaixo da meta de 85 (antes 91); a vigiar no próximo relatório.

**1. "Elevar" numa fronteira forma um buraco.** Reproduzido em `terra`, no ponto da fronteira, com
placas 100%: a partir da 2ª recomposição (~ano 135), uma linha de 1 célula de **fundo oceânico novo
(−2.500 m)** atravessa o morro pintado e a cordilheira; na 6ª (~ano 400) tem 1–2 células de largura e
continua escura com tudo pausado (é crosta na simulação, não efeito de desenho).
- **Causa:** as duas placas ali estão se afastando devagar (testado: tratar a fenda como arredondamento
  não muda nada; é abertura de verdade). A cada recomposição, a fenda aberta entre dois continentes
  vira dorsal oceânica na hora, a −2.500 m, e afunda com a idade. Um rifte de verdade começa como vale
  (terra afundando, lagos) e só vira mar quando fica largo. Não depende do pincel: o pincel só deixou
  o rasgo visível no morro.
- **Proposta (correção 1, antes do G3):** fenda entre dois continentes, enquanto tiver menos de 3
  células de largura, nasce como **vale de rifte continental**: altura das vizinhas menos 300–800 m (a
  mesma faixa do aulacógeno do G3), podendo virar lago se ficar abaixo do mar. Com 3 células ou mais, o
  meio vira fundo oceânico como hoje. Resultado esperado: o morro sobe normal e, depois, a placa se
  parte por um vale que alarga até virar mar.
- **Teste (pelo desenho):** duas placas continentais se afastando em cenário sintético: nas primeiras
  recomposições a fenda é terra mais baixa que as vizinhas e nenhuma célula é oceânica; com largura
  ≥ 3, o meio é oceânico. Os testes de tiras arrastadas e de oscilação continuam passando.

**2. Placas no máximo travam o tempo.**
- **Causa:** a recomposição roda no mesmo worker do relógio. Com placas 100% a 20×, há uma a cada
  ~3,6 s reais (877 passos), e ela segura o worker ~1 s no celular. Nesse tempo o relógio não anda e
  depois só recupera 0,25 s (`MAX_FRAME_DT`): a data para ~1 s a cada 3,6 s e o jogo anda ~20% mais
  devagar (192 passos/s em vez de 240; "ocupado 21%").
- **Onde está o custo** (notebook, N = 256, `terra`, 3 min, 50 recomposições; total 239 ms, no celular
  ×3–4): composição do mapa (cada célula da faixa de fronteira testa todas as placas) ~146 ms (61%) ·
  relevo 49 (20%) · pedaços soltos 20 (9%) · polaridade 9 · somas por placa 7 · contatos 4 · acreção 2.
  Fora das placas: clima ~170 ms no celular.
- **Defeito na medição:** o "pior" de cada linha é o máximo desde que o mundo abriu, não do cenário
  (por isso 2.010 ms em todas). Corrigir junto.
- **Não há meta de "o tempo não para"**; as metas de fps estão batidas. Opções para o usuário decidir
  (ver "Estado"): (a) baratear a recomposição (só placas vizinhas na faixa, sem alocar por célula,
  relevo incremental): estimativa de metade do custo, a data ainda para ~0,5 s; (b) recomposição num
  segundo worker, aplicada um número fixo de passos depois (determinística): o tempo não para enquanto
  o celular acompanhar; mudança maior e mais memória.

**4. Placas se chocam até uma englobar a outra.** Medido em 10 min, N = 256, 5 sementes:
- A regra registrada (decisões, D3) é "identidade e forma: nada de placas comendo umas às outras
  **alternadamente**". Ela é cumprida: trocas A→B→A são 0,8–1,2% das trocas de dona (arredondamento de
  1 célula).
- O que se vê tem três mecanismos, todos do desenho atual:
  - **acreção:** continente pequeno (< 1,5% do planeta) que colide passa inteiro para a placa maior
    (`terra`: a placa 1 perdeu seus 2.620 continentes no minuto 0,8);
  - **subducção até sumir:** placa oceânica encolhe até desaparecer (`terra`: placa 8 some em ~4,5 min;
    `mundo`: 3 de 14 placas somem em 10 min);
  - **"deformam um pouco":** na colisão, antes da solda (8 recomposições), a crosta continental da
    faixa sobreposta é apagada: 10–16% da crosta continental em 10 min (`ilha` 19.801 células). Na
    Terra real, continente não afunda: amassa e vira montanha.
- Conclusão: não é bug da regra como está escrita. Se "nenhuma placa come a outra" quer dizer "nenhuma
  placa some e nenhum continente é apagado", é regra nova de placas → docs, pela direção do usuário.

**Decisões do usuário (2026-10-16):**
1. Correção 1 (vale de rifte com menos de 3 células) aprovada.
2. Tempo travando: recomposição no ajudante 2 com memória compartilhada (opção b completa); a
   recomposição mais barata (a) depois, como complemento. Primeiro passo: testar no celular se a
   memória compartilhada funciona; se não, perguntar antes de seguir com cópia. O "pior" do relatório
   passa a ser por cenário. Plano dos ajudantes em `docs/01-arquitetura.md`.
3. Continente apagado na colisão vira **G4: continente amassa e vira montanha**, com especificação
   aprovada antes de codar.
4. Ordem: correção 1 → correção 2 → G3 → G4 → T6 em diante.

**Correção 1 — resultado (2026-10-16, código pronto, não publicado: falta uma decisão):**
- No cenário do relato (`terra`, Elevar na célula 49682, placas 100%, 6 recomposições), o fundo oceânico
  novo dentro do morro caiu de 153 células para 3. A fenda nasce como vale (vizinhas −300 a −800 m) e,
  com 3 células de largura, o meio vira mar; o vale fica nas duas bordas e afunda como margem.
- Teste sintético de 2 continentes se afastando: até a 6ª recomposição só vale, nenhum fundo oceânico;
  na 14ª, mar no meio e vale nas bordas. Tiras, oscilação, ciclo de Wilson e o resto passam.
- **Efeito colateral:** rifte que abre devagar ou para de abrir (perto do polo de rotação, ou depois de
  uma mudança de rumo) fica como vale em terra para sempre (~30% das células de vale acima do mar). Isso
  liga continentes que antes eram separados por um rasgo oceânico de 1–2 células. O critério de formas
  aos 3 min (4–7 continentes, maior < 40%) falha: N = 128 `terra` 44% e `mundo` 40%; N = 256 `mundo` 47%.
  Sem contar o vale como terra: 22%, 31% e 29%. Em N = 256 `terra` (35%) e `7` (29%) continuam passando;
  `42` e `ilha` já estavam fora antes (G3).
- **Decisão do usuário (2026-10-16): opção 1.** Rifte parado fica como vale em terra (o aulacógeno).
  Descartadas: fundo do vale sempre abaixo do mar (volta o corte no morro) e vale parado virando mar
  (regra nova).
- **Falha conhecida:** os testes de formas de `terra` e `mundo` (`tests/world/shapes.test.ts`) ficam
  marcados como falha conhecida (`it.fails`), sem apagar e sem afrouxar o critério. **Têm de voltar a
  passar no fim do G3**; o G3 só fecha com eles como teste normal de novo.

### G4 — Proposta: continente amassa e vira montanha (versão 2, esperando aprovação)
**Hoje:** numa colisão entre dois continentes, até a solda (8 recomposições), a crosta continental da
faixa sobreposta é apagada (10–16% da crosta continental em 10 min). A cordilheira sobe 480 m por
recomposição na faixa da frente, até 7.000 m, igual em toda colisão.

**Decisões do usuário (2026-10-16):**
1. A montanha nasce toda na placa que fica por cima (como o Himalaia).
2. Planalto sem limite extra se a colisão já termina sozinha na solda e o planalto fica num tamanho
   realista (referência: Tibete); senão, limite baseado no mundo real.
3. Variedade baseada no mundo real: nem toda montanha extrema; planaltos, escarpas, istmos e cadeias
   variadas; cada região com caráter próprio conforme a sua história geológica.

#### 1. Crosta vira montanha (base do G4)
- Cada célula continental consumida numa colisão entrega a "espessura" dela (altura acima de uma base de
  −3.500 m) à placa que fica por cima, na faixa da frente (sino de até 8 células).
- Onde a montanha bate no teto, o que sobra vai para a célula seguinte, mais para dentro: a cordilheira
  alarga e vira planalto.
- **Qual dos dois casos é (resposta à decisão 2): o primeiro, pela estimativa.** A colisão termina
  sozinha na solda: são 8 recomposições com frente, e em cada uma as placas se aproximam ~1–2 células.
  Entram ~8–16 células de crosta por trecho de frente. Isso enche uma faixa de ~4–8 células no teto,
  e a cordilheira inteira fica com ~8–12 células: 300–470 km em N = 256. O conjunto Himalaia–Tibete
  tem ~1.000 km de largura, então o planalto fica menor que o Tibete, sem limite extra.
  - Depois de codar eu meço em N = 256, nas 5 sementes, em 10 min.
  - Só se alguma cordilheira passar de ~25 células (~1.000 km, o Tibete) eu proponho um limite.

#### 2. De onde vem a variedade (tudo no G4, menos o que está na lista "fora do G4")
1. **Tamanho conforme a colisão:** a altura vem da crosta que entrou. Encostada curta ou lenta faz
   morros e serras baixas. Colisão longa e rápida entre continentes grossos faz cordilheira alta e
   planalto. Sem regra de "toda montanha vai a 7.000 m".
2. **Províncias de crosta (caráter de cada região):** cada placa ganha, na geração, um mapa fixo de
   rigidez, preso ao referencial dela como as margens e as amostras: núcleos rígidos e antigos
   (crátons, como o Escudo Brasileiro) e faixas fracas entre eles.
   - **Na colisão:** a crosta fraca engrossa e vira planalto; o cráton quase não deforma. Onde a
     cordilheira encosta num cráton, a frente vira uma **escarpa** (subida abrupta), e atrás dele o
     terreno fica plano e baixo.
   - Como o mapa anda com a placa, cada região guarda o seu caráter pela vida toda.
   - **Hemisférios e regiões diferentes:** o relevo de cada lugar depende de que províncias estão ali
     e de que colisões já aconteceram ali (o ciclo de Wilson junta e separa os continentes em lugares
     diferentes a cada volta). O mundo não fica homogêneo: um hemisfério pode ter planaltos jovens e o
     outro, escudos antigos e baixos.
3. **Colisão oblíqua:** quando as placas se encontram de lado, a crosta se espalha ao longo da frente.
   A cordilheira sai mais baixa, mais comprida e em fileiras escalonadas; de frente, sai alta e
   concentrada.
4. **Picos e passagens:** ao longo da frente, a crosta recebida varia com um ruído preso à placa.
   Saem picos, serras separadas por passagens e vales entre cadeias, não uma muralha contínua.
5. **Montanha velha e montanha nova:** sem crosta nova entrando, a erosão que já existe baixa a
   cordilheira com o tempo; cadeias novas ficam altas.
   - **O que a erosão de hoje faz:** a cada recomposição, o que passa de 2.500 m perde 3,5%, e acima de
     1.200 m o relevo se aproxima da média das vizinhas. Um pico de 7.000 m cai à metade do excesso
     (~4.750 m) em ~19 recomposições (~1 min a 20× com placas 100%) e tende a ~2.500 m. Só roda quando
     as placas andam (placas em zero congelam a geologia).
   - **O limite dela:** abaixo de 2.500 m ela só arredonda, não baixa. Cadeias velhas ficam como
     planaltos arredondados de 1.200 a 2.500 m, não baixas como os Apalaches (~1.000–2.000 m). Baixar
     mais é erosão pelo clima: **T7**.
6. **Escarpas de margem (ombreira de rifte):** quando um continente racha, as bordas da fenda sobem
   300–1.000 m (sorteado por trecho) e, quando a fenda vira mar, ficam como uma escarpa costeira, como
   a Serra do Mar e o Drakensberg. **Atenção:** isto é do módulo dos riftes (G3); proponho incluir no
   G4 porque é parte da variedade pedida.

**Como medir (referência real, aproximada):** na Terra, ~10% da terra fica acima de 2.000 m, ~2–3%
acima de 4.000 m (quase tudo Tibete e Andes) e uma fração mínima acima de 6.000 m. Teste em N = 256,
5 sementes, aos 10 min: terra acima de 2.000 m entre 5% e 15%; acima de 4.000 m entre 0,5% e 4%;
acima de 6.000 m abaixo de 0,3%. Os mapas antes/depois vão para `docs/img/`; penínsulas, escarpas e
planaltos você julga no celular.

**Testes (pelo desenho):**
- Colisão sintética de 2 continentes, sem erosão: a espessura continental total bate em ±2%.
- Colisão longa e rápida dá faixa acima de 6.000 m mais larga que colisão curta.
- Contra um cráton, a altura sobe mais de 2.000 m em até 2 células (escarpa).
- Colisão oblíqua dá pico mais baixo que a frontal com a mesma crosta.
- Rifte novo: as bordas sobem e continuam altas quando a fenda vira mar.
- Continuam passando: oscilação, pedaços soltos, formas, latitude e ciclo de Wilson.

**Desempenho:** contas só nas células da frente de colisão e das bordas de rifte novas. O mapa de
rigidez é ruído preso à placa, lido só nessas células. Estimativa: < 5 ms por recomposição no
notebook, no ajudante 2.
- **Geração:** as províncias não somam nada. O mapa não é guardado nem calculado na geração: é um
  ruído lido na hora, só nas células da frente de colisão, no ajudante 2, depois que o mundo já
  apareceu. A geração continua na estimativa do G3 (~2,9–3,0 s no celular); a meta de 3 s vale.

**Fora do G4 (registrado onde entra):**
- **Istmos** como o do Panamá nascem de arcos vulcânicos entre continentes → **T9 (vulcões e
  arcos)**. No G4 só saem os istmos de colisão (dois continentes que acabam de se tocar).
- **Erosão pelo clima** (lado chuvoso desgasta mais e faz escarpa; planalto seco sobrevive) e
  **formações de erosão** (pilares de arenito como os da China, grandes "braços" de pedra) → não há
  tarefa de erosão no M2. Proponho que a erosão pelo clima entre na **T7** (clima que acompanha a
  deriva), e o detalhe visual de perto no **Marco 8**. Registrado nos dois.
- **Neve:** nem toda montanha tem neve → **T7**, junto com o defeito da neve no vale do rifte.

**Perguntas antes de codar:**
1. Aprova as fontes de variedade 1 a 5?
2. A ombreira de rifte (item 6) entra no G4, ou fica para depois?

### G4 — Resultado (2026-10-16)
- **Erosão (decisão do usuário): opção (a)**, erosão de 0,5% e alisamento de 3% por recomposição.
- **Teste de altitudes aos 10 min (N = 256, `tests/world/hypsometry.test.ts`):** `terra`, `mundo`, `42` e
  `ilha` no alvo. **Falha conhecida:** a `7` fica com 0,44% da terra acima de 4.000 m (alvo 0,5%);
  marcada sem afrouxar o critério.
- **Desempenho:** igual ao de antes do G4 (recomposição no ajudante 414–557 ms, relógio a 240
  passos/s, "relógio esperou 0 ms"); geração sem mudança.
- **Mapa:** `docs/img/m2-g4-montanhas-terra.png` (3, 6 e 10 min).

### Fim do Bloco G (2026-10-16): latitude e grupos soldados em N = 256
| Semente | Latitude média da terra (2 → 10 min) | Terra acima de 60° (10 min) | Maior tempo com 1 grupo continental |
|---|---|---|---|
| `terra` | 31,3° → 33,7° | 9% | 2,4 min |
| `mundo` | 33,7° → 30,1° | 7% | 0,5 min |
| `7` | 32,9° → 30,0° | 7% | 1,1 min |
| `42` | 37,5° → 41,1° | **33%** | 0,9 min |
| `ilha` | 34,1° → 33,6° | 10% | 0,6 min |
- Critério do G1: 20°–45° e no máximo 25% da terra acima de 60° depois de 4 min. Critério do G2: um
  grupo só por no máximo ~2,9 min. **Só a `42` sai:** 29% aos 8 min e 33% aos 10 min. Antes do G3, com
  o mesmo teste, ela ficava em 22%: a mudança veio da geração v3 (placas iniciais novas), não do G4. O
  teste de CI (N = 128) passa. **Decisão aberta do usuário** (mexer seria regra de placas).
- Máximo de placas: até 16 (não subiu para 32); não precisa da medição extra no Hot 50i.

### Teste do Bloco G no celular (2026-10-16, `f18969a2`): perguntas e diagnóstico
Relato do usuário: geração 3,9 s (meta 3 s; estimativa era 2,9); pausado parado 81 fps; "relógio
esperou 0 ms", mas ele viu o tempo travar; de perto, as células ficam puxadas e pontiagudas.

1. **Geração 3,9 s.** Duas causas, medidas no notebook com o Chromium preso a 2 núcleos (como os 2
   fortes do Hot 50i), comparando com `c0660ea` (o 2,7 s do celular):
   - **A etapa "placas" quase dobrou** (G3: Pangeia partida por riftes traçados, rodadas extras de
     crescimento das placas, placas contínuas). No Node, N = 256: mediana 175 → 300 ms. A estimativa de
     2,9–3,0 s comparou com o commit do ajudante 2 e com mundos gerados em sossego; ela errou para baixo.
   - **O ajudante 2 ainda trabalha quando a geração começa.** No "Medir desempenho", a geração vem logo
     depois de 2 min de placas a 20×. O ajudante continua até 480 passos atrasado e termina as
     recomposições que faltam (no celular, 1–2 s cada), disputando os 2 núcleos fortes. O mundo velho
     também fica na memória dele até o novo chegar. Medido: etapa "terreno" 500 → 720 ms quando vem
     logo depois da deriva.
   - **Proposta (técnica):** (a) ao pedir mundo novo, o ajudante larga o mundo velho na hora (para de
     andar e solta a memória); (b) baixar o custo da etapa "placas" do G3 sem mudar o resultado (mesma
     semente, mesmo mundo); (c) o relatório mostra quanto o ajudante ainda trabalhou durante a geração.
2. **Pausado parado 81 fps.** Nesse cenário o jogo não desenha nada (nada mudou na tela); o número é o
   ritmo que o celular oferece a uma página parada. O Android baixa a taxa da tela quando nada se
   mexe (entre 60 e 90 Hz, média ~80). Já era 80 em `c0660ea`, antes do Bloco G. Girando (desenho
   cheio), 91. **Proposta:** o relatório mostra "desenhados X de Y quadros" e a meta de pausado passa
   a valer para "pausado, girando" (custo real de desenhar). Mudar o critério é decisão do usuário.
3. **Travou, mas "relógio esperou 0 ms".** Esse número só mede quando o relógio para à espera do
   ajudante. Não mede: (a) quadros lentos da tela (3 trabalhos — tela, relógio, ajudante — em 2
   núcleos fortes; quando o ajudante recompõe, um deles vai para um núcleo fraco); (b) a tela ao
   receber cada recomposição; (c) a data que não chega porque o relógio está aplicando um resultado.
   No notebook (2 núcleos) nada disso aparece (pior quadro 17 ms, receber ≤ 3,7 ms). **Proposta:**
   registrar cada travada (> 100 ms da tela ou data parada > 300 ms) com a hora e o que estava
   acontecendo, sempre ligado, no painel Dados. Pede ao usuário: o que travou (imagem, data ou os
   dois), por quanto tempo, e o relatório completo.
4. **Células puxadas e pontiagudas de perto.** É o T13 (bordas orgânicas): o shader desloca o ponto
   com ruído de até ~0,7 célula antes de escolher a célula. De longe vira costa curva; de perto, os
   cantos das células deslocadas viram pontas e lascas. Imagens no zoom máximo:
   `docs/img/m2-zoom-bordas-organicas.png` (hoje) e `docs/img/m2-zoom-celulas-quadradas.png` (sem o
   deslocamento). Vista quadrada ao aproximar: **custo de desempenho zero** (o shader faz menos
   conta); o custo é de aparência: a grade aparece em degraus. Perto dos 8 cantos do cubo, onde 3
   faces se encontram, as células são losangos de ~120°. Nenhum desenho do cubo evita isso. A
   superfície de perto já é praticamente plana, porque a parte visível é pequena. Um mapa plano de
   verdade (outro modo de câmera) é trabalho de outro marco. **Decisão do usuário** (aparência).

### Rodada depois do teste do Bloco G (2026-10-16): decisões e o que foi feito
Decisões do usuário: as duas correções técnicas da geração (meta de 3 s mantida); meta de pausado
medida girando, com "desenhados X de Y"; registro de travadas no painel Dados; vista de perto com
células quadradas (aprovar no celular); `42` como falha conhecida; formas mantido; pedacinhos de terra
no oceano depois de colisões aceitáveis; polos, neve e variedade de biomas na T7; Hot 50i continua
como aparelho-alvo até o fim do M2.

1. **Geração.** O ajudante é encerrado na hora do mundo novo e um reserva já carregado assume; a
   primeira passada do terreno é dividida entre o relógio e o ajudante (mesmo mundo: 26 mundos
   idênticos byte a byte); o limiar da fração de terra sai sem ordenar tudo. Notebook com 3 núcleos,
   geração logo depois da deriva: mediana 903 ms contra 893 da versão que deu 2,7 s no celular
   (antes, +30%). O relatório mostra "ajudante fez X% do terreno". A primeira abertura da página não
   tem ajuda (o ajudante ainda está carregando).
2. **Relatório:** coluna "desenhados" por cenário e nota de que a meta de pausado vale girando.
3. **Travadas** (`src/ui/stalls.ts`): tela acima de 100 ms e data parada acima de 300 ms com o tempo
   correndo, com hora, duração, causa provável e velocidade/placas; últimas 4 no painel Dados, últimas
   12 no relatório. **A data pulando:** a 20× correm 240 meses por segundo, e a tela recebe a data
   até 10 vezes por segundo, então ela anda de 2 em 2 anos normalmente. Um pulo de 20 anos de uma vez
   é a data parada ~1 s: travada (e aparece no registro).
4. **Vista de perto:** ver `docs/decisoes.md`. Imagens: `docs/img/m2-perto-quadrado.png` (antes, novo
   no zoom máximo, no meio do caminho, de longe) e `docs/img/m2-perto-costa.png` (costas). A neve não
   foi mexida no visual: é regra do gelo (T7); pintar por cima faria o mapa mostrar outra coisa que o
   mundo.

### Teste da rodada no celular (2026-10-17, `0155233d`): aprovado, e correções antes de T6/T7
Relato do usuário: "está bonito de perto", aproximação limpa, quadrados andam bem com as placas,
geração 2,8 s, metas de fps batidas. Primeira abertura da página 5,0 s (antes 4,6; só acompanhar).
Pedidos antes do bloco Minerais e clima:

1. **Bug: Elevar sobe uma listra.** Reproduzido no notebook: com o "Girar (fps)" do painel Dados
   ligado, o globo continua girando por baixo do dedo e o pincel, aplicado a cada quadro, desenha uma
   faixa leste–oeste. A inércia parava no toque; o giro de teste, não. **Correção:** qualquer toque no
   globo desliga o giro de teste (o botão volta para "Girar (fps)"). Sem o giro, o pincel faz morro no
   ponto tocado (conferido parado, com placas a 20×, de perto, num mundo antigo e nas emendas do cubo).
   Se a listra aparecer com o giro desligado, é outro caso: o usuário avisa.
2. **Travadas "fora do jogo".** Registro do celular: 147 da tela e 11 da data, todas de 110–130 ms,
   placas 100% a 20×. **O jogo provoca limpeza de memória, sim, mas no ajudante 2:**
   - Medido no Chromium (perfil de memória por worker, 10 s a 20× com placas 100%): tela quase nada
     (3–4 limpezas pequenas em 20 s), relógio ~1 MB, **ajudante 2: 270 MB criados e jogados fora**
     (205 limpezas em 20 s). No Node, N = 256: **117 MB por recomposição**.
   - Origem: objetos pequenos criados por célula a cada recomposição (vetores `[x, y, z]`, listas
     zeradas com `length = 0`, que fazem o motor do JavaScript jogar fora o espaço e criar outro, um
     objeto de parâmetros por célula no bioma, números com vírgula passados a funções não embutidas)
     e arrays do tamanho do mundo recriados a cada vez.
   - **Correção** (mesmo resultado: impressão digital idêntica em 300 recomposições, N = 64, e 14 em
     N = 128; teste novo `tests/sim/geology-golden.test.ts`): áreas de trabalho reaproveitadas,
     `pointToCellOf` (célula a partir de um vetor), contas sem vetores temporários, somas em blocos.
     **117 → 20 MB por recomposição (−83%)** e a recomposição ficou **24% mais rápida** (404 → 308 ms
     no Node, N = 256). No Chromium: 270 → 55 MB em 10 s; limpezas no ajudante 205 → 64 em 20 s.
   - **O que não está provado:** no notebook não aparece nenhuma travada (nem com o processador 6×
     mais lento), então não dá para confirmar aqui que era isso. A limpeza no ajudante usa outros
     núcleos ao mesmo tempo, e o Hot 50i só tem 2 fortes para tela, relógio e ajudante. Outra causa
     possível, que o registro não separa, é a GPU: "fora do jogo" quer dizer só que a tela não estava
     trabalhando no código dela. **Registro melhorado:** a causa agora se chama "fora do código da tela
     (GPU, núcleo ocupado, limpeza de memória ou sistema)" e cada travada mostra "recomposição há X s".
     Se as travadas continuarem e caírem logo depois das recomposições, o próximo passo é a GPU ou a
     disputa de núcleos.
3. **Proposta (sem código): de perto, perto dos polos, o planeta fica "blocado", com partes
   distorcidas e costa dobrando em ângulo reto.** Imagem: `docs/img/m2-perto-emendas.png` (semente
   `42`, zoom máximo; 1 e 2: costa na emenda entre a face do polo e a face do lado; 3 e 4: perto de
   um canto do cubo).
   - **De onde vem:** a grade é um cubo inflado. O polo é o centro de uma face (lá as células são
     quadradas e retas). A ~35°–45° de latitude ficam as **emendas** entre faces: as fileiras de
     células mudam de direção ali, então uma costa que segue a grade dobra, como a quina de uma
     caixa. Nos **8 cantos do cubo** (latitude ~35°) as células viram losangos de ~120°. De longe as
     bordas orgânicas escondem isso; de perto, com células quadradas, aparece. É geometria da grade
     (nenhum desenho de cubo evita), não dado do mundo.
   - **Opções:**
     a. **Deixar como está.** Custo zero.
     b. **Disfarçar só nas emendas e cantos:** de perto, até ~3 células das emendas e cantos, o
        shader mistura de volta um pouco das bordas orgânicas, e o resto continua quadrado. A dobra
        fica arredondada, mas aí os quadrados se misturam com bordas tortas (dois estilos na mesma
        tela). Custo: ~1 dia, só shader, desempenho praticamente igual.
     c. **Quadrados alinhados à tela:** de perto, em vez de desenhar as células da grade, desenha uma
        malha de quadrados retos e alinhados com o norte, presa ao ponto que a câmera olha; cada
        quadrado pega a cor da célula embaixo do centro dele. Fim das dobras e dos losangos na tela.
        Contra: quadrado e célula deixam de ser a mesma coisa: perto das emendas uma célula pode
        aparecer como 2 quadrados ou sumir, e a malha "escorrega" sobre o terreno ao girar o globo (é
        presa à câmera, não ao chão). O pincel continua agindo nas células. Custo: ~2–3 dias, só
        shader, desempenho parecido com hoje.
     d. **Trocar a grade** (por exemplo, hexágonos num icosaedro, 12 pentágonos no lugar dos cantos):
        sem emendas em ângulo reto, todas as células quase do mesmo tamanho. Mas é refazer quase tudo
        (grade, vizinhança de 4 para 6, clima, tectônica, texturas, desenho, testes, sementes mudam) e
        a cara deixa de ser de quadrados. Custo: semanas; risco alto de desempenho no celular. Seria
        assunto de outro marco.
   - **Recomendação:** (a) agora, ou (b) se incomodar no jogo. A (c) resolve melhor a aparência, mas
     troca um defeito visível parado por um "escorregar" visível ao girar. **Decisão do usuário.**
   - **Decisão do usuário (2026-10-17):** "não pode ficar cubado; dá um jeito de alisar e manter
     funcional". Feito um alisamento só no desenho (ver `docs/decisoes.md`, "Vista de perto alisada"):
     costas e divisas curvas, sem dobra nas emendas, contorno também nas emendas.

Registrado também: ideia para depois de **zoom maior**, para caberem humanos pequenos (montanha de 50
pixels com homem de 5 fica estranho): marcos 3, 4 e 8 (`docs/02-marcos.md`).

### G4 — Andamento (2026-10-16): feito, parado na erosão (decisão do usuário)
**Decisões do usuário:** fontes de variedade 1 a 5 aprovadas; ombreira de rifte (6) entra no G4; se a
erosão atual apagar a variedade antes do teste dos 10 min, avisar antes de mexer nela.

**Feito (código em `src/world/tectonics.ts`, testes em `tests/world/collision-mountains.test.ts`):**
crosta consumida vira montanha na placa de cima (sino, planalto no teto); colisão oblíqua mais baixa
e larga; picos e passagens ao longo da frente; províncias de crosta (crátons param a cordilheira em
escarpa); ombreira de rifte (600–1.600 m, de 3 a 6 células da fenda, só em terra). Todos os testes
passam (252).

**Medido (N = 256, 5 sementes, aos 10 min; % da terra acima de 2.000 / 4.000 / 6.000 m):**

| Erosão (por recomposição) | > 2.000 m | > 4.000 m | > 6.000 m | pico |
|---|---|---|---|---|
| Antes do G4 (3,5%, alisamento 25%) | 4,3–11,2% | 0,00–0,45% | 0% | ~4.730 m |
| **G4 com a erosão de hoje** (3,5%, 25%) | 4,1–11,7% | **0,03–0,74%** | 0% | ~4.730 m |
| G4, erosão 1% (alisamento 25%) | 4,4–12,0% | 0,03–0,96% | 0% | 4,8–6,0 km |
| G4, erosão 1,5%, alisamento 8% | 6,7–13,2% | 0,08–1,12% | 0% | 4,8–5,9 km |
| **G4, erosão 0,5%, alisamento 3%** | 7,6–13,8% | **0,44–1,46%** | 0–0,15% | 5,7–6,6 km |
| G4 sem erosão nenhuma | 8,1–14,3% | 1,24–2,72% | 0,24–1,56% | 7.000 m |
| Alvo (Terra, aproximado) | 5–15% | 0,5–4% | < 0,3% | — |

- **Sim, a erosão de hoje apaga a variedade:** a crosta chega (82–97% vira montanha), mas aos 10 min
  só a `terra` fica no alvo de 4.000 m. Os picos param em ~4.730 m (equilíbrio da erosão).
- **Quem achata mais é o alisamento** (acima de 1.200 m, 25% em direção à média das vizinhas a cada
  recomposição), não só a erosão dos picos.
- **A causa de fundo:** a colisão só ergue até a solda (8 recomposições); depois disso não entra
  crosta nova e qualquer erosão baixa a cordilheira. Na Terra, a Índia continua empurrando a Ásia.
- **Planalto (decisão 2): o primeiro caso, medido.** A faixa acima de 4.000 m chega no máximo a 17
  células (~660 km), menor que o Tibete (~1.000 km). Sem limite extra.
- **Custo:** recomposição no ajudante igual à de antes (pior 300–640 ms, como sem o G4); a geração
  não muda.

**Opções para a erosão (decisão do usuário):**
- **(a) Erosão 0,5% e alisamento 3% (recomendada).** Medido: 4 das 5 sementes no alvo de 4.000 m (a
  `7` fica em 0,44%), todas no de 2.000 m e no de 6.000 m. Efeito no jogo: montanhas duram ~7 vezes
  mais (uma cadeia velha baixa em ~8 min em vez de ~1 min, a 20× com placas 100%) e o relevo alto fica
  mais áspero. A erosão pelo clima da T7 entra por cima disso.
- **(b) A colisão continua empurrando depois da solda** por um tempo (Himalaia em andamento), com a
  erosão de hoje. É mudança na regra de placas, maior e com mais risco nos testes de solda e
  oscilação.
- **(c) Deixar a erosão como está até a T7.** A variedade aparece nos primeiros minutos de cada
  colisão e some em ~1 min; o teste de 10 min do G4 fica de fora.

### G3 — Resultado (2026-10-16)
**Como funciona** (detalhes em `docs/03-mundo-geologia.md`, constantes em `src/world/rifts.ts` e
`src/world/tectonics.ts`):
- Riftes traçados célula a célula (busca de caminho): seguem perto da sutura antiga, preferem terreno
  baixo, evitam montanha, serpenteiam e andam em degraus de falha transformante. Os dois lados da
  linha se encaixam com dentes e reentrâncias (`docs/img/m2-g3-fenda-terra.png`).
- Junção tríplice com braço que falha (1/3): aulacógeno, vale de 1–2 células.
- Ruptura com 2 pedaços ganha um terceiro braço para dentro do pedaço maior: falha (1/3) ou corta e
  cria placa nova. Microcontinente com chance de 25%.
- Margens passivas iguais dos dois lados. Placas novas até 16 (reaproveita números de placas que
  sumiram).
- Geração v3: a quebra da Pangeia usa o mesmo mecanismo, no nascimento
  (`docs/img/m2-g3-quebra-terra.png`: 0, 1 e 3 min).

**Decisões técnicas tomadas no caminho** (registradas em `docs/decisoes.md`):
1. **Rifte que abre como zíper.** Sem ele, vales de rifte que abrem devagar ligavam continentes (a
   falha conhecida da correção 1). Onde a fenda já virou mar, o mar avança pelo vale que ainda liga as
   duas margens, só se as placas ali ainda se afastam. Rifte parado continua vale em terra (sua
   decisão da correção 1).
2. **Placa com mais de 35% da terra é cortada na geração** por um braço de costa a costa (o "braço que
   corta dentro de uma placa"). Algumas sementes nasciam com uma placa de até 49% da terra, que nunca
   viraria um continente abaixo de 40%.
3. **Microcontinente anda com a média das duas placas da fenda.** Com "metade da velocidade da placa
   de onde saiu", ele ficava à frente dela e era engolido de volta logo depois (acreção). Na média, as
   duas placas se afastam dele: ele fica para trás no oceano que se abre, mais lento que as duas em
   relação à fenda.
4. **A primeira dispersão fica como no G1.** Usar nela a regra das dispersões seguintes (não empurrar
   vizinhos) não melhorou as formas: 11 contra 12 de 20 sementes aos 3 min.
5. **O teste de oscilação conta a acreção como evento**, como já contava a troca de rumo: uma placa
   pequena absorvida inteira numa colisão devolve as células que tinha acabado de cobrir uma vez só.
   O teste de "a fenda abre" ignora os degraus de falha transformante (correm junto com o movimento,
   nem abrem nem fecham) e mede à parte a fenda principal (< 10% fechando) e o braço novo, que é curvo
   (< 20% no conjunto).

**Medido:**
- **Falha conhecida resolvida:** os testes de formas de `terra` e `mundo` voltaram a ser testes normais
  e passam, com o mesmo critério (aos 3 min, N = 128: `terra` 34%, `mundo` 30%, `7` 28%).
- **Falha conhecida (registrada a pedido do usuário, 2026-10-16):** 8 de 20 sementes ficam fora do
  critério de formas aos 3 min (N = 128): `42`, `ilha`, `s1`, `s3`, `s6`, `s7`, `s12`, `s13` (sementes de
  teste `s0`–`s14` mais as 5 de sempre). Causa principal: dois continentes que colidem e se soldam logo
  depois da quebra (dinâmica de dispersão do G1/G2). Os testes de CI (`terra`, `mundo`, `7`) passam.
- **20 sementes, N = 128, 3 min:** 12 de 20 no critério (antes do G3: 8 de 20). As que falham têm, em
  geral, dois continentes que colidem e se soldam logo depois da quebra (dinâmica da dispersão do
  G1/G2), não vale de rifte.
- **N = 256, 5 sementes, aos 2, 5 e 10 min fora da fase de supercontinente:** 6 de 8 medições no
  critério (antes: 7 de 13). As 2 que falham estão na fase de reunião (`mundo` aos 5 e 10 min). A `42`
  forma supercontinente já aos 2 min (ressalva conhecida do G2).

  | Semente | 2 min | 5 min | 10 min |
  |---|---|---|---|
  | `terra` | 6 cont., 34% | supercontinente | supercontinente |
  | `mundo` | 6 cont., 32% | 3 cont., 60% (reunião) | 4 cont., 49% |
  | `7` | 5 cont., 32% | 5 cont., 31% | 4 cont., 52% |
  | `42` | supercontinente | supercontinente | supercontinente |
  | `ilha` | 5 cont., 30% | 5 cont., 31% | supercontinente |
- **Índice de recorte** (células de costa ÷ √área, média dos continentes) parecido com o de antes:
  sobe em `7` e `ilha`, cai um pouco em `terra` e `mundo`. **Mares internos:** 2 a 4 por mundo.
  Penínsulas e golfos são para você julgar no celular.
- **Desempenho (notebook, Chromium):** geração 753 → 820 ms de mediana (placas 175 → 271 ms). Na
  proporção do celular (952 ms → 2,7 s), a geração deve ir para ~2,9–3,0 s: dentro da meta de 3 s, mas
  no limite. Recomposição com placas 100%: 435–520 ms no ajudante, relógio a 240 passos/s, "relógio
  esperou 0 ms". O relatório do aparelho decide.

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
- [x] **Correção 1 — Vale de rifte:** fenda entre continentes com menos de 3 células nasce como vale
  (vizinhas −300 a −800 m); com 3 ou mais, o meio vira fundo oceânico. Teste sintético de 2 placas.
- [x] **Correção 2 — Ajudante 2 "Terra":** (2a) teste de memória compartilhada no celular; (2b)
  recomposição e clima no ajudante 2, aplicados num passo fixo à frente; "pior" do relatório por cenário.
  - **2a (portão):** "sim" no Hot 50i (`c864756a`). O service worker acrescenta os cabeçalhos de
    isolamento; a primeira visita recarrega uma vez. O usuário viu uma recarga também ao reabrir: o
    painel Dados agora conta as recargas que o jogo faz ("recargas p/ isolar"); se o número não subir
    ao reabrir, a recarga vista foi do navegador, não do jogo.
  - **2b:** o motor da geologia (`src/sim/geology.ts`) anda pelos mesmos passos do relógio, na ordem
    dos comandos. Uma recomposição feita no passo T aparece no passo T + 480 (`APPLY_DELAY_TICKS`: 40
    anos, 2 s a 20×). O relógio nunca fica mais de 480 passos à frente do motor: se o ajudante atrasar,
    o relógio espera e o resultado não muda. Pinceladas viajam como "placa + ponto do referencial dela";
    as feitas enquanto a recomposição está no ajudante valem de novo quando ela aparece. Grade, tabelas
    do clima e do sombreado são compartilhadas; o mundo existe duas vezes (o do relógio e o de trabalho
    do ajudante). Sem memória compartilhada, o mesmo motor roda no relógio (como antes, o tempo para na
    recomposição).
  - **Testes:** o mundo final é idêntico com o motor no relógio, num ajudante atrasado e num muito
    atrasado (pincel dentro e fora da janela, ruptura forçada, troca de velocidade das placas); a
    recomposição aparece exatamente 480 passos depois; pincelada na janela não some; o relógio conta o
    tempo esperando.
  - **Medido no notebook (Chromium, `terra`):** placas 100% a 20×: 240 passos/s com e sem
    recomposição (antes caía), relógio ocupado 0%, "relógio esperou 0 ms"; recomposição no ajudante
    450–530 ms; aplicar no relógio 4–5 ms. Suavidade igual à de antes (1 salto de imagem em 30 s nas
    duas versões). Memória da simulação 46 → 69–70 MB (+23 MB: segundo mundo, cores e tabelas do
    ajudante), um pouco acima da estimativa de +15–20 MB.
  - **Relatório:** "pior" agora é por cenário; nova parte "relógio esperou X ms" (quanto o relógio
    parou esperando o ajudante); "envio" virou "aplicar".
- [x] **G3 — Riftes traçados e formas:** braços serpenteando com degraus, aulacógeno,
  microcontinentes, geração v3 (se aprovada), números de placa; critério de formas aos 2, 5 e 10 min;
  mapas antes/depois.
  Os testes de formas de `terra` e `mundo` voltaram a passar como teste normal (resultado abaixo).
- [x] **G4 — Continente amassa e vira montanha** em vez de ser apagado na colisão, com variedade de
  relevo (províncias de crosta, escarpas, colisão oblíqua, picos e passagens, ombreira de rifte).
  Resultado em "G4 — Resultado".

## Estado em 2026-10-15 (noite) e próximos passos
Feito no `marco-2` (prévia em `/previa/marco-2/`): T1–T5, correção do travamento no celular, D1–D5 e
a correção dos pedaços de placa (commit `d36c156`, confirmada no celular: a oscilação sumiu; o
relatório do aparelho bateu todas as metas de fps e geração).

Bloco G aprovado. **G1 e G2 feitos** (G1 aprovado pelo usuário com o relatório do aparelho; G2 testado
no celular em 2026-10-16, diagnósticos e decisões na seção "G2 — Teste no celular"). Próximo:
correção 1 → correção 2 → G3 → G4. Ainda pendentes: confirmar no celular o travamento em 92% e os lagos retos
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
