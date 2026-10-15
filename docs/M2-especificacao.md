# M2 — Especificação do Marco 2: geologia viva

Pré-requisito: Marco 1 concluído (`v1.0`).
Branch: `marco-2`.
Estado: **rascunho aguardando aprovação do usuário.** Nada é codado antes das respostas da seção
"Decisões de design para o usuário".

## Objetivo
A Pangeia se parte em continentes que derivam com velocidade controlada pelo jogador (inclusive
zero). As colisões erguem montanhas, as dorsais abrem oceanos, e terremotos, vulcões, tsunamis e
desastres climáticos surgem onde a geologia e o clima indicam. Tudo roda num Web Worker: a tela
nunca trava, nem em velocidade máxima, nem no celular.

## Como vai funcionar (visão de jogador)
- Um controle **"Placas"** (0 a máximo) define a velocidade da deriva. Em 0 a geologia congela, mas
  o clima e os desastres climáticos continuam.
- Uma camada **"Ver placas"** desenha as fronteiras coloridas por tipo: convergente (vermelho),
  divergente (azul) e transformante (amarelo).
- Desastres aparecem no globo (ondas, cinzas, trilha de furacão, área queimada) e num aviso curto.
  Tocar no aviso leva a câmera até o lugar.
- O jogador pode provocar qualquer desastre manualmente, com ferramentas novas na barra.
- Pincéis do M1 continuam valendo. Uma montanha pintada viaja junto com a sua placa.

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
- Eras glaciais leves: um ciclo lento de temperatura global faz o gelo avançar e recuar.

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

## Tarefas (fazer em ordem; cada uma = um commit)

- [ ] **T1 — Simulação no Web Worker** (`src/sim/worker.ts`, `src/sim/protocol.ts`)
  Mover o mundo, o relógio, a geração, o clima e os pincéis para o worker. A thread principal recebe
  os remendos de cor e manda comandos.
  Testes: codificar/decodificar mensagens; o mundo gerado no worker é idêntico ao da thread principal
  (mesma semente).
  Verificação manual: pincel e novo mundo funcionam como no M1, e a tela não trava durante a geração.

- [ ] **T2 — Placas** (`src/world/plates.ts`)
  Voronoi deformado, tipo de crosta, eixos e velocidades pela semente. Camada "Ver placas".
  Testes: toda célula tem placa; cada placa é contígua; número de placas dentro da faixa; a Pangeia
  cobre ≥ 3 placas; determinismo.

- [ ] **T3 — Movimento e recomposição** (`src/world/tectonics.ts`)
  Crosta no referencial da placa, recomposição global e controle de velocidade (0 congela).
  Testes: velocidade 0 não muda nada; uma placa sozinha gira sem deformar (forma preservada dentro
  de uma tolerância); área total de crosta conservada sem fronteiras ativas; determinismo.

- [ ] **T4 — Fronteiras e relevo**
  Classificação convergente/divergente/transformante; dorsais com profundidade pela idade;
  subducção com fossa; colisão erguendo montanhas; rifte continental; erosão leve.
  Testes: em cenários sintéticos de duas placas, montanha/fossa/dorsal aparecem onde devem; em
  10.000 passos a fração de terra fica entre 20% e 40% e nada vira NaN.

- [ ] **T5 — Clima que acompanha a deriva e eras glaciais**
  Recálculo periódico no worker e envio só do que mudou; ciclo glacial leve.
  Testes: o recálculo parcial bate com o total; a área de gelo cresce com a temperatura global
  menor e recua com ela maior.

- [ ] **T6 — Terremotos e tsunamis** (`src/world/disasters/`)
  Tensão nas fronteiras, liberação e magnitude; tsunami que se propaga no oceano e alaga costa baixa
  temporariamente; desenho das ondas na camada sobreposta.
  Testes: terremotos só perto de fronteiras; tsunami só a partir de terremoto no mar e forte;
  determinismo.

- [ ] **T7 — Vulcões e pontos quentes**
  Arcos de subducção, dorsais (fraco), pontos quentes fixos; erupção ergue terreno e espalha cinzas.
  Testes: ponto quente sob placa em movimento forma uma cadeia de ilhas; erupções só em lugares
  permitidos.

- [ ] **T8 — Desastres climáticos**
  Anomalias de chuva (seca, enchente), furacões com trajetória, incêndios; perturbação temporária
  com recuperação.
  Testes: furacão só nasce em oceano tropical quente e enfraquece em terra; incêndio só em floresta
  sob seca; frequências dentro da faixa esperada em 1.000 anos simulados.

- [ ] **T9 — Ferramentas divinas e controles**
  Controle "Placas" (0–máximo), camadas (placas, tensão), ferramentas para provocar cada desastre.
  Verificação manual no celular e no notebook.

- [ ] **T10 — Avisos de desastre**
  Aviso curto quando algo grande acontece e lista dos recentes; tocar leva a câmera ao local.
  (Não é a crônica permanente, que fica no M5.)

- [ ] **T11 — Teste longo de estabilidade**
  Teste automático: partindo da Pangeia, em velocidade padrão, depois de X passos existem ≥ 3
  continentes grandes, a fração de terra está entre 20% e 40%, há montanhas, nenhum valor inválido,
  e os desastres aconteceram nas quantidades esperadas.

- [ ] **T12 — Medição no celular e ajuste**
  Placas no máximo + tempo no máximo: tela ≥ 30 fps no celular (≥ 60 no notebook), porque a
  simulação está no worker. Medir também quantos passos por segundo o worker aguenta. Registrar em
  `docs/decisoes.md`.

## Critérios de aceite do usuário
1. Ligo as placas e acelero o tempo: a Pangeia se parte em continentes, e a tela não trava.
2. Onde continentes colidem nascem montanhas; onde se separam, abre-se oceano.
3. Terremotos e vulcões aparecem nas fronteiras e nos pontos quentes; tsunamis saem de terremotos
   no mar; furacões nascem em mar tropical; secas, enchentes e incêndios fazem sentido com o clima.
4. Placas em zero congelam a geologia.
5. Consigo provocar qualquer desastre com as ferramentas.
6. Tudo continua fluido no meu celular.

## Fora do M2 (não fazer agora)
Vida (plantas, animais), humanos, cidades e dano a cidades (as regras de "cidade sobre terreno que
muda" ficam para quando houver cidades, no M4), crônica permanente (M5), som, sprites novos.

## Decisões de design para o usuário (responder antes de começar)

1. **Ritmo da deriva.** Com o tempo em 1× (1 ano por segundo) a deriva real nunca seria vista: os
   continentes andam ~5 cm por ano. Então o controle "Placas" acelera a geologia por conta própria.
   No máximo, quanto tempo real a Pangeia deve levar para se partir com o tempo em 20×?
   - (a) ~2 minutos: drama rápido, bom para experimentar. **Recomendo esta**, com o controle
     permitindo ir bem mais devagar.
   - (b) ~10 minutos: mais contemplativo.
   - (c) ~30 minutos ou mais: quase realista, a deriva vira pano de fundo.

2. **Frequência dos desastres** (em 1×):
   - (a) raros: um desastre notável a cada ~1–2 minutos. **Recomendo**, porque sem vida ainda
     eles servem mais de espetáculo;
   - (b) frequentes: vários por minuto;
   - (c) controle de frequência na interface (0 a muito), com padrão "raro".

3. **Força dos desastres no terreno.** Erupções e terremotos devem mudar o relevo de forma
   permanente (uma ilha nova fica) ou só deixar marcas temporárias?
   **Recomendo:** vulcão muda o relevo de forma permanente; o resto é temporário e se recupera.

4. **Eras glaciais.** Ciclo automático leve, com o gelo avançando e recuando?
   - (a) sim, automático, bem suave. **Recomendo**;
   - (b) sim, mas também com um controle "temperatura global" de deus;
   - (c) não agora.

5. **Avisos.** Mostrar só desastres grandes ou todos? **Recomendo** só os grandes, com a lista
   completa no painel.

6. **Ferramentas de desastre na barra.** As 7 de uma vez (terremoto, vulcão, tsunami, seca, enchente,
   furacão, incêndio), ou num menu "Desastres" que abre as 7? **Recomendo** o menu, para a barra
   não ficar apertada no celular.
