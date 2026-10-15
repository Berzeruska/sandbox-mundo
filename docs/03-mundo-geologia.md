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
- 8 a 14 placas por mundo (sorteio próprio, separado do terreno: a mesma semente continua gerando o
  mesmo relevo).
- Voronoi na esfera com pesos (placas de tamanhos variados) e deformação por ruído (fronteiras
  curvas); depois cada placa fica com o seu maior pedaço contínuo (pedaços soltos vão para a vizinha).
- 3 a 5 sementes caem na terra: a Pangeia fica repartida em pelo menos 3 placas.
- Crosta continental onde é terra ou plataforma (acima de -500 m); oceânica no resto.
- Cada placa tem velocidade angular ω (polo de Euler × velocidade relativa 0,3–1). Placas
  continentais (≥ 30% de crosta continental) apontam para fora do centro do supercontinente, com
  um desvio aleatório: quando o movimento chegar (T4), a Pangeia se abre.
- Tipo de fronteira por célula, comparando o movimento das duas placas: aproximando = convergente,
  afastando = divergente, deslizando de lado = transformante. Duas rodadas de "voto da vizinhança"
  deixam cada trecho com um tipo só.
- Camada "Ver placas" (menu Geologia): cada placa com um tom e as fronteiras em vermelho
  (convergente), azul (divergente) e amarelo (transformante).

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
- Depósitos de **ferro, cobre, ouro, nióbio, petróleo, carvão** (e outros, como estanho, prata,
  urânio, sal), gerados pela **geologia real**, não espalhados ao acaso:
  | Recurso | Onde se forma | Por quê (geologia real) |
  |---------|---------------|-------------------------|
  | Cobre (e ouro, molibdênio) | arcos de subducção | depósitos pórfiros acima da placa que afunda |
  | Ferro | crátons antigos (interior estável e velho dos continentes) | formações ferríferas bandadas |
  | Ouro | crátons antigos e zonas de colisão | cinturões de rochas verdes, veios em falhas |
  | Petróleo e gás | bacias sedimentares (margens passivas, riftes, mares rasos antigos) | matéria orgânica soterrada e aquecida |
  | Carvão | bacias sedimentares de antigas florestas pantanosas | vegetação soterrada |
  | Nióbio | carbonatitos, **raros** (intraplaca e riftes) | magmas raros e alcalinos |
- Cada depósito tem tipo, quantidade e profundidade, e **pertence a uma placa: move-se junto
  com ela** na deriva.
- Visível como **camada opcional** no menu Geologia ("Ver recursos").
- Determinístico pela semente, como todo o resto.
- **Uso** (mineração, armas, eletrônica, economia, combustível) não é do M2: economia básica no
  Marco 4 (`05-civilizacao-politica.md`) e tecnologia militar no Marco 7 (`06-guerra.md`).
