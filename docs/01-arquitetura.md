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

### Plano de ajudantes (workers), M2 → M7 (aprovado pelo usuário em 2026-10-16)
No máximo **3 ajudantes** além da thread principal. O aparelho tem só 2 núcleos fortes, e a tela e o
relógio já ficam com eles; ajudante a mais só gasta memória e coordenação.

| Thread | O que roda | Nasce em | Núcleo provável |
|---|---|---|---|
| Principal | desenho, toque, menus | já existe | forte |
| Ajudante 1 "relógio" (`src/sim/worker.ts`) | avanço do tempo a cada passo: deriva, desastres, tudo que é individual perto da câmera (animais M3, pessoas M4, tropas e veículos M6–M7) | M2 (T2) | forte |
| Ajudante 2 "Terra" | trabalhos grandes e raros: recomposição das placas, recálculo do clima; depois erosão, minerais, gelo (T6–T7); contaminação e aquecimento (M7) | M2 (correção 2) | fraco serve |
| Ajudante 3 "vida e sociedade" | ecologia agregada (M3), economia e povoados (M4), política e crônica (M5), estratégia de guerra: frentes e logística (M6), árvore tecnológica (M7) | M3 | fraco serve |

- **Regra:** os ajudantes 2 e 3 entregam resultados "para depois" (aplicados num passo fixo à frente,
  para continuar determinístico); nunca fazem o relógio esperar.
- **Núcleos fracos:** o jogo não escolhe o núcleo, o Android escolhe. Thread leve ou intermitente
  tende a ficar num A55 (estimado 2–3× mais lento que um A75). Os ajudantes 2 e 3 têm de ter folga para
  isso: com placas 100% a recomposição é pedida a cada ~3,6 s; num A55 ela levaria ~2–3,5 s hoje. Por
  isso a recomposição mais barata (opção a) vem depois, como complemento.
- **Ajudante 2 também ajuda na geração (2026-10-16):** o relógio divide com ele a primeira passada
  do terreno (`src/world/cell-pool.ts`, pedaços pegos de um contador em memória compartilhada; mesmo
  mundo). Mundo novo encerra o ajudante na hora e um reserva já carregado assume (um worker criado pelo
  relógio só carrega quando o relógio fica livre). Custa um worker parado a mais (poucos MB).
- **Ajudante 2 feito (correção 2, 2026-10-16):** `src/sim/geology.ts` (motor, testável sem worker),
  `src/sim/geology-worker.ts` (adaptador), criado pelo worker do relógio. A recomposição do passo T
  aparece no passo T + `APPLY_DELAY_TICKS` (480); o relógio nunca passa disso à frente do motor e espera
  se ele atrasar. Determinístico: o resultado é o mesmo com o motor no relógio ou no ajudante.
- **Memória compartilhada (SharedArrayBuffer)** entre os ajudantes, para não copiar o mundo. Exige
  isolamento entre origens (cabeçalhos COOP/COEP), que o GitHub Pages não deixa configurar; o service
  worker do jogo os acrescenta. Primeiro testar no aparelho; se não funcionar, perguntar ao usuário
  antes de seguir com cópia (+45–48 MB em vez de ~+15–20 MB).

### Teto de memória
- **Dados do jogo ≤ 150 MB de RAM** no aparelho-alvo (Hot 50i com 4 GB), medido no fim de cada marco.
  Não contam o próprio navegador (~100–150 MB) nem a memória de vídeo (~20–40 MB).
- Estimativa por marco (N = 256, ~393 mil células): hoje 53 MB ao abrir → 66 aos 15 min (medido);
  fim do M2 70–85; M3 85–115; M4 95–130; M5 100–140 (crônica com teto, a antiga resumida);
  M6 105–155; M7 115–170. Os marcos que passam do teto na estimativa precisam caber no desenho
  (tipos menores por célula, camadas só onde há algo).
- Tamanho de instalação (separado da RAM; o mundo é gerado, não baixado): hoje 0,18 MB; M3–M4
  0,3–1 MB; M5–M7 1–2 MB; M8 5–20 MB (imagens e sons). Mundo salvo: 2–5 MB por mundo no M2,
  10–30 MB no M7 (estimativa).
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
- Se o orçamento estourar, reduzir resolução antes de cortar mecânica (mas sem opção de qualidade:
  o que valer, vale para todos).

### Como medir (o que funciona e o que engana)
- **Verdade:** o relatório do botão "Medir desempenho" (Mundo → Dados), rodado no aparelho-alvo.
  ~2 min: pausado, girando, tempo 20× com placas paradas (também com o painel aberto com e sem o
  desfoque antigo), placas 100%, deriva longa com colisões e geração; mostra GPU, fps médio/mínimo/
  pior quadro, trabalho da tela, worker por passo e por parte da recomposição, soldas e pedaços.
- **CPU lenta 6× no Chrome** (Emulation.setCPUThrottlingRate) desacelera só a thread principal, não o
  worker: serve para estimar o custo da tela; o worker se estima pelos números do relatório.
- **Custo do shader:** consultas de tempo de GPU (EXT_disjoint_timer_query_webgl2) em volta do desenho
  do globo, com a tela no tamanho do celular (360×664 a 2×). No notebook (Radeon 610M) o globo custa
  ~1,5 ms parado e ~1,8 ms em deriva; a Mali-G52 MP2 é ~5–8× mais lenta. O SwiftShader (GPU por
  software) não serve para medir desempenho: os quadros travam em ~83 ms qualquer que seja o shader.
- **Suavidade do movimento:** medir quadro a quadro dentro da página (ler os pixels a cada desenho e
  contar quadros com > 2% dos pixels mudando de uma vez), nunca por capturas de tela.
- **Placas:** sondas no Vitest com N = 128 (5 sementes, 5 min a 20× e 100%): trocas A→B→A, pedaços
  soltos, colisões sem soldar; mapas equirretangulares de 5 sementes aos 0/1/2 min para as formas.
