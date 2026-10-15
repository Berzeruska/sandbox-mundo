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

## Simulação
- Tick fixo (passo de tempo constante), independente da taxa de quadros.
- Velocidades: pausado, 1×, 2×, 5×, 20×, máximo. Em velocidade alta, renderização cai de frequência
  antes da simulação.
- A partir do Marco 2, a simulação roda num **Web Worker** (outra thread), para a tela nunca travar.
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
- Notebook: 60 fps. Celular intermediário: ≥ 30 fps.
- Um painel de depuração (fps, ms por tick, células) acessível por botão, desde o Marco 1.
- Se o orçamento estourar, reduzir resolução antes de cortar mecânica.
