# 03 — Mundo, clima, biomas e geologia

## Geração inicial (Marco 1)
- Mundo começa como **Pangeia**: um supercontinente único cercado por um oceano global.
- Elevação = ruído 3D contínuo na esfera (sem emendas) + máscara continental centrada num ponto,
  deformada por ruído para não ficar circular. Meta: ~30% de terra.
- Nível do mar ajustável (parâmetro do mundo).
- Tudo derivado da semente: mesma semente, mesma Pangeia.

## Clima (Marco 1, simplificado)
- **Temperatura:** depende da latitude (quente no equador, frio nos polos) e cai com a altitude.
- **Precipitação:** faixas de chuva por latitude (equador úmido, ~30° seco, temperado úmido),
  mais umidade perto do oceano e sombra de chuva atrás de montanhas.
- Valores guardados por célula; recalculados quando o terreno muda.

### Como está implementado (M1)
- Temperatura ao nível do mar: ~28 °C no equador, ~-24 °C nos polos; cai 6,5 °C por km de altitude.
- Chuva base por latitude: ~2.300 mm no equador, ~250 mm perto de 27°, ~1.400 mm perto de 50°.
- Umidade cai com a distância até a água (alcance ~1.500 km). Perto do equador o interior seca
  menos (chuva de convecção, como na Amazônia e no Congo).
- Sombra de chuva: olha ~640 km contra o vento predominante da faixa (alísios de leste até 30°,
  ventos de oeste de 30° a 60°, ventos polares de leste acima de 60°).
- Variação regional (ruído da semente): ±3 °C e chuva ×0,5–×2, para os biomas não virarem listras.
- Gelo natural: terra abaixo de -12 °C, mar abaixo de -10 °C.
- Pântano/mangue: baixada (até 60 m) quente (≥ 12 °C) e úmida (≥ 1.600 mm), ou chuva extrema.
- Valores exatos e limiares ficam em `src/world/climate.ts` e `src/world/biomes.ts`.

## Biomas (classificação por temperatura × precipitação)
Oceano profundo, oceano raso, praia, gelo/calota polar, tundra, taiga (floresta boreal),
floresta temperada, campo/pradaria, estepe, deserto quente, deserto frio, savana,
floresta tropical, pântano/mangue, montanha, pico nevado.

Cada bioma tem uma cor fixa de pixel definida em `src/world/biomes.ts` (paleta única, consultável).

## Polos e calotas
- Calotas existem nos dois polos e respondem à temperatura.
- O jogador pode pintar e apagar gelo em qualquer lugar.
- No Marco 2, gelo pode avançar ou recuar com o clima (eras glaciais leves).

## Pincéis do jogador (Marco 1)
Elevar terreno, rebaixar terreno, água, gelo, apagar gelo. Tamanho do pincel ajustável.
Cada pincelada recalcula clima e bioma só da região afetada (mais uma borda).

### Como está implementado (M1)
- Elevar/rebaixar: ~2.200 m por segundo segurando, no centro do pincel, com queda em sino
  `(1 − t²)³` até zero na borda (t = distância ao centro / raio). Nos últimos 6 km antes do teto
  (9.000 m) ou do fundo, o pincel desacelera em vez de chapar: o resultado é morro ou bacia, não mesa.
- Água: afunda o terreno para 40 m abaixo do nível do mar (lago/mar raso).
- Gelo/Derreter: marcam a célula como "gelo pintado" ou "gelo apagado", que vencem o clima
  (apagar a calota polar não faz ela voltar sozinha).
- Tamanho do pincel: raio de 1 a 30 células.
- Borda recalculada: ~640 km (alcance da sombra de chuva). Um lago pintado deixa a região em volta
  mais úmida, e uma serra pintada deixa o lado a favor do vento mais seco.
- No celular, um dedo pinta e dois dedos dão zoom; a pintura espera 80 ms para não confundir o
  começo de uma pinça com uma pincelada.

## Placas tectônicas (Marco 2)
- O mundo é dividido em placas (polígonos na esfera), cada uma com eixo e velocidade de rotação.
- **Velocidade controlada pelo jogador**, de zero ao máximo. Zero congela a geologia.
- Bordas convergentes: montanhas, vulcões, terremotos fortes; subducção cria fossas.
- Bordas divergentes: dorsais oceânicas, vales em rifte, vulcanismo fraco.
- Bordas transformantes: terremotos sem vulcão.
- Referência real: a Pangeia levou ~200 milhões de anos para virar o mapa atual. O jogo comprime
  isso; a escala é regulada pelo controle de velocidade.
- Cidades sobre terreno que muda: sofrem dano/terremoto, não "teletransportam". Regras no Marco 2.

### Como está implementado (M2, T3: as placas nascem; o movimento vem na T4)
- 8 a 14 placas por mundo (sorteio próprio, separado do terreno).
- **Crescimento de regiões com custo por ruído** (Dijkstra a partir das sementes, dividido pelo peso
  de cada placa): placas de tamanhos variados, sempre contíguas, com fronteiras recortadas que seguem
  os "vales" do ruído (antes: Voronoi deformado, fronteiras em arcos lisos).
- 5 a 8 sementes caem na terra; nenhuma placa fica com mais de 35% da terra (a que passar ganha mais
  uma semente e as regiões crescem de novo).
- Crosta continental onde é terra ou plataforma (acima de -500 m); oceânica no resto.
- Cada placa tem velocidade angular ω (polo de Euler × velocidade relativa). Placas da Pangeia (com
  pelo menos 3% da terra) seguem uma **expansão a partir do centro do supercontinente**: a velocidade
  cresce com a distância ao centro, então todo par de vizinhas se afasta e a Pangeia se parte em
  vários continentes (a do centro fica quase parada). Desvio aleatório de ±0,2 rad.
- Tipo de fronteira por célula, comparando o movimento das duas placas: aproximando = convergente,
  afastando = divergente, deslizando de lado = transformante. Duas rodadas de "voto da vizinhança"
  deixam cada trecho com um tipo só.
- Camada "Ver placas" (menu Geologia): cada placa com um tom e as fronteiras em vermelho
  (convergente), azul (divergente) e amarelo (transformante).

### Como está implementado (M2, T4: movimento)
- Cada placa guarda a sua crosta (altura, tipo, data de nascimento) no **próprio referencial** e só
  acumula um ângulo de rotação em torno do seu eixo fixo. As amostras nunca são recopiadas de célula
  em célula, então os continentes não se deformam.
- **Recomposição**: quando alguma placa andou 1 célula (~39 km), o mapa é refeito. Para cada célula,
  desfaz-se a rotação de cada placa candidata e consulta-se a amostra dela; perto das fronteiras
  testam-se todas as placas.
- Buraco onde as placas se afastam → crosta oceânica nova a -2.500 m (dorsal). Sobreposição onde se
  aproximam → continental fica por cima; a oceânica mais velha afunda e é consumida. Buracos e
  sobreposições só de arredondamento (sem movimento relativo) são cicatrizados copiando a vizinha.
- Depois de cada recomposição: distância até a água, clima, biomas e cores do mundo todo.
- Pinceladas ficam gravadas na placa e viajam com ela. O gelo pintado/apagado e a variação regional
  de clima ficam presos à posição no globo (não andam com a placa).
- **Ritmo**: 1,4×10⁻⁵ rad por passo no controle 100% (velocidade relativa 1); recomposição a cada
  2 células (o movimento suave do desenho esconde o tamanho do passo). Com o tempo em 20× e o controle
  no máximo, a Pangeia se parte antes de 1 minuto e aos 2 minutos há 5–7 continentes separados.
  Controle inicial: 25%. Em 0% a geologia congela (clima e tempo seguem).
- A recomposição é disparada por ângulo contado em passos, não por tempo real: mesma semente e
  mesmos comandos, mesmo resultado.
- Buracos de 1 célula só por arredondamento (cercados de crosta) são cicatrizados copiando a vizinha;
  qualquer outra fenda vira fundo oceânico novo (copiar continente arrastava tiras de terra).

### Como está implementado (M2, T5: relevo nas fronteiras)
Aplicado a cada recomposição, nas amostras das placas (o relevo viaja com elas):
- **Fundo oceânico envelhece**: nasce na dorsal a -2.500 m e afunda com a raiz da idade até -5.000 m
  (dorsais rasas no meio dos oceanos, planícies abissais longe delas).
- **Oceano sob continente**: fossa no mar (até -6.500 m; o oceano que vem chegando já vai afundando)
  e cordilheira vulcânica com o pico a 3–4 células da costa (como os Andes).
- **Continente contra continente**: cordilheira larga em sino dos dois lados (até 7.000 m).
- **Oceano contra oceano**: uma das placas mergulha, sempre a mesma ao longo de toda a fronteira
  (polaridade do par, ver D3); na outra, arco de ilhas a 2–3 células da fossa, só em trechos (ruído
  fixo na placa): ilhas soltas, não um risco.
- **Margem passiva**: continente encostado em fundo oceânico jovem afunda até virar plataforma, com
  intensidade variando ao longo da costa (ruído fixo na placa): baías e penínsulas nas costas de rifte.
- **Erosão leve** (valores do G4: 0,5% e 3% por recomposição): acima de 2.500 m os picos cedem; acima de 1.200 m o relevo suaviza com as vizinhas
  (cordilheiras viram faixas).
- A fração de terra fica estável (~28–30% em 2 min no máximo).

### Como está implementado (M2, D3: placas com identidade fixa)
Regras do usuário: placas com tamanho e identidade fixos; continentes se soldam e erguem cordilheira;
fragmento pequeno gruda na placa maior; nada oscilando, nada colidindo para sempre.
- **Polaridade da subducção por par**: entre duas placas oceânicas que se aproximam, decide-se uma
  vez qual mergulha (fundo oceânico médio mais velho; empate, mais fundo; empate, número menor), para
  a fronteira inteira, para sempre. Antes era célula a célula, e como a crosta inicial tem toda a mesma
  idade, o desempate pela profundidade variava de célula para célula: as placas se comiam
  alternadamente e células trocavam de dono a cada recomposição.
- **Histerese**: numa sobreposição sem aproximação de verdade (só arredondamento), a célula fica com
  a dona de antes.
- **Dentes de arredondamento**: se a célula mudou de dona só porque a busca da dona caiu fora da borda
  dela (girar a grade arredonda), e 3 das 4 vizinhas continuam da dona (2, na frente de uma placa que
  avança por cima da outra), ela fica com a dona. Menos vizinhas não: arrastaria tiras atrás de placas
  que recuam.
- **Solda continental**: duas placas com continente de verdade (≥ 1,5% do planeta em crosta
  continental cada) que colidem erguem a cordilheira e, quando o contador de colisão do par chega a 8,
  passam a girar juntas (vetor de rotação médio pesado pela área). O contador sobe a cada recomposição
  com frente de colisão e desce a cada uma sem frente (G1; antes acumulava para sempre, e toques
  esporádicos soldavam placas que mal se encostavam). Só conta como frente a crosta consumida onde as
  placas se aproximam de verdade (≥ 0,05 de velocidade relativa); o consumo por arredondamento não
  solda nada (G1). As placas mantêm a identidade.
- **Suturas (G1)**: cada solda é uma sutura entre duas placas; o grupo soldado é o conjunto de placas
  ligadas por suturas. A sutura vive enquanto houver crosta continental de uma placa a até 2 células
  da outra; sem contato por 3 recomposições seguidas, ela some e cada pedaço do grupo ganha polo de
  Euler novo (acabou a "solda à distância"). Solda nova também exige esse contato.
- **Acreção**: se um dos lados da colisão tem pouco continente (uma lasca numa placa quase toda
  oceânica), a crosta continental dele ligada à frente passa para a outra placa e anda com ela. Antes
  essas placas se soldavam (prendendo placas oceânicas a continentes) ou ficavam moendo para sempre.
- **Pedaços soltos**: parte de placa separada do corpo dela (ou placa inteira) menor que 0,4% do
  planeta passa para a vizinha com quem mais faz divisa; repete até não sobrar nenhum.
- **Crosta enterrada**: crosta que entrou fundo no território que a outra placa já tinha (a célula e
  as 4 vizinhas) é consumida, além do teste de aproximação pelos centros das placas.
- **Crosta consumida que ainda aparece**: duas células do mundo podem cair na mesma célula do
  referencial da placa. A crosta consumida numa delas só morre se não estiver aparecendo em outra
  (antes, a vizinha ficava apontando para crosta morta, virava buraco e era preenchida com a crosta da
  outra placa: continente "vazando" pela divisa).
- O movimento de cada placa é a rotação acumulada até a última troca de eixo mais o giro em torno do
  eixo atual; o eixo muda numa solda, numa divisão de grupo e no fim de cada estágio, sempre numa
  recomposição, e a tela recebe eixo, velocidade e centro novos junto com ela.
- **Estágios e polos de Euler novos (G1)**: o "relógio da deriva" anda com o controle Placas (rad de
  giro a velocidade 1; 1 min de jogo a 20× com Placas 100% ≈ 11,6°). O primeiro estágio é a dispersão
  da Pangeia (20–25°, ~2 min); depois, cada grupo ganha polo novo a cada 30–45°: o rumo do centro do
  grupo vira até ±60°, a velocidade é sorteada de novo (0,4–1,0, até 40% mais lenta com metade ou
  mais da crosta continental) e o estágio recomeça. Sorteios com semente própria da tectônica.
- **Guarda polar (G1)**: nenhum rumo (nem na dispersão da Pangeia, nem num polo novo) pode levar o
  centro da terra da placa/grupo além de 65° ao longo do estágio, ficando mais perto do polo; na
  geração, o rumo "para fora da Pangeia" é desviado o mínimo possível (até ±80°, sem sorteio novo).
  Antes, a dispersão em "balão" de uma Pangeia equatorial mandava continentes para os polos e a solda
  os prendia lá.
- **Ciclo de Wilson (G2)**:
  - Fases: dispersão → reunião (continentes rumo a um ponto de reunião perto do último
    supercontinente, a até 35° de latitude) → supercontinente (≥ 70% do continente num grupo soldado,
    quase parado, ~2–2,5 min) → ruptura.
  - A ruptura corta as suturas mais antigas que dividem o bloco em pedaços equilibrados. Cada pedaço
    gira em torno do polo que abre a fenda continental inteira, escolhido entre sorteios pela guarda
    polar e por não empurrar os vizinhos.
  - Tempos e limites são constantes em `tectonics.ts`.
  - Teste `tests/world/wilson-cycle.test.ts`: 15 min, 5 sementes, cada uma forma e racha um
    supercontinente; um grupo só por no máximo 1,5 mandato; atividade baixa por no máximo um mandato;
    a fenda abre; o ciclo é determinístico.
- Teste automático (`tests/world/drift-latitude.test.ts`): todas as placas com o mesmo eixo (o mapa
  gira rígido cruzando as costuras do cubo) sem nenhuma solda e com a latitude da conta exata; solda
  que some sem contato; latitude da terra em 10 min nas 5 sementes (20°–45°, ≤ 30% acima de 60° e
  ≤ 25% depois de 4 min, inclinação média < 0,75°/min).
- Teste automático (`tests/world/plates-long.test.ts`): 5 min a 20× com placas em 100%, 3 sementes;
  a cada recomposição nenhum pedaço solto, nenhuma colisão além da solda, trocas A→B→A < 0,06%
  (troca de rumo e acreção têm teto próprio de 0,5%: é um evento único, não oscilação).
- **Vale de rifte (correção 1)**: fenda entre dois continentes com menos de 3 células nasce como vale
  (300–800 m abaixo das bordas); com 3 ou mais, o meio vira dorsal. Rifte parado fica vale em terra.
- **Riftes traçados (G3)**, `src/world/rifts.ts`:
  - Toda fenda continental é traçada célula a célula (busca de caminho): barata perto da sutura
    antiga e em terreno baixo, cara em montanha; serpenteia (2 a 6 células) e anda em degraus de
    falha transformante (trechos de 6 a 14 células, desvio de até 5). Cada lado da linha fica com o
    pedaço daquele lado; as duas costas se encaixam.
  - Junção tríplice: os braços se encontram num ponto. Com chance de 1/3, um braço falha:
    os dois lados continuam juntos e o traçado vira aulacógeno (vale de 1–2 células, 300–800 m mais
    baixo: lago ou golfo estreito).
  - Ruptura com 2 pedaços: um terceiro braço sai do meio da fenda para dentro do pedaço maior
    (±25° da perpendicular); com chance de 1/3 falha (aulacógeno), senão corta o pedaço e o lado
    menor vira placa nova (anda com o pedaço de onde saiu mais um giro que abre o braço).
  - Microcontinente (chance de 25% por ruptura): lasca de 0,5–2% do planeta ao lado da fenda vira
    placa própria e anda com a média das duas placas da fenda (as duas se afastam dela).
  - Margem passiva igual dos dois lados: o ruído da margem é gravado na posição do mundo na hora do
    rifte.
  - Rifte que abre como zíper: onde a fenda já virou mar, o mar avança até 3 células por recomposição
    pelo vale que ainda liga as duas margens, se as placas ali ainda se afastam.
  - Placas novas usam o número de uma placa que sumiu ou um novo, até 16 (limite do desenho).
- **Colisão vira montanha (G4)**: a crosta continental consumida numa colisão (a altura dela acima de
  −3.500 m) vira cordilheira na placa de cima, num sino de ~4 células (até 8, se oblíqua: mais baixa e
  larga), variando ao longo da frente (picos e passagens). No teto de 7.000 m, o excesso vai para a
  faixa seguinte: planalto. Províncias de crosta presas à placa: cráton (rígido) não engrossa e a
  cordilheira para na frente dele em escarpa. Ombreira de rifte: bordas de fenda nova sobem a
  600–1.600 m de 3 a 6 células da fenda (só em terra). Erosão: 0,5% do que passa de 2.500 m e
  alisamento de 3% acima de 1.200 m por recomposição.
- **Geração v3 (G3)**: a Pangeia nasce soldada e se parte já no nascimento pelo mesmo mecanismo:
  as divisas entre as placas da Pangeia viram riftes traçados; em cada junção tríplice, com chance
  de 1/3, um braço falha (as duas placas viram uma, até 35% da terra, e o vale aparece quando as
  placas começam a andar); placa com mais de 35% da terra é cortada por um braço de costa a costa;
  chance de 25% de microcontinente. O terreno inicial não muda.

### Geração v2 (M2): costas recortadas e mares internos
Decisão do usuário: aceitar que a mesma semente gere um mundo inicial diferente do da v1.x.
- Ruído fino só numa faixa em volta da costa (detalhe de ~2 a ~16 células): baías, penínsulas e
  ilhotas, mantendo a fração de terra exata.
- 2 a 4 bacias internas por mundo: depressões suaves que viram mares internos e golfos.
- Os sorteios novos vêm depois dos antigos: o formato geral da Pangeia de cada semente continua
  parecido com o da v1.x; o contorno e o interior mudam.

### Critério de "bonito" (usuário, 2026-10-15)
Depois de a Pangeia se partir: 4 a 7 continentes de tamanhos variados, com penínsulas, golfos e
mares internos, fronteiras de placa irregulares, nenhum continente com mais de ~40% da terra.
Conferido em 5 sementes fixas (`docs/img/m2-formas-antes.png` e `-depois.png`) e testado no CI
(`tests/world/shapes.test.ts`, N = 128).

## Desastres (Marco 2)
| Desastre   | Onde surge                         | Gatilho                     |
|------------|------------------------------------|-----------------------------|
| Terremoto  | bordas de placa                    | tensão acumulada            |
| Vulcão     | convergentes e pontos quentes      | tensão + aleatório semeado  |
| Tsunami    | costa perto de terremoto submarino | terremoto no oceano         |
| Seca       | regiões já secas ou sob anomalia   | precipitação abaixo do normal |
| Enchente   | vales e planícies úmidas           | precipitação acima do normal |
| Furacão    | oceanos tropicais quentes          | temperatura do mar alta     |
| Incêndio   | florestas secas                    | seca + calor                |

Todo desastre tem: probabilidade base, intensidade, área, e registro na crônica se for grande.
O jogador também pode provocar qualquer desastre manualmente.

## Recursos minerais e petróleo (geração no Marco 2; uso nos Marcos 4 e 7)
Ideia do usuário registrada em 2026-10-15.
- **19 tipos** (decisão do usuário, 2026-10-17), gerados pela **geologia real**, não espalhados ao
  acaso, em **províncias**: regiões ricas num tipo, poucas jazidas grandes e várias pequenas, quase
  nada fora delas; nenhum continente tem de tudo. Poucas jazidas e importantes, porque também se
  formam com o tempo.
  | Grupo | Recurso | Onde se forma | Por quê (geologia real) |
  |-------|---------|---------------|-------------------------|
  | Metais | Cobre (e molibdênio) | arcos de subducção | depósitos pórfiros acima da placa que afunda |
  | Metais | Prata | arcos de subducção, junto do cobre | veios hidrotermais |
  | Metais | Ouro | arcos, crátons antigos e zonas de colisão | cinturões de rochas verdes, veios em falhas |
  | Metais | Ferro | crátons antigos | formações ferríferas bandadas |
  | Metais | Manganês | mares rasos antigos sobre crátons | sedimentos de manganês |
  | Metais | Cromo | ofiolitos (crosta oceânica empurrada nas colisões) e intrusões antigas em crátons (como o Bushveld) | magma do manto |
  | Metais | Estanho | granitos das zonas de colisão | granitos de crosta derretida |
  | Metais | Alumínio (bauxita) | terra antiga, plana, em clima tropical muito chuvoso | solo lavado pela chuva (laterita); fica como herança se o continente sair dos trópicos |
  | Metais | Nióbio | carbonatitos, **raros** (intraplaca e riftes) | magmas raros e alcalinos |
  | Metais | Terras raras | carbonatitos, junto do nióbio, **raras** | magmas raros e alcalinos |
  | Metais | Lítio | salares em planaltos secos perto de arcos; pegmatitos | salmoura evaporada; granitos |
  | Energia | Petróleo e gás | bacias sedimentares (margens passivas, riftes antigos, mares rasos), **também no mar raso** | matéria orgânica soterrada e aquecida |
  | Energia | Carvão | bacias de antigas florestas pantanosas | vegetação soterrada |
  | Energia | Urânio | crátons antigos e bacias | rochas antigas e arenitos |
  | Agricultura | Potássio | bacias de mar que secou, junto do sal | evaporitos |
  | Agricultura | Nitratos | desertos muito secos, **raros** | sais acumulados sem chuva (como o Atacama) |
  | Indústria | Sal | bacias secas e riftes antigos | evaporitos |
  | Indústria | Enxofre | vulcões dos arcos e domos de sal | gases vulcânicos; bactérias no sal |
  | Indústria | Calcário | mares rasos antigos, **comum** | conchas e recifes |
- Formam-se **na geração e durante a deriva** (arco ativo há tempo ganha cobre/ouro; rifte e margem
  passiva antigos ganham petróleo; colisão ganha ouro); crosta que afunda leva a jazida junto.
- **Petróleo fica escondido** no subsolo até o terreno ser cavado (Rebaixar; os humanos no M4).
  Na camada "Ver recursos" o jogador vê tudo; "escondido" vale para os humanos.
- Cada depósito tem tipo, quantidade e profundidade, e **pertence a uma placa: move-se junto
  com ela** na deriva.
- Visível como **camada opcional** no menu Geologia ("Ver recursos").
- Determinístico pela semente, como todo o resto.
- **Uso** (mineração, armas, eletrônica, economia, combustível) não é do M2: economia básica no
  Marco 4 (`05-civilizacao-politica.md`) e tecnologia militar no Marco 7 (`06-guerra.md`).
