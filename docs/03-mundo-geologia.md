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

## Placas tectônicas (Marco 2)
- O mundo é dividido em placas (polígonos na esfera), cada uma com eixo e velocidade de rotação.
- **Velocidade controlada pelo jogador**, de zero ao máximo. Zero congela a geologia.
- Bordas convergentes: montanhas, vulcões, terremotos fortes; subducção cria fossas.
- Bordas divergentes: dorsais oceânicas, vales em rifte, vulcanismo fraco.
- Bordas transformantes: terremotos sem vulcão.
- Referência real: a Pangeia levou ~200 milhões de anos para virar o mapa atual. O jogo comprime
  isso; a escala é regulada pelo controle de velocidade.
- Cidades sobre terreno que muda: sofrem dano/terremoto, não "teletransportam". Regras no Marco 2.

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
