# 01 — Arquitetura técnica

## Pilha
- **TypeScript** (modo estrito) + **Vite** (servidor e build) + **Vitest** (testes) + ESLint.
- **WebGL2** para desenhar o planeta (shader). **Canvas 2D** sobreposto para interface e marcações.
- Sem engine de jogo. Sem framework de UI no início (HTML + CSS simples para botões).
- PWA (manifest + service worker) para instalar no celular.
- Deploy: GitHub Actions → GitHub Pages.

Motivo do TypeScript: o compilador pega uma classe inteira de erro antes de rodar, o que importa
num projeto escrito majoritariamente por IA.

## Geometria do mundo: esfera em cubo (cube-sphere)
- O planeta é um cubo de 6 faces, cada face uma grade `N × N` de células, projetado na esfera.
- Vantagem sobre a grade retangular (latitude × longitude): células de tamanho parecido em todo o
  globo, **polos sem distorção** e editáveis como qualquer outra região.
- Custo: vizinhança nas bordas entre faces exige mapeamento. Isso vive isolado em
  `src/world/cubesphere.ts`, com testes exaustivos.
- Resolução inicial: `N = 256` (≈ 393 mil células). Ajustável; medir no celular antes de subir.

## Câmera: zoom contínuo, sem troca de modo
- O globo é sempre desenhado em projeção ortográfica (como uma bola vista de longe).
- Zoom = aumentar o raio aparente. Com zoom alto, o pedaço visível é quase plano e **preenche a tela
  inteira** — é assim que o globo "se encaixa ao formato da tela".
- Arrastar = girar o globo. Pinça = zoom. Toque duplo = aproximar no ponto.
- O que se vê no globo É o estado da simulação; não existem dois mapas para sincronizar.

## Renderização
- O estado visual das células (cor do bioma, gelo, água) é enviado à GPU como textura
  (array de 6 camadas, filtro NEAREST para pixel nítido).
- O shader, por pixel da tela: raio → ponto na esfera → face + coordenada → lê a célula.
- Só células alteradas são reenviadas (atualização parcial da textura, copiada para um bloco
  contínuo antes do envio).
- Detalhe visual (T13): o shader deforma as fronteiras entre células com ruído e aplica textura
  sutil por bioma, lendo ruído de uma textura 3D fixa. A simulação continua na grade; é só desenho.
- Movimento das placas (M2): entre recomposições o shader desgira cada pixel pela rotação rígida da
  placa dele (textura de placas + ângulos vindos do worker); na troca de composição há 350 ms de
  transição. Regra espelhada em TypeScript (`src/render/plate-motion.ts`) para os testes.

## Simulação
- Tick fixo (passo de tempo constante), independente da taxa de quadros.
- Velocidades: pausado, 1×, 2×, 5×, 20×, máximo. Em velocidade alta, renderização cai de frequência
  antes da simulação.
- A partir do Marco 2, a simulação roda num **Web Worker** (outra thread), para a tela nunca travar.
  Organização: `src/sim/core.ts` (núcleo, testável), `src/sim/worker.ts` (adaptador do worker),
  `src/sim/client.ts` (lado da thread principal) e `src/sim/protocol.ts` (mensagens e remendos).
  A thread principal só desenha a cópia das cores e manda comandos; nunca lê o mundo direto.
- Estado em **arrays tipados** (`Float32Array`, `Uint8Array`), não em milhares de objetos.

## Dois níveis de simulação (a partir do Marco 3)
- **Nível agregado:** cada região guarda números (população por espécie, comida, doença, exército).
  Roda no mundo inteiro, barato.
- **Nível individual:** perto da câmera, os números viram indivíduos com posição e comportamento.
  Ao afastar, os indivíduos voltam a ser números, preservando os totais.
- Regra de ouro: os dois níveis obedecem às mesmas taxas (nascimento, morte, combate). O nível
  individual detalha; não contradiz.

## Organização de pastas
```
src/
  core/      rng.ts (semente), time.ts (relógio e velocidades), events.ts
  world/     cubesphere.ts, generation.ts, climate.ts, biomes.ts, state.ts
  render/    globe-renderer.ts, shaders/, camera.ts
  input/     touch.ts, mouse.ts, tools.ts (pincéis)
  ui/        hud.ts, panels.ts
  main.ts
tests/       espelha src/
docs/
```

## Orçamento de desempenho
- **Aparelho-alvo (2026-10-15): Infinix Hot 50i** — MediaTek Helio G81 (só 2 núcleos fortes
  Cortex-A75 a 2,0 GHz + 6 Cortex-A55), GPU **Mali-G52 MP2**, tela 720p a 120 Hz. Tudo é otimizado
  pensando nele. Consequências: o worker e a thread principal disputam os 2 núcleos fortes (o worker
  só trabalha quando há o que fazer); a GPU tem pouca banda e pouco cálculo por pixel (shader leve,
  sem trabalho repetido por quadro).
- **Sem opção de qualidade** (decisão do usuário): o jogo inteiro tem que rodar bem no aparelho-alvo.
- Metas no aparelho-alvo: pausado ≥ 85 fps; tempo rodando ≥ 60 fps; placas em deriva ≥ 30 fps,
  nunca abaixo de 20; geração de mundo ≤ 3 s. Notebook: 60 fps.
- Estimativa antes de pedir medição ao usuário: navegador com CPU desacelerada 6× (emulação).
  O relatório do botão "Medir desempenho" (painel Dados), rodado no aparelho, é a verdade.
- Um painel de depuração (fps, ms por tick, células) acessível por botão, desde o Marco 1.
- Se o orçamento estourar, reduzir resolução antes de cortar mecânica.
