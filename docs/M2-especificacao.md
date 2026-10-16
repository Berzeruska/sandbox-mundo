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

## Proposta: costas recortadas pela geologia (aguardando aprovação do usuário)
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
