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
cada bloco, com a prévia e a lista numerada do que testar no notebook (aparelho-alvo desde
2026-10-17; paradas obrigatórias no meio: decisão de design, teste de portão, meta de desempenho
quebrada na medição).
1. **Bloco G:** correção 2, G3, G4.
2. **Minerais e clima:** T6, T7.
3. **Desastres:** T8 a T12 (feito; o usuário pediu o redesenho em 2026-10-17).
4. **Desastres v2:** R1 a R9 (redesenho, abaixo de T12; espera aprovação da especificação).
5. **Final:** T13, T14 (medição contra a linha de base da v1.1).

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

- [x] **T6 — Recursos minerais e petróleo** (`src/world/resources.ts`)
  Depósitos de ferro, cobre, ouro, nióbio, petróleo, carvão (e outros) gerados pela geologia real:
  cobre (e ouro) em arcos de subducção; ferro (e ouro) em crátons antigos; petróleo e carvão em bacias
  sedimentares; nióbio em carbonatitos raros. Cada depósito pertence a uma placa e **se move com ela**.
  Camada opcional "Ver recursos" no menu Geologia. Determinístico pela semente.
  Só a geração e a visualização; o **uso** fica para os Marcos 4 (economia) e 7 (militar).
  Testes: cada tipo só aparece no ambiente geológico certo (ex.: nenhum cobre longe de subducção
  antiga ou atual); nióbio é raro (abaixo de um limite de depósitos); depósitos acompanham a placa
  (após girar uma placa, os depósitos dela giram junto); mesma semente, mesmos depósitos.
  Detalhes em `docs/03-mundo-geologia.md`.

  **T6 — Decisões do usuário (2026-10-17).**
  1. **Nascem na geração e durante a deriva:** arco de subducção ativo há tempo ganha cobre/ouro,
     rifte e margem passiva antigos ganham petróleo, colisão ganha ouro; crosta que afunda leva o
     depósito junto.
  2. **19 tipos**, cada um com cor própria e grupo (filtro por tipo e por grupo na legenda):
     - metais: ferro, cobre, ouro, prata, estanho, alumínio (bauxita), manganês, cromo, nióbio,
       terras raras, lítio;
     - energia: petróleo (também no mar raso, na plataforma continental), carvão, urânio;
     - agricultura: potássio, nitratos;
     - indústria: sal, enxofre, calcário.
     Onde cada um se forma: `docs/03-mundo-geologia.md`. **Cromo** também em intrusões antigas dentro
     de crátons (como o Bushveld), não só em ofiolitos. Urânio existe no território desde já; poder
     usar é outra coisa (M7).
  3. **Quantidade: províncias com jazidas desiguais, poucas e importantes** (menos que o "médio" de
     ~400, já que elas também se formam com o tempo). Regiões ricas num tipo, poucas jazidas grandes e
     várias pequenas, quase nada fora das províncias; nenhum continente tem de tudo. Raridade como no
     mundo real (calcário e carvão comuns; nióbio, terras raras e nitratos raros).
  4. **Nome só quando o jogador toca na jazida;** nada de nomes flutuando no mapa.
  5. **Visual, só se não pesar no celular (proposta e custo abaixo, esperando aprovação):** minério
     sólido aparece como pedrinhas ou solo diferente, não ponto colorido; petróleo fica escondido no
     subsolo e aparece como buraco ou mancha escura quando o terreno é cavado com Rebaixar; na camada
     "Ver recursos" o jogador vê tudo, inclusive o petróleo escondido ("escondido" vale para os
     humanos, M4).
  6. **Fora da T6, só anotados:** água potável (M3/M4), fontes de energia para usinas (M4/M7),
     humanos escavando também revelam petróleo (M4). Ver `docs/02-marcos.md`.

  **T6 — Resultado (2026-10-17).** Visual aprovado pelo usuário (pedrinhas, cor leve no solo, petróleo
  escondido até o Rebaixar, camada no menu Geologia) e toque opção (a). Feito:
  - 19 tipos em províncias, ~45–70 jazidas por mundo na geração (5 sementes), 1–15 células cada, com 1
    célula de folga entre jazidas; nióbio 1 por mundo. Etapa "recursos" da geração: 13–19 ms no
    notebook (estimativa no celular 60–85 ms; geração estimada ~2,88 s, meta 3 s).
  - Formação durante a deriva: arco (cobre, ouro, prata, enxofre, lítio se seco e alto), colisão (ouro,
    estanho, cromo), rifte continental (petróleo, sal); ~1 jazida a cada ~50 s reais com placas a 100%
    em 20×, medida no relógio da deriva (igual em qualquer resolução). Crosta que afunda leva a jazida.
  - Visão normal: tom leve do minério no solo (de longe); de perto 3, 5 ou 6 pedrinhas na cor do tipo;
    petróleo invisível até o Rebaixar cavar em cima (miolo do pincel), aí mancha preta brilhante (em
    terra ou no mar), revelada para sempre.
  - Camada "Ver recursos" (menu Geologia): terreno cinza, jazidas do filtro fortes na cor do tipo com um
    halo de 5 células (senão de longe uma jazida tem 1–2 pixels), petróleo escondido listrado. Legenda
    acima da barra de baixo: Todos · Metais · Energia · Agricultura · Indústria; o grupo abre os tipos
    dele, com a cor de cada um; some com o menu aberto.
  - Toque (opção a): com a camada ligada, toque curto numa jazida (ou numa vizinha) mostra
    "Cobre · jazida grande" por 3 s e não pinta; toque fora de jazida pinta uma vez como antes; segurar
    300 ms ou arrastar pinta. No modo Mover, o toque curto também mostra o nome.
  - Desempenho de perto no notebook igual (~390 girando, ~410 com placas): só as células com jazida
    leem a textura nova.
  - Testes: ambiente certo para cada tipo, tamanho e terra/plataforma, quantidade e nióbio raro,
    províncias, determinismo, jazidas giram com a placa, formação na deriva (tipo certo por frente,
    determinística), Rebaixar revela e Elevar não, cores e filtro da camada, legenda, espera do toque.

  **T6 — Proposta do visual (2026-10-17, aprovada pelo usuário).**
  - **Jazida = um grupinho de células** (pequena 1–2, média 3–6, grande 8–15), com a forma seguindo
    a geologia (ao longo do arco, dentro da bacia). Assim a jazida grande se vê de longe e a pequena
    só de perto.
  - **Dados para o desenho:** uma textura nova com 1 byte por célula (tipo em 5 bits, tamanho em 2,
    petróleo revelado em 1), enviada junto com as cores depois de cada recomposição e de cada pincel.
    0,4 MB na GPU (mais 0,4 MB da cópia para a transição suave).
  - **Visão normal, de longe:** o solo das células da jazida fica levemente puxado para a cor do
    tipo (ferro avermelhado, cobre esverdeado, bauxita alaranjada, calcário claro, carvão escuro…),
    misturado na cor da célula pelo ajudante 2, que já calcula as cores. **Custo na tela: zero.**
  - **Visão normal, de perto** (células quadradas): 3 a 6 pedrinhas redondas por célula, na cor do
    tipo, com borda escura, posições fixas por célula (não cintilam). Só a célula escolhida para o
    pixel lê a textura nova (1 leitura a mais) e só as células com jazida (~1% da terra) desenham as
    pedrinhas. **Custo estimado de perto: +3–6% de GPU**; de longe, nada.
  - **Petróleo:** invisível na visão normal até ser cavado. Rebaixar numa célula com petróleo marca a
    jazida como revelada: aparece uma mancha preta brilhante e irregular na célula (no mar raso, uma
    mancha escura na água). Fica revelada para sempre (os humanos do M4 vão ler esse estado).
  - **Camada "Ver recursos":** o terreno fica acinzentado e escurecido; as jazidas aparecem fortes,
    na cor do tipo, com contorno; o petróleo ainda escondido aparece listrado (o jogador sabe, os
    humanos não). O filtro da legenda é uma máscara de 19 bits mandada para a GPU: trocar filtro não
    custa nada na CPU. Legenda compacta: 4 grupos; tocar num grupo abre os tipos dele; tocar num tipo
    mostra só ele. **Custo estimado: +5–8% de GPU com a camada ligada** (1 leitura a mais por pixel);
    desligada, nada.
  - **Nome ao tocar:** um balão pequeno "Cobre · jazida grande" perto do dedo por 3 s. Precisa
    decidir como convive com o pincel (pergunta ao usuário).
  - **Custo na simulação:** formação durante a deriva só olha as fronteiras na recomposição do
    ajudante 2 (estimativa < 5 ms em ~300 ms); a jazida vive na amostra de crosta da tectônica, então
    andar com a placa e sumir na subducção não custa nada a mais. **Geração: +~50–100 ms estimados**,
    com a geração em 2,8 s no celular (meta 3 s): no limite, medir antes de seguir.
  - Os números de custo são estimativas; meço no notebook (GPU real e CPU 6× mais lenta) ao
    implementar, e o "Medir desempenho" do celular decide no fim do bloco.

- [x] **T7 — Clima que acompanha a deriva, eras glaciais e temperatura global**
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

  **T7 — Diagnóstico (2026-10-17, medido; sem código).** 5 sementes (`terra`, `mundo`, `42`, `7`,
  `pangeia`), N = 256, na geração e depois de 3 min de placas a 100% em 20×.
  - **Gelo e polos.** Gelo hoje é só temperatura média: terra abaixo de −12 °C, mar abaixo de −10 °C.
    O mar congela a partir de ~73° de latitude (60–77% do mar entre 70° e 80°, 100% acima de 80°):
    duas calotas redondas, que não dependem de haver continente ali e não mudam com nada. Terra entre
    60° e 70° tem só 0–35% de gelo (tundra e taiga); entre 70° e 80°, 82–95%. É a Terra de hoje
    (Sibéria e Canadá a 60–70° sem calota). O gelo é uma cor branca lisa (quase sem textura): de
    perto não parece gelo.
  - **Neve.** "Pico nevado" = montanha acima de 3.200 m abaixo de 0 °C, sem olhar a chuva: 762 dos 854
    picos nevados de `42` têm chuva abaixo de 300 mm/ano (montanha seca e branca). Além disso, montanha
    alta em latitude média passa de −12 °C e vira "Gelo" (calota) inteira. O vale de rifte entre duas
    montanhas pintadas fica só 300–800 m abaixo delas (2–5 °C mais quente) e continua acima da linha
    de neve (`docs/bugs.md`).
  - **Biomas.** O clima varia (temperatura na terra de −13 a 23 °C, chuva de 90 a 1.500 mm), mas o mundo
    é seco: chuva mediana na terra 350–600 mm (a Terra tem ~700); desertos quentes e frios somam 20–35%
    da terra, floresta temperada só 2–6%, floresta tropical 5–10%, pântano < 0,5%. Estepe, desertos e
    savana são beges parecidos: daí a cara de "pouco variado". Não falta bioma na lista para isso;
    bioma novo seria escolha de gosto (pergunta 5).
  - **Ciclo glacial e temperatura global:** não existem ainda. O clima só é recalculado na recomposição
    das placas (no ajudante 2); com placas em 0 ele não muda.

  **T7 — Proposta (esperando decisões do usuário).**
  - **Técnico (decido eu):** o clima passa a ter uma temperatura global (ciclo + controle) e é
    recalculado também sem placas, de tempos em tempos, no ajudante 2; a tela recebe só as células que
    mudaram (gelo, bioma, cor). Teste: o recálculo parcial bate com o total.
  - **Neve pelo que o usuário pediu (altura, latitude e chuva):** neve e geleira de montanha só com
    frio **e** chuva bastante (≥ ~350 mm/ano); montanha alta e seca fica rocha (cinza). Com isso o vale
    de rifte, mais baixo e mais seco (sombra das duas bordas), perde a neve; confiro no cenário do bug.
  - **Erosão pelo clima:** a erosão de hoje (0,5% por recomposição) passa a depender da chuva: lado
    chuvoso até 2× (vira escarpa), seco (< 300 mm) 0,25× (planalto sobrevive). Re-medir as altitudes
    aos 10 min (alvo do mundo real).
  - **Perguntas ao usuário:** ver "Perguntas da T7" logo abaixo.

  **Perguntas da T7 (2026-10-17).**
  1. **Ciclo glacial (ritmo e força).** (a) suave: −4 °C no máximo glacial, gelo em terra desce até
     ~55°, ciclo de ~10 mil anos de jogo (~8 min reais a 20×); (b) forte: −8 °C, gelo desce até ~45°
     e o **nível do mar cai** (plataformas viram terra, aparecem pontes de terra entre continentes),
     mesmo ritmo; (c) outro ritmo/força.
  2. **Controle de temperatura global** (menu Clima): faixa −10 a +10 °C somada ao ciclo (recomendado),
     ou outra faixa.
  3. **Gelo e polos.** (a) como a Terra hoje (60–70° sem calota; o gelo cresce no ciclo glacial) e só
     melhorar a cara: textura de gelo (fendas, azul nas bordas), gelo marinho mais fino e com borda
     irregular, calota em terra mais branca e espessa; (b) o mesmo e mais gelo já no clima normal:
     terra acima de ~62° vira calota (limite −12 → −6 °C).
  4. **Remendo nas fronteiras de placa** (diagnóstico acima, "Teste no celular (2026-10-17,
     `751d6e39`)"): aprovar a proposta (cada pixel só escolhe células da própria placa; fenda entre
     dois continentes pintada como vale de rifte)?
  5. **Biomas.** (a) mais chuva no interior dos continentes (a umidade do mar chega mais longe):
     menos deserto, mais floresta e campo, sem bioma novo; (b) (a) e biomas novos: arbustal
     mediterrâneo, manguezal, prado alpino (quais?); (c) deixar como está.

  **T7 — Decisões do usuário (2026-10-17):** ciclo glacial (b) forte, −8 °C, gelo até ~45°, mar caindo
  e abrindo pontes de terra; controle −10 a +10 °C no menu Clima, somado ao ciclo; gelo e polos (b),
  cara melhor e terra acima de ~62° vira calota; remendo nas fronteiras aprovado; biomas: corrigir a
  distribuição (bioma novo só perguntando, com o custo; limite atual 16); camada "Ver biomas" e biomas
  legíveis de longe.

  **T7 — Resultado (2026-10-17).**
  - **Temperatura global** = ciclo glacial + controle do jogador, com os polos esfriando mais que os
    trópicos (0,5× no equador, 1,8× no polo). Ciclo: esfria devagar (80% do ciclo) até −8 °C e esquenta
    rápido; 10 mil anos de jogo (~8 min reais a 20×); começa no clima normal. Linha "clima" no painel
    Dados (desvio, controle e nível do mar).
  - **Gelo:** calota em terra abaixo de −10 °C de média: no clima normal 24% da terra a 62°, 61% a 65°,
    96% a 70°; no máximo glacial 25% a 45°, 61% a 50°, 90% a 55° (5 sementes). Mar congelado com a
    borda irregular (correntes, ±4 °C). Cara: calota branca com borda azulada e variação; gelo marinho
    mais fino (deixa ver o mar), mais azul na borda; de perto, fendas raras na calota. Jazida coberta de
    gelo não aparece (só na camada "Ver recursos").
  - **Mar:** desce 15 m por grau (−120 m no máximo glacial), em degraus de 10 m; a costa anda e o clima é
    refeito. **Ressalva medida:** as plataformas continentais geradas são estreitas, então −120 m só
    acrescentam ~0,5% de terra (30,0 → 30,5%): pontes de terra aparecem só onde o estreito é raso. Se
    o usuário quiser mais pontes, o caminho é plataformas mais largas (geração e tectônica): perguntar.
    A geologia usa o nível de referência fixo (o mar baixo não muda as placas).
  - **Neve:** pico nevado e geleira de montanha só com frio e chuva ≥ 250 mm/ano; montanha alta e seca
    fica rocha. Vale de rifte (mais baixo e mais seco) deve perder a neve: confirmar no celular.
  - **Erosão pelo clima:** a erosão das montanhas multiplicada pela chuva (0,25× seco, até 2× chuvoso).
    Os testes de altitude aos 10 min e de formas continuam passando.
  - **Biomas (diagnóstico pedido):** o problema era a distribuição (clima seco demais), não falta de
    bioma. Umidade do mar chega mais longe e chuva base +35%: chuva mediana na terra 348 → 595 mm,
    desertos 27 → 16%, florestas ~10 → 19%, estepe 14%, campo 8%, savana 10%, tundra 7%, taiga 10%.
    Paleta mais separada (floresta mais escura, deserto mais claro, campo mais verde, savana dourada).
  - **Camada "Ver biomas"** (menu Clima): cada bioma numa cor forte e lisa, legenda embaixo, toque curto
    (modo Mover) mostra o nome.
  - **Clima ao longo do tempo:** o ajudante 2 refaz o clima a cada 0,2 °C de mudança (ou degrau do mar),
    mesmo com placas paradas: só temperatura, gelo e biomas (parcial, 22 ms no notebook) ou tudo quando
    o mar muda (65 ms); a tela recebe só os pedaços com cor nova. O controle do jogador vale na hora
    (prévia no relógio). As pinceladas agora também entram no mundo do ajudante.
  - **Remendo nas fronteiras (aprovado):** de perto, cada pixel só usa células da própria placa (sem a
    cópia deslocada); a fenda entre continentes é pintada como vale (marrom), não como oceano. Os
    pontos que o usuário viu no celular ficam na lista de teste do fim do bloco.
  - **Custo:** de perto igual no notebook (~390 girando, 340–400 com placas). Pintar as cores do mundo
    20 → 30 ms no notebook (gelo, jazidas, cantos): geração estimada no celular ~2,93 s (meta 3 s, no
    limite).
  - Testes novos (`tests/world/climate-cycle.test.ts`): parcial = total; gelo cresce com menos
    temperatura e recua com mais; ciclo e controle se somam; forma do ciclo; mar −120 m e geologia
    igual; neve depende da chuva; erosão maior no lado chuvoso; clima segue o ciclo no jogo com placas
    paradas; controle muda o clima na hora.

  **Teste rápido da T6 no celular (2026-10-17) — propostas esperando o usuário (sem trocar ainda):**
  1. **Pedrinhas "fofinhas":** proposta rústica em `docs/img/m2-t6-pedras-rusticas.png` (em cima hoje,
     embaixo a proposta): pedras angulosas de duas faces (uma clara, uma na sombra), cor puxada para
     rocha, meio enterradas, e um veio do minério riscando o solo. Custo: igual (só nas células com
     jazida, ~1% da terra).
  2. **"Achei poucos" — diagnóstico:** são as duas coisas. Há 45–70 jazidas por mundo, ~0,2% da terra
     (250–300 células de ~118 mil). E elas são pequenas na tela: no zoom 1 uma célula tem ~1,4 pixel,
     então uma jazida grande (8–15 células) tem ~5 pixels e uma pequena (1–2) quase some; o tom no solo
     é fraco (22%) de propósito. Opções: (a) jazidas maiores (pequena 3–6, média 10–20, grande 25–45
     células), mesmo número (recomendado: continuam "poucas e importantes" e aparecem); (b) o dobro de
     jazidas, mesmo tamanho; (c) as duas.
  3. **Costa em "bolhas":** proposta reta em `docs/img/m2-costa-reta.png` (em cima hoje, embaixo a
     proposta): cada ponto mostra só a célula de centro mais perto, sem o alisamento por pesos. Divisas
     e costas viram retas: quadrados (degraus) no meio das faces e hexágonos perto dos 8 cantos do cubo,
     sem a dobra das emendas. Custo medido no notebook: igual (384 e 403 fps de perto); no celular deve
     ser igual ou um pouco menor (menos contas por pixel).

  **Teste da `50f0dca` no notebook (2026-10-17) — o que mudou** (detalhes em `docs/decisoes.md`):
  - Decididas: minério sem bolinhas (mosaico de pixels quadrados); jazidas maiores, mesmo número,
    surgindo a cada 1.000–10.000 anos por frente; costa reta aprovada; plataforma larga (pontes de
    terra no máximo glacial: terra 30% → ~32–33,5%).
  - Corrigidos: pontos rosa/azuis no gelo (cor estourando o byte); controle de temperatura brusco (agora
    anda 1 °C/s até o valor); formas redondas entre os pixels (quadrados a partir de 3–6 px); faixas
    arrastadas nas fronteiras de placa de longe (borda orgânica lia a outra placa).
  - Notebook: setas ↑/↓ zoom, ←/→ giro, mãozinha sobre o globo, toque curto mostra bioma e jazida.
  - **Proposta dos polos esperando o usuário** (`docs/img/m2-polos-proposta.png`, em cima hoje,
    embaixo a proposta): o gelo marinho deixa de ser um disco liso — borda em lobos grandes (ruído
    fixo por mundo, ±8 °C), uma faixa de ±3 °C na borda partida em placas soltas de algumas células, e
    a cor pela espessura (fino e azulado perto da borda, deixando ver o mar; grosso e branco no miolo),
    com tons por placa de gelo. Custo medido: um ruído calculado uma vez por mundo, +~60 ms na geração
    (0,87 → 0,93 s em 5 sementes, N = 256, sem o ajudante); o desenho não muda.

- [x] **T8 — Terremotos e tsunamis** (`src/world/disasters/`) — versão 1, refeita no Bloco Desastres v2
  Tensão nas fronteiras, liberação e magnitude; tsunami que se propaga no oceano e alaga costa baixa
  temporariamente; desenho das ondas na camada sobreposta.
  Testes: terremotos só perto de fronteiras; tsunami só a partir de terremoto no mar e forte;
  efeitos temporários se recuperam; determinismo.
  **Feito (2026-10-17):** tensão por trecho de fronteira (par de placas + tipo), acumulando por ano de
  jogo com comprimento × velocidade relativa × tipo (convergente 1, transformante 0,7, divergente
  0,25), só com as placas andando; terremoto quando passa de um limite sorteado, magnitude de
  Gutenberg–Richter (b = 0,8) de 5,5 até o máximo do tipo (9,3 / 8 / 6,8); grande a partir de M 7
  (~1 a cada 200–280 anos em "Raro", 3 sementes, N = 256). Tsunami de terremoto no mar com M ≥ 7,5:
  a onda anda pelo mar com √profundidade (mínimo 0,4 da velocidade do fundo, para atravessar a
  plataforma larga), alcance e altura na costa pela magnitude; terra baixa encostada alaga por 8 anos.
  Marcas temporárias numa camada de perturbação por célula (alagado, cinzas, queimado, seco) que vão
  sumindo e tingem a cor. Animações em tempo real na camada de cima (anéis do terremoto, frente da
  onda), independentes da velocidade do jogo. Testes em `tests/world/disasters.test.ts`.

- [x] **T9 — Vulcões e pontos quentes**
  Arcos de subducção, dorsais (fraco), pontos quentes fixos; erupção ergue terreno **para sempre**
  (pode criar ilha) e espalha cinzas temporárias.
  Testes: ponto quente sob placa em movimento forma uma cadeia de ilhas; erupções só em lugares
  permitidos; relevo vulcânico persiste e as cinzas somem.
  **Feito (2026-10-17):** erupções em arcos (a 2–3 células da fronteira convergente, na placa de cima;
  IEV 2–7, cada nível 4× mais raro) e dorsais (IEV 0–2), com taxa por comprimento × velocidade da
  fronteira; 3–6 pontos quentes fixos no manto que erguem a placa que passa por cima, medido pela
  distância andada (cadeia igual com placa rápida ou lenta) e em pulsos (ativo em metade de cada 3
  células andadas: ilhas separadas em fila); debaixo de continente ergue pouco e a erupção é rara e
  explosiva. Toda erupção ergue o terreno para sempre (pincel de Elevar gravado na placa) e espalha
  cinzas em terra por 25 anos. Grande a partir de IEV 4 (~1 a cada 500–1.000 anos em "Raro").
  Animação: brilho, fagulhas e nuvem de cinzas. Medido: 3 ilhas em fila em 4.000 anos (N = 64).

- [x] **T10 — Desastres climáticos**
  Anomalias de chuva (seca, enchente), furacões com trajetória, incêndios; perturbação temporária
  com recuperação.
  Testes: furacão só nasce em oceano tropical quente e enfraquece em terra; incêndio só em floresta
  sob seca; frequências dentro da faixa esperada em 1.000 anos simulados.
  Pedido do usuário (2026-10-16), especificar na T10: **nuvens** simples e translúcidas que somem ao
  aproximar a câmera, formando tempestades e furacões em redemoinho; o evento altera só o clima da
  região dele.
  **Feito (2026-10-17):** seca (região de 5–13 células, mais provável onde já é seco, 5–15 anos),
  enchente (terra baixa e úmida, 2–5 anos), furacão (nasce só em mar a ≥ 26 °C entre 8° e 20°, anda
  para oeste, curva para o polo e para leste depois de ~25°, cresce em mar quente, perde força em terra
  e em mar frio; categoria 1–5; onde toca terra, a terra baixa alaga), incêndio (só em floresta dentro
  de uma seca já em curso, espalha pela floresta seca, área queimada se recupera em 60 anos). Continuam
  com as placas paradas. Grandes: seca com raio ≥ 12 células, enchente ≥ 110 células, furacão
  categoria ≥ 4 que toca terra, incêndio ≥ 60 células. Em "Raro", um desastre grande (de todos os
  tipos) a cada ~64–74 anos de jogo (~1 min em 1×). **Nuvens:** faixas pela latitude (muitas no
  equador e em ~55°, poucas nos desertos subtropicais), translúcidas, andando devagar só com o tempo
  correndo, somem ao aproximar (a partir de ~2–4 px por célula); furacões como espirais com olho,
  girando no sentido do hemisfério, andando pela trilha; interruptor "Nuvens" no menu Clima (ligado).
  O evento só muda as marcas da região dele (alagado, seco, queimado). Desempenho no notebook: igual
  (60 fps em todos os cenários).

- [x] **T11 — Desastres na mão do jogador e frequência**
  Em Desastres: ferramenta para provocar cada desastre e controle de frequência (nenhum → muitos),
  padrão "raro". Camadas "Ver placas" e "Ver tensão".
  Testes: frequência 0 não gera desastre natural; "raro" fica na faixa de ~1 notável a cada 1–2 min
  em 1×; provocar manualmente funciona com qualquer frequência.
  **Feito (2026-10-17):** os 7 desastres no menu Desastres: escolher e tocar no globo provoca ali
  (arrastar continua girando); os do jogador são sempre fortes (terremoto M 7–9, erupção IEV 4–6 que
  ergue mais, tsunami M 8,3–9,2 no mar mais perto, furacão categoria 3–5 no mar mais perto, seca e
  enchente grandes, incêndio de 40–150 células na floresta mais perto) e funcionam com qualquer
  frequência. "Frequência" com 5 níveis (Nenhum, Raro, Às vezes, Frequente, Muitos; ×0, ×1, ×2,5, ×6,
  ×15), na tela e no menu, padrão Raro. "Ver tensão" (Desastres): o mundo cinza e as fronteiras de
  verde-amarelo (pouca tensão) a vermelho (terremoto perto), com legenda; repintada a cada 2 anos.
  "Ver placas" continua em Geologia.

- [x] **T12 — Avisos e lista de desastres**
  Aviso curto só para desastres grandes; lista completa no painel; tocar leva a câmera ao local.
  (Não é a crônica permanente, que fica no M5.)
  **Feito (2026-10-17):** aviso no alto da tela só para desastre grande e natural (o provocado o jogador
  já está vendo), 6 s, até 3 ao mesmo tempo; "Lista" no menu Desastres abre o painel com os últimos 300 (a lista saiu na R2)
  (mais recentes primeiro, os grandes em destaque, "(provocado)" nos do jogador); tocar num aviso ou
  numa linha leva a câmera até o lugar (voo de 0,8 s). Mundo novo limpa a lista.

## Bloco Desastres v2 — redesenho (pedido do usuário em 2026-10-17, teste da `b3297292`)

**Aprovado pelo usuário em 2026-10-18 com ajustes** (respostas e ajustes no fim desta seção). Refaz
T8–T12; depois vêm T13 e T14. Imagens novas do terremoto, do vulcão e dos seletores aprovadas; a da
seca fica como está por enquanto; relevo em degraus (opção b) aprovado (segunda rodada de respostas,
2026-10-18, no fim desta seção).

### O que o usuário pediu
- **Regra geral:** todo desastre tem efeito visível que **muda o mundo** (terreno, bioma, vegetação),
  não uma "rodela" desenhada por cima. Mais parecidos com os do WorldBox no espírito (o desastre age
  célula por célula, no próprio mapa); pela regra 8, nada copiado: cores, regras e números são nossos.
- **Prioridade visual:** o que o desastre FAZ no mundo, legível. Acabamento fino (textura,
  partículas, animação caprichada) fica para o M8.
- Escolha de magnitude ao provocar terremoto, tsunami e furacão. Raio é desastre novo.
- Interface: sai a lista (Desastres → Lista); os desastres aparecem só como aviso, no canto inferior
  esquerdo.

### Base comum (vale para todos)
1. **Vegetação por célula, em porcentagem** (0–100%; princípio do usuário: as características do mundo
   em porcentagem). A cor da célula mistura a cor do bioma com a do **solo nu** daquele bioma pela
   cobertura: floresta a 30% fica marrom com manchas verdes. A vegetação **volta sozinha** com o tempo,
   na velocidade do bioma (até 100%): campo, estepe e savana 3–5 anos; pântano 10; tundra 20;
   floresta tropical 30; floresta temperada 40; taiga 60. Floresta que volta passa por campo.
   Desertos, gelo, montanha, picos e praia não têm vegetação para perder (o fogo não entra).
2. **Estados de célula** (mudam a cor; o bioma por baixo continua o mesmo, e tocar mostra
   "Floresta temperada · queimada 20%"): **em chamas**, **queimado**, **lava**, **basalto** (lava fria),
   **alagado** (água barrenta), **lama** (o que o tsunami deixa), **fenda** (terremoto), **solo fértil**
   (o que a enchente deixa), **calor** (seca). Cada estado tem duração em anos e vai sumindo.
3. **Os desastres andam passo a passo no relógio** (1 passo = 1 mês; 12 passos por segundo em 1×):
   o fogo avança célula por célula, a lava escorre, o furacão anda pelo mapa, a água sobe e desce.
   Tudo pelo sorteio com semente: mesma semente + mesmos comandos = mesmo mundo, em qualquer
   velocidade. **Consequência:** em 20× tudo passa 20× mais rápido (um incêndio de 15 s em 1× dura
   menos de 1 s). **Decidido (2026-10-18):** quando o jogador provoca um desastre, o jogo volta para 1×
   (se estiver mais rápido); desastre natural não mexe na velocidade.
4. **Mudança de terreno para sempre** (decidido em 2026-10-18, revertendo a decisão de 2026-10-15 de
   que só o vulcão mudava o relevo): vulcão ergue; tsunami raspa a costa; terremoto derruba encostas,
   para sempre e pouco. Sempre pelo mesmo caminho do pincel (gravado na placa, anda com ela).
5. **A camada que anda com as placas:** estados que duram séculos (basalto) andam com a crosta nas
   recomposições, como o relevo; os curtos ficam no lugar (detalhe técnico, decidido na implementação).
6. **Escala:** uma célula tem ~36 km (N = 256, planeta do tamanho da Terra). Para se ver no globo, os
   desastres são maiores que os reais (o tsunami real entra no máximo ~10 km em terra; aqui, células).

### Cada desastre (imagens: `docs/img/m2-dv-*.png`)
As imagens são um protótipo pintado por cima do globo de verdade (semente `terra`), para mostrar a
ideia e as cores; o furacão usa um teste do shader (as nuvens do globo torcidas em volta do centro).
O resultado final segue a especificação, não o protótipo.

**Incêndio** (`m2-dv-fogo-raio.png`)
- Queima aos poucos, de célula em célula: a cada 2 passos, cada célula em chamas tenta acender as 4
  vizinhas. Chance pela vegetação (campo, estepe e savana pegam mais e queimam rápido, em 1 passo;
  floresta queima em 3; floresta tropical e pântano pegam pouco, por serem úmidos), pela cobertura
  (vegetação rala pega menos), pela seca (×3) e pelo vento da latitude (o fogo corre a favor do vento,
  ×2, e quase não anda contra, ×0,5). **Campo pega fogo** (hoje não pega).
- Frente de fogo de ~2–4 células por segundo em 1×. Apaga sozinho quando a frente não acha mais o
  que queimar, ou ao chegar em água, deserto, montanha e gelo.
- Cor: em chamas laranja/amarelo; queimado quase preto; depois a vegetação volta (cobertura 0% →
  100% na velocidade do bioma).
- Começa por raio (o mais comum), por lava, pela seca e pelo jogador.

**Raio** (novo; `m2-dv-fogo-raio.png`)
- Cai debaixo das nuvens mais densas, nos furacões e nas tempestades; na seca, cai "seco" (raio sem
  chuva, o que mais acende fogo).
- O raio que cai em floresta ou campo começa um incêndio (chance pela cobertura e pela seca; no
  jogador, sempre). No mar, no deserto e no gelo não faz nada além do clarão.
- Visual: o raio em zigue-zague e um clarão (0,3 s), e a célula atingida em chamas.
- **Com o vulcão:** a erupção solta raios que acendem incêndios em volta; raio num vulcão adormecido
  pode acordá-lo (decidido em 2026-10-18; ver Vulcão).
- **Num furacão:** o raio do jogador transforma o furacão em furacão de fogo (ver Furacão).
- Raio não vira aviso; o incêndio grande que ele começa, sim.

**Seca** (`m2-dv-seca-v2.png`; ajustada em 2026-10-18; o usuário deixou "como está por enquanto")
- **Região maior:** raio de 12–30 células (antes 5–13), borda irregular (não um círculo), por 3–15
  anos (mais provável onde já é seco).
- **A região vira semiárido**, no estilo da caatinga: enquanto dura, as células funcionam como mato
  seco e espinhoso, desenhadas **célula a célula** (sem mancha borrada por cima): chão de terra clara,
  moitas cinza-esverdeadas espalhadas, e no miolo mais quente chão avermelhado e rachado. Floresta vai
  perdendo a cobertura até virar esse mato; campo e savana secam primeiro.
- **Calor:** +2 a +6 °C na temperatura local, mais forte no centro. Aparece só pelas próprias células
  (mais chão avermelhado e menos moita onde é mais quente), nunca como "rodela" laranja.
- **Mata a vegetação aos poucos:** a cada ano tira 15–35% da cobertura no centro, menos na borda.
  Quando a seca acaba, a vegetação volta na velocidade do bioma.
- Raio "seco" e incêndio ×3 dentro da seca. No M3/M4, dificulta a vida na região em até 30%
  (`docs/04-ecologia.md`).

**Enchente** (aprovada em 2026-10-18; `m2-dv-seca-enchente.png`)
- **Diferente do tsunami:** vem da chuva, de dentro do continente, devagar, e **fertiliza** em vez de
  destruir. O tsunami vem do mar, rápido, raspa a costa e deixa lama salgada onde nada cresce por anos.
- Nasce numa anomalia de chuva forte ou quando um furacão entra em terra. Escolhe o ponto mais baixo
  de uma região úmida e a água sobe a partir dele, enchendo as células vizinhas baixas e planas (até
  ~30–80 m acima do ponto de partida): segue vales e planícies, não faz círculo.
- Sobe em ~1 s, fica 1–3 anos (água barrenta, marrom-azulada, diferente do mar) e baixa.
- **Utilidade:** onde a água esteve fica **solo fértil** por 20–40 anos: vegetação volta mais rápido
  (×2) e fica mais verde e densa (até 100% mesmo em campo seco ao redor). No M3, mais planta ali; no M4,
  agricultura melhor (várzeas). Se a área for uma bacia fechada, sobra um **lago** por 10–30 anos.
- Floresta alagada não morre (perde 10–20%); campo alagado perde a cobertura e volta verde.

**Terremoto** (`m2-dv-terremoto-v2.png`; ajustado e aprovado em 2026-10-18)
- **A tela treme** (só a câmera, 0,5–2 s, pela magnitude e pela distância do epicentro ao centro da
  tela; longe ou fora da vista, quase nada).
- **Quanto maior a magnitude, maior a fenda e o estrago.** Raio do estrago: M 6: 1 célula; M 7: 3;
  M 8: 5; M 9: 8; M 9,5: 11. Fenda: M 6 quase nada; M 7 ~6 células; M 8 ~12; M 9 ~24; M 9,5 ~32, mais
  larga perto do epicentro e com galhos nas maiores.
- **Fenda irregular:** anda ao longo da fronteira de placa, mas com desvios suaves (sem retas e sem
  curvas em ângulo reto), afinando nas pontas; some em ~50 anos.
- **Deslizamentos seguindo o terreno:** começam nas células mais íngremes do raio e descem pela encosta
  em línguas de 2–6 células (cicatriz clara em cima, entulho escuro embaixo), não quadrados soltos. A
  encosta perde altura para baixo (para sempre, 10–60 m). Vegetação do raio perde 20–60% (mais perto do
  epicentro).
- No M3 em diante, destrói criaturas e construções no raio (`docs/04-ecologia.md`).
- **Magnitude ao provocar:** M 6 · 7 · 8 · 9 · 9,5.

**Tsunami** (`m2-dv-tsunami.png`)
- Nasce de terremoto no mar com M ≥ 7,5 (ou provocado).
- **1. A água recua:** nas costas que a onda vai atingir, o mar raso perto da costa (1–4 células)
  aparece como fundo exposto (areia molhada) por alguns passos.
- **2. A onda anda pelo mar** (como hoje, pela profundidade), desenhada nas próprias células: uma
  faixa clara e espumosa que avança.
- **3. Avança sobre a terra:** entra até o alcance pela magnitude, parando onde o terreno é mais alto
  que a onda. **Alcance em terra** (aprovado em 2026-10-18; o mais forte vai a 28 células, o dobro da
  proposta; hoje são 2):

  | Magnitude | Entra em terra | Altura que vence | Costa atingida |
  |-----------|----------------|------------------|----------------|
  | 7,5 | 3 células (~110 km) | 20 m | ~20 células de costa |
  | 8   | 6 (~220 km) | 40 m | ~50 |
  | 8,5 | 10 (~360 km) | 60 m | ~100 |
  | 9   | 17 (~610 km) | 90 m | ~200 |
  | 9,5 | 28 (~1.000 km) | 140 m | o oceano todo |

- **Dano (sempre):** toda célula que a água cobriu perde a vegetação (0%) e vira **lama** (cinza-
  -amarronzada) por 15–30 anos; a vegetação só começa a voltar depois disso (o sal).
- **Raspa a costa:** as 1–2 primeiras células de terra perdem 5–20 m; as que ficam abaixo do mar
  viram mar raso para sempre (a costa recua um pouco; pergunta 2).
- **4. A água volta** para o mar em alguns passos.
- **Magnitude ao provocar:** M 7,5 · 8 · 8,5 · 9 · 9,5.

**Furacão e ciclone** (`m2-dv-furacao.png`)
- **Nasce das nuvens do globo:** num lugar de mar quente com nuvem, o furacão começa torcendo as
  nuvens que já estão ali (as nuvens giram em espiral em volta de um centro, cada vez mais apertadas)
  e abre o olho quando fica forte. Não é mais uma espiral desenhada por cima.
- **Nome:** categoria 1–2 é **ciclone**; 3–5 é **furacão**.
- **Vários ao mesmo tempo:** até 2 por quadrante do globo (norte-leste, norte-oeste, sul-leste,
  sul-oeste), até 8 ao todo. Em "Raro", em geral 0–2 no mundo; em "Muitos", vários ao mesmo tempo.
- Anda ~1 célula por passo (5–12 s de vida em 1×), na trilha de hoje (para oeste, curva para o polo,
  depois para leste); cresce em mar quente, enfraquece em terra e em mar frio.
- **Destruição no caminho** (raio do estrago: ciclone 2 células, furacão 3–5): a vegetação perde
  30–70% (floresta derrubada fica marrom-esverdeada); na costa, a ressaca alaga 1–3 células de terra
  baixa; em terra, a chuva dispara **enchentes** nas partes baixas. No M3, "puxa as coisas".
- **Categoria ao provocar:** Ciclone 1 · Ciclone 2 · Furacão 3 · 4 · 5 (o seletor usa categorias, não
  magnitude; imagem `m2-dv-seletores.png`).
- **Furacão de fogo** (pedido do usuário, 2026-10-18): o jogador joga um raio (ferramenta Raio) num
  furacão ou ciclone e ele vira **furacão de fogo** até o fim da vida: a espiral fica alaranjada e
  escura de fumaça, e em terra cada célula com vegetação no miolo (1–2 células do centro) pega fogo
  (o incêndio espalha como qualquer outro). No mar só muda a cor. Raio natural não faz isso.

**Vulcão** (`m2-dv-vulcao-v2.png`; ajustado e aprovado em 2026-10-18)
- **Vulcões passam a existir no mapa** (hoje a erupção sorteia um ponto e some): nos arcos de
  subducção, nos pontos quentes e onde o jogador criar; andam com a placa. Os das dorsais ficam no
  fundo do mar, sem cratera visível.
- **Tamanhos:** pequeno (cone de raio 1–2 células, cratera de 1), médio (3) e grande (4–5, cratera de
  3×3). Arcos e pontos quentes debaixo de continente tendem a grandes; ilhas novas começam pequenas e
  crescem a cada erupção.
- **Cratera visível:** o cone é terreno de verdade (mais alto no anel, com o relevo desenhado) em tons
  de rocha; a cratera no meio é escura.
- **Adormecido ↔ acordado:** cada vulcão dorme por 200–3.000 anos (sorteado) e acorda por 3–20 anos.
  - Adormecido: cratera escura, fria; a vegetação volta nas encostas baixas.
  - Acordado: **lava no meio da cratera** (laranja/vermelho vivo) e erupções a cada 1–3 anos.
- **Lava seguindo o terreno:** sai pela borda mais baixa da cratera e escorre sempre para a vizinha
  mais baixa, alargando onde o chão fica plano (leque) e se dividindo quando duas descidas são
  parecidas. Uma célula por passo; total pela força (IEV 0–2: 10–40 células; IEV 3+: 20–80 e cinzas).
  Nada de faixas retas ou em cruz. **A lava queima a vegetação** em que encosta (e acende incêndio na
  vizinha). Lava que chega ao mar endurece e **cria terra nova**.
- **Divisão clara entre o cone e a lava:** o cone fica em tons de rocha marrom-acinzentada; o derrame
  esfria em **basalto** quase preto, liso, com borda definida (não se mistura com o cone). Vermelho vivo
  (1–3 anos) → crosta escura → basalto por 100–300 anos → a vegetação volta devagar.
- Continua: a erupção ergue o terreno para sempre; ilhas e cadeias dos pontos quentes.
- Cinzas só nas erupções fortes (IEV ≥ 4): cinza no terreno a favor do vento, tirando 20–40% da
  vegetação, desenhada célula a célula.
- **Raio e vulcão** (decidido em 2026-10-18, opção c): a erupção solta raios na nuvem de cinza, que
  acendem incêndios em volta; e um raio que cai num vulcão adormecido pode acordá-lo (o do jogador
  sempre acorda; o natural, raramente).
- **Jogador:** tocar num vulcão acorda e faz entrar em erupção; tocar fora cria um vulcão novo ali
  (ergue o cone e já acorda).

**Avisos** (`m2-dv-tela.png`)
- Sai a lista. Os desastres grandes aparecem como aviso no **canto inferior esquerdo** (6 s, até 3);
  tocar no aviso leva a câmera até lá. Os provocados pelo jogador não viram aviso (ele está vendo).
- **Escolha de força:** com Terremoto ou Tsunami ativo, o cartão mostra a fileira de magnitudes; com
  Furacão, a de categorias (Ciclone 1 · Ciclone 2 · Furacão 3 · 4 · 5). O último escolhido fica.

### Polos e nuvens (decisões do usuário de 2026-10-17, entram no bloco)
- **Polos:** troca pela proposta aprovada (`docs/img/m2-polos-proposta.png`: borda em lobos, placas
  soltas, fino e azulado na borda, branco no miolo), com **calotas polares e variação de cor no gelo**,
  **desde que o "losango" de perto não deforme o que passa por cima** (perto do polo as células
  aparecem como losangos; o desenho do gelo não pode entortar a terra e o que cruza por cima dele).
  Textura fina do gelo: M8.
- **Tampa sem nuvens em volta do polo:** a faixa de nuvens por latitude quase zera perto dos polos e
  deixa uma mancha oval limpa, como uma tampa. A cobertura perto dos polos sobe e vira contínua com o
  resto (sem borda visível). As nuvens em si ficam como estão. Causa achada: as nuvens andam para
  oeste perto do equador e acima de ~60° e para leste no meio; nas emendas (30° e 60°) os dois lados
  se desencontram e desenham um círculo, e dentro de 60° quase não há nuvem. Correção proposta
  (`docs/img/m2-nuvens-polo.png`): misturar os dois lados numa faixa de ~6° na emenda e dar mais nuvem
  ao polo.
- **"Medir desempenho"** passa a mostrar o tempo de GPU do globo (meta ≤ 8 ms) e a memória (meta ≤
  400 MB).

### Relevo do terreno (pedido do usuário em 2026-10-18; **opção (b), degraus, aprovada**)
O usuário quer que a textura dos biomas e do terreno mostre bem o que é mais alto e o que é mais baixo.
Hoje a altura só clareia um pouco a cor das terras altas. Opções em `docs/img/m2-relevo-proposta.png`
(mesmo lugar, de perto e de média distância):
- **(a) Sombra de encosta:** cada célula fica mais clara se a encosta está virada para a luz (noroeste)
  e mais escura do outro lado, pela inclinação até as vizinhas. Suave, como um mapa de relevo.
- **(b) Degraus:** a altura é dividida em níveis (a cada ~150 m em terra); a célula com vizinha de
  nível mais alto do lado da luz fica em sombra, e a de nível mais baixo fica iluminada. Parece um mapa
  em terraços, no estilo de pixel.
- **(c) Sombra de encosta + cor pela altura:** a (a) mais a cor puxando para mais escura e saturada nas
  baixadas e mais clara e acinzentada no alto.
Custo: a sombra é calculada junto com as cores (no ajudante, quando a cor é refeita); medir no
notebook antes de fechar.
**Escolhida a (b), degraus** (2026-10-18; o quadro 7 da imagem, média distância, "o mais bonito e o
mais parecido com o que quero"). Vale também de perto; se de perto ficar ruim, o usuário avisa no
teste do bloco. Mar e gelo não ganham degraus.

### Tarefas do bloco (depois da aprovação, nesta ordem; cada uma = um commit)
- [x] **R1 — Polos, nuvens no polo e relatório** (GPU e memória no "Medir desempenho").
  **Feito (2026-10-18):** gelo do mar com borda em lobos (ruído fixo por mundo, ±8 °C), faixa de ±3 °C
  partida em placas soltas, cor pela espessura (fino e azulado na borda, branco no miolo) e tons por
  célula; teste novo `tests/world/sea-ice.test.ts`. Nuvens: as emendas das faixas de vento (30° e 60°)
  se misturam numa faixa de ~6° e o polo ganhou nuvem; a "tampa" sumiu. Relatório: linha "GPU do
  globo" (longe, de perto e de perto com placas andando; consulta de tempo da GPU quando o navegador
  tem, senão quadro esperando a GPU) e linha "memória" (dados do jogo e a página inteira quando o
  navegador informa; o Firefox não informa). **Medido no notebook (Chrome): longe 3,8–4,1 ms, de perto
  parado 4,0 ms, de perto com placas deslocadas ~8,1 ms e ~14,6 ms durante a transição de 0,35 s
  depois de cada recomposição: a meta de ≤ 8 ms está quebrada nesse cenário (já estava; não era
  medido).** fps continua 60 em todos os cenários. Memória: dados do jogo ~78 MB, página inteira
  186 MB (meta 400). Geração 0,84 s.
- [x] **R2 — Base:** vegetação por célula em %, estados de célula com cor e recuperação, desastres
  passo a passo no relógio, avisos no canto inferior esquerdo, sem a lista, fileira de magnitude.
  Testes: vegetação volta na velocidade do bioma; estados expiram; determinismo passo a passo.
  **Feito (2026-10-18):** `src/world/disasters/ground.ts` (vegetação 0–100% e estado de cada célula,
  no relógio; lava vira basalto; a vegetação não volta sob fogo, lava, basalto, lama e calor; volta 2×
  no solo fértil; ritmo varia por região, ±25%, para voltar em manchas). Cor: bioma misturado com o
  solo nu pela vegetação, floresta abaixo de 50% com cara de campo, cor de cada estado por cima,
  célula a célula (dois tons sorteados por célula); as camadas "Ver biomas", "Ver recursos" e "Ver
  tensão" mostram o mundo sem os desastres. Só repinta a célula quando a aparência muda (cobertura de
  4 em 4%, força do estado em 8 degraus). Desastres em andamento rodam um passo por mês
  (`Disasters.start`); os de hoje ainda são instantâneos e passam a andar nas R3–R8. Os de hoje já
  usam o chão novo: incêndio zera a vegetação e deixa "queimada"; tsunami deixa lama (15–30 anos) sem
  vegetação; cinzas tiram 30%; seca = "calor"; enchente = "alagada". Provocar volta para 1× (pausado
  continua pausado). Fileira de força no cartão (terremoto M 6–9,5, tsunami M 7,5–9,5, furacão por
  categoria; o último escolhido fica). Avisos no canto inferior esquerdo; a lista saiu. Tocar mostra
  "Floresta temperada · queimada · vegetação 20%". Testes novos em `tests/world/ground.test.ts`
  (inclui o mesmo chão e as mesmas cores em 1× e em 20×).
- [x] **RL — Relevo em degraus** (opção b): níveis a cada 150 m em terra, sombra do lado oposto à luz
  (noroeste) e borda iluminada, calculados junto com as cores. Testes: célula com vizinha mais alta do
  lado da luz fica mais escura; terreno plano não muda; mar não muda.
  **Feito (2026-10-18):** `terraceShade` em `src/render/colors.ts`, somado ao sombreado suave que já
  existia, igual ao protótipo do quadro 7 (a tela do jogo e a imagem da proposta diferem em média
  0,2/255 no mesmo lugar). Mar, gelo e as camadas de leitura sem degraus. Custo: 4 vizinhas a mais por
  célula ao pintar (no ajudante); a GPU não muda (é cor da textura).
- [x] **RG — GPU de perto com as placas andando ≤ 8 ms** (decisão do usuário, 2026-10-18: opção a,
  depois do relevo, para não otimizar duas vezes). Meta 8 ms, sem otimizar além disso. Se a
  transição de perto mudar de aparência, mostrar ao usuário antes. Medir no notebook.
  **Feito (2026-10-18), medido no notebook (Chrome, 1080p, consulta de tempo da GPU):**

  | GPU do globo (média, pior) | antes | depois |
  |---|---|---|
  | de perto, placas andando | 7,7–8,1 ms | 5,0 (6,6) |
  | de perto, na transição | 14,2–14,6 | 6,8 (8,2) |
  | meio (células de ~5 px), placas andando | 9,4 | 7,1 (8,4) |
  | meio, na transição | 16,5 | 7,8 (8,3) |
  | longe / de perto parado | 2,8 / 4,3 | igual |

  Três mudanças, sem mudar a imagem: (1) as placas vizinhas guardadas por célula vão a 8 passos (antes
  5): a 20× com placas a 100% elas andam até ~3,2 células entre recomposições e a busca larga (4
  sondas por pixel) tinha virado o caso comum; (2) a célula guarda a que distância está a outra placa
  mais perto, e longe de fronteira o desenho nem testa as candidatas nem confere a dona das células de
  perto; (3) a transição de 0,35 s não desenha mais a composição anterior a cada quadro: na
  recomposição ela é desenhada uma vez numa imagem do tamanho da tela, e cada quadro da transição lê
  ali o ponto onde o seu pedaço de placa estava (desfazendo o giro da placa e a câmera). Conferido
  pixel a pixel: o desenho sem transição é o mesmo de antes (diferença só em 0,02–0,03% dos pixels, em
  bordas de célula, igual à diferença entre duas compilações do shader); na transição, a imagem que
  some pode ficar até meio pixel deslocada nas bordas das células. "Medir desempenho" ganhou as linhas
  "de perto na transição", "meio com placas andando" e "meio na transição".
- [x] **R3 — Incêndio e raio.** Testes: campo pega fogo; fogo não entra em deserto, gelo e água;
  anda a favor do vento; raio em floresta acende, no mar não.
  **Feito (2026-10-18):** `src/world/disasters/fire.ts`. O fogo anda no relógio: a cada 2 passos cada
  célula em chamas tenta as 4 vizinhas (campo/estepe/savana 1 tentativa, floresta 3, pântano 2), com
  chance pelo bioma, pelo combustível da célula (0,6–1,4, fixo: bordas irregulares e ilhas sem
  queimar), pela vegetação, pela seca (×3) e pelo vento da latitude (×2 a favor, ×0,5 contra). Calibrado
  para, sem seca, quase sempre parar sozinho (medido em 1.000 anos, N = 64 e 128: mediana 2–3 células,
  90% abaixo de ~20–30, 1 a 7 incêndios grandes, ≥ 60 células); na seca vira os grandes. Frente
  amarela, queimando laranja, depois queimada (2–4 anos) e a vegetação volta (floresta passando por
  campo). **Raio** é desastre novo (menu Desastres → Raio, ⚡): zigue-zague e clarão de 0,3 s; o natural
  cai onde chove muito ou "seco" na seca, e só entra na simulação quando acende fogo (~0,6 por ano em
  "Raro", antes da chance de acender). **Incêndio do jogador** (ferramentas Incêndio e Raio) é mais
  forte, como os outros provocados: começa num foco de raio 2 e pega 1,2× mais (medido em N = 256:
  em geral 25–110 células, raro passar de 300; antes da R3 era 40–150 fixo). O incêndio vira aviso
  quando apaga, se queimou ≥ 60 células; a animação de "rodela" do incêndio saiu (ele aparece nas
  células). Testes: `tests/world/fire.test.ts`.
- [x] **R4 — Seca e enchente.** Testes: seca tira cobertura e aquece; enchente segue o terreno baixo,
  deixa solo fértil, e a vegetação volta mais rápido nele.
  **Feito (2026-10-18):** `src/world/disasters/drought.ts` e `flood.ts`. **Seca:** raio 12–30 células
  (as grandes raras; a do jogador 22–30), borda recortada por ruído em três escalas, 3–15 anos (mais
  longa onde já é seco); a intensidade (1 no miolo, 0 na borda) dá o calor (+2 a +6 °C, só no toque e
  nas cores) e a perda de vegetação por ano (15–35% no miolo, menos na borda; campo, estepe e savana
  ×1,3, floresta ×0,8; o primeiro ano já na hora). Cor do semiárido como a imagem v2: chão claro, moita
  cinza-esverdeada, árvore seca e, no miolo quente, chão avermelhado, por manchas fixas, aparecendo
  conforme a vegetação morre. A vegetação não volta enquanto dura; depois volta na velocidade do bioma.
  **Enchente:** começa no ponto mais baixo (até 6 passos do toque ou do centro sorteado) e enche pela
  altura (sempre a próxima célula mais baixa encostada na água), até 30–80 m acima do começo e até
  40–260 células (jogador 160–300); sobe em 12 passos (~1 s em 1×); a água fica 1–3 anos (mais nas
  partes fundas) e baixa deixando solo fértil por 20–40 anos (vegetação 2× mais rápida, mais verde);
  bacia fechada (sem encostar no mar): as 12% mais fundas viram lago por 10–30 anos. Floresta alagada
  perde 10–20% da vegetação; campo perde 75–95% e volta verde. A "rodela" da seca e da enchente saiu.
  O toque mostra "calor da seca +4 °C". Testes: `tests/world/drought-flood.test.ts`.
- [x] **R5 — Terremoto** (tremor, fenda e deslizamentos pela magnitude, seletor). Testes: raio pela magnitude;
  deslizamento só em encosta.
  **Feito (2026-10-18):** `src/world/disasters/quake-damage.ts`. Raio do estrago e comprimento da fenda
  pela tabela (interpolados entre os pontos; abaixo de M 6 vão a zero em M 5,5: o pequeno só treme).
  Fenda: direção da fronteira de placa perto do epicentro (eixo principal das células de fronteira a
  até 5 células; sem fronteira, sorteada), passos de meia célula com desvio suave, mais larga e aberta
  para as vizinhas perto do epicentro, galhos em M ≥ 9, some em 50 anos. Deslizamentos: das células
  mais íngremes do raio (queda > 180 m até a vizinha), descendo sempre para a vizinha mais baixa (2–6
  células, 2 de largura, entulho espalhando no pé), separados uns dos outros, até 2/4/8/12 em M 7/8/9/9,5;
  o topo desce 10–60 m e o pé sobe a metade, para sempre (gravado na placa como uma pincelada; caminho
  novo `applyTerrainDeltas`, que a R6 usa para raspar a costa). Vegetação do raio perde 20–60%. Tela
  tremendo só na câmera: 0,5–2 s, até ~14 px × a escala da tela pela magnitude, menos com a distância do
  epicentro ao centro da tela (zero além do raio sentido), 30% se o epicentro está fora da vista. Os
  anéis por cima saíram. Testes: `tests/world/quake-damage.test.ts`.
- [ ] **R6 — Tsunami** (recuo, onda, avanço, dano, costa raspada, magnitude). Testes: alcance pela
  magnitude; para em terreno alto; toda célula alcançada perde a vegetação.
- [ ] **R7 — Vulcão** (vulcões no mapa, cratera, ciclo, lava). Testes: lava desce; lava no mar vira
  terra; adormecido não entra em erupção sozinho; anda com a placa.
- [ ] **R8 — Furacão e ciclone** (das nuvens, vários, destruição, seletor de categoria, furacão de fogo). Testes: no máximo 2 por
  quadrante; nome pela categoria; estrago só no raio.
- [ ] **R9 — Frequências e medição:** recalibrar "Raro" (~1 aviso a cada 1–2 min em 1×), "Medir
  desempenho" com tudo acontecendo.

### Respostas do usuário (2026-10-18)
1. **Velocidade:** volta para 1× só quando o desastre é provocado pelo jogador; o natural não mexe na
   velocidade (senão o tempo frearia toda hora).
2. **Terreno permanente:** opção (a): tsunami raspa a costa e terremoto derruba encostas, para sempre e
   pouco. Reverte a decisão de 2026-10-15 ("só o vulcão muda o relevo").
3. **Raio e vulcão:** opção (c), os dois.
4. **Enchente:** aprovada.
5. **Tsunami:** aprovado por magnitude, com o mais forte a 28 células (o dobro); tabela ajustada.
6. Ajustes: seca maior, semiárido tipo caatinga, célula a célula, sem "rodela"; terremoto com fenda e
   estrago pela magnitude, fenda irregular, deslizamentos sem cara de ruído; vulcão com divisão clara
   entre cone e lava, lava seguindo o terreno, tamanhos variados; furacão aprovado, seletor por
   categoria e furacão de fogo com raio; relevo do terreno (proposta antes de fazer).
7. Aprovados como estão: raio e incêndio, enchente, o desenho do tsunami, o planeta (nuvens) e a
   correção da tampa no polo.

### Respostas do usuário, segunda rodada (2026-10-18, depois da R1 e do `35a5ceb`)
1. **GPU de perto com placas andando:** opção (a), otimizar para caber em 8 ms, **depois** do relevo
   (o relevo também pesa; otimizar antes faria o trabalho duas vezes). Mudança visível na transição de
   perto: mostrar antes. Meta 8 ms, sem otimizar além.
2. **Relevo:** opção (b), degraus a cada 150 m (quadro 7). Vale de perto; se ficar ruim, ele avisa.
3. **Aprovadas:** imagens do terremoto v2, do vulcão v2 e dos seletores de força.
4. **Seca v2:** fica como está por enquanto (o semiárido melhora com a ecologia no M3,
   `docs/04-ecologia.md`).
5. Ordem: R2 → RL (relevo) → RG (GPU) → R3 a R9. (R2, RL e RG feitas em 2026-10-18.)

## Bloco Final (depois do Bloco Desastres v2)

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
   - **O que ainda sobra depois do alisamento** (2026-10-17, pedido do usuário para julgar no teste
     do fim do bloco; imagem `docs/img/m2-perto-restos.png`, semente `42`, zoom máximo, ilhas criadas
     com Elevar em cima da emenda e do canto):
     1. **Meio da face:** quadrados, como pedido.
     2. **Nas emendas:** numa faixa de ~1 célula as fileiras dos dois lados não batem; as células
        ficam desencontradas como tijolos, e a costa que cruza a emenda ganha pequenos dentes. Sem
        dobra em ângulo reto.
     3. **Perto dos 8 cantos** (~3–5 células em volta): as células viram **hexágonos** em vez de
        quadrados (lá três faces se encontram), e onde as áreas de duas faces se tocam pode sobrar
        uma **divisa reta de 3–4 células** ao longo da emenda (na imagem, entre a montanha e a
        floresta). No oceano, a textura das células muda de direção ao cruzar a emenda (fraco).
     O usuário julga no teste do fim do bloco Minerais e clima; o fps de perto também entra no teste.

### Teste no celular (2026-10-17): de perto travando
Relato do usuário: "de perto está travando muito" (meta de desempenho quebrada, corrigir antes da T6,
sem perder o visual; gostou dos hexágonos nos cantos, mantê-los). Pediu o cenário "de perto, girando"
no "Medir desempenho". Também: o botão "Ver recursos" fica no menu Geologia (já estava na T1/T6).
**Feito:** a vista de perto ficou ~50% mais leve no notebook com a mesma imagem (264 → ~395 fps
girando; antes do alisamento 489); detalhes e o que foi descartado em `docs/decisoes.md`, "Vista de
perto mais leve". Cenários novos no relatório: "de perto, girando" e "idem, de perto" (placas 100%).
O celular decide se basta: se "de perto, girando" ficar abaixo da meta de "pausado" (85), o próximo
passo é discutir com o usuário (nenhuma meta de "de perto" foi definida ainda).

### Teste no celular (2026-10-17, `751d6e39`): de perto aprovado; remendo nas fronteiras de placa
- De perto: 61 fps girando; 46 (mínimo 33) com placas 100% a 20×; travadas 147 → 1. **Metas novas
  (decisão do usuário):** de perto parado ou girando ≥ 60; de perto com placas andando ≥ 30, nunca < 20.
  Batidas; "não precisa otimizar mais agora".
- T6: visual aprovado (pedrinhas de perto, cor leve no solo de longe, petróleo escondido até o Rebaixar,
  camada "Ver recursos" no menu Geologia); nome ao tocar: **opção (a)** (com a camada ligada, toque
  curto numa jazida mostra o nome e não usa o pincel; arrastar continua pincelando).
- **Defeito: de perto, onde as placas se encontram, o terreno parece um remendo.** Diagnóstico (sem
  correção ainda: muda o visual, o usuário decide). Imagem `docs/img/m2-remendo-placas.png` (semente
  `terra`, 8 s de placas 100% a 20×, pausado, 4 fronteiras em terra; em cima o jogo de hoje, embaixo um
  experimento sem a causa 1).
  Entre duas recomposições cada placa é desenhada girando de volta para a textura da última
  recomposição (o "movimento suave"). Na fronteira isso tem 3 efeitos que de longe somem (menos de 1
  pixel) e de perto aparecem:
  1. **Cópia de tolerância (a maior parte do remendo):** o pixel na beira da placa que, girado de
     volta, cai um pouco fora do território dela na textura (arredondamento em células) pega a cor de
     um ponto 0,7 célula ao lado (leste, oeste, norte ou sul). De perto, isso vira faixas de células
     esticadas e repetidas ao longo da fronteira. No experimento sem a cópia as faixas somem, mas abrem
     furinhos (por isso ela existe).
  2. **Alisamento misturando placas:** de perto, cada pixel olha as 4 células em volta na textura; na
     fronteira, algumas são da outra placa **onde ela estava** na última recomposição, não onde está
     agora. As divisas ficam com pedaços deslocados.
  3. **Fenda nova pintada como fundo de oceano:** onde as placas se afastam, o desenho pinta azul-escuro
     até a próxima recomposição, mesmo no meio de um continente, onde a simulação faz um vale de rifte
     (correção 1). Aparece uma listra azul que depois vira terra.
  **Proposta (esperando aprovação):**
  - (1) e (2): de perto, na fronteira, cada pixel só escolhe entre as células **da própria placa**
    (sem a cópia deslocada e sem misturar com a outra placa). Cada placa mantém seus quadrados e
    hexágonos; a costura entre as duas é uma linha nítida que anda com elas; onde uma passa por cima
    da outra, aparece a de cima (continente por cima, como hoje). Custo: leituras a mais só nos pixels
    de fronteira (estimativa < 3% da tela).
  - (3): fenda entre dois lados continentais pintada como vale de rifte (cor de terra mais escura),
    não oceano; fenda com lado oceânico continua azul-escura. Combina com o que a simulação faz.

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
3. **Marcas:** vulcão muda o relevo para sempre; os outros desastres se recuperam. (Revertido em
   2026-10-18: tsunami e terremoto também mudam o relevo para sempre, pouco.)
4. **Eras glaciais:** automáticas e suaves, mais um controle de temperatura global.
5. **Avisos:** só os desastres grandes; lista completa no painel. (Mudado em 2026-10-17: sai a lista;
   só o aviso, no canto inferior esquerdo.)
6. **Interface:** substituída pela T1 — menu de ferramentas por categorias (Tempo, Relevo, Desastres,
   Geologia, Clima), com só a ferramenta escolhida e a pausa na tela; esboço aprovado antes de codar.
