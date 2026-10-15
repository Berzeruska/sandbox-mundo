# M1 — Especificação do Marco 1: o globo

Pré-requisito: Marco 0 concluído.
Branch: `marco-1`.

## Objetivo
Um planeta redondo, gerado por semente como Pangeia, que se gira e aproxima em qualquer ponto
(polos incluídos) até preencher a tela, com biomas reais, edição de terreno e gelo, e controle de
tempo. Fluido no celular.

## Tarefas (fazer em ordem; cada uma = um commit)

- [x] **T1 — Gerador com semente** (`src/core/rng.ts`)
  PRNG determinístico (ex.: mulberry32 ou sfc32). Testes: mesma semente → mesma sequência.

- [ ] **T2 — Geometria cube-sphere** (`src/world/cubesphere.ts`)
  Conversão célula (face, x, y) ↔ ponto 3D na esfera ↔ latitude/longitude.
  Vizinhos de uma célula, inclusive atravessando bordas entre faces.
  Testes: ida e volta das conversões; toda célula tem exatamente 4 vizinhos ortogonais;
  vizinhança é simétrica (se A vê B, B vê A).

- [ ] **T3 — Estado do mundo** (`src/world/state.ts`)
  Arrays tipados por célula: elevação, temperatura, precipitação, bioma, gelo.

- [ ] **T4 — Geração da Pangeia** (`src/world/generation.ts`)
  Ruído 3D na esfera + máscara de supercontinente. Parâmetros: semente, nível do mar, fração de terra.
  Testes: determinismo; fração de terra dentro de ±5% do alvo; um continente principal dominante.

- [ ] **T5 — Clima e biomas** (`src/world/climate.ts`, `src/world/biomes.ts`)
  Temperatura (latitude + altitude), precipitação (faixas + oceano + sombra de chuva), classificação
  nos biomas de `docs/03-mundo-geologia.md`, calotas nos polos.
  Testes: polo mais frio que equador; montanha alta mais fria que a base; todos os biomas
  da lista são alcançáveis com algum par temperatura × precipitação.

- [ ] **T6 — Renderização do globo** (`src/render/`)
  WebGL2, textura de 6 camadas com filtro NEAREST, shader ortográfico, iluminação simples
  (lado iluminado e sombra suave) e fundo de espaço.
  Verificação manual: globo nítido, sem emenda visível entre faces, polos sem distorção.

- [ ] **T7 — Câmera e controles** (`src/render/camera.ts`, `src/input/`)
  Mouse: arrastar gira, roda dá zoom no ponto do cursor.
  Toque: um dedo gira, pinça dá zoom, toque duplo aproxima.
  Zoom do globo inteiro até o pedaço preencher a tela com pixels de célula visíveis.
  Giro com inércia leve. Funciona em cima dos polos.

- [ ] **T8 — Pincéis de terreno e gelo** (`src/input/tools.ts`)
  Elevar, rebaixar, água, gelo, apagar gelo; tamanho do pincel. Modo pintar × modo mover
  (botão alternador, essencial no celular). Recalcular clima e bioma só na área afetada.
  Atualizar só a parte alterada da textura.

- [ ] **T9 — Relógio e controle de tempo** (`src/core/time.ts`, `src/ui/hud.ts`)
  Data do mundo (ano), pausa e velocidades 1×, 2×, 5×, 20×, máximo. No M1 o tempo só avança o
  calendário; a estrutura de tick fixo já fica pronta para o M2.

- [ ] **T10 — Interface mínima e painel de depuração**
  Botões grandes para toque. Painel com fps, ms por quadro, número de células, semente.
  Botão "novo mundo" com campo de semente.

- [ ] **T11 — PWA**
  Manifest + service worker: instalar na tela inicial e abrir offline.

- [ ] **T12 — Medição no celular e ajuste**
  Medir fps no celular do usuário. Se < 30 fps, reduzir resolução ou otimizar até atingir.
  Registrar resultado em `docs/decisoes.md`.

## Critérios de aceite do usuário
1. Abro o link no celular e vejo um planeta redondo com um supercontinente.
2. Giro e aproximo qualquer lugar, inclusive os polos, até o terreno preencher a tela.
3. Pinto montanha, água e gelo; os biomas ao redor reagem.
4. Mudo a semente e nasce outra Pangeia.
5. Nada trava nem engasga de forma perceptível.

## Fora do M1 (não fazer agora)
Placas, deriva, desastres, vida, humanos, simulação em Worker.
