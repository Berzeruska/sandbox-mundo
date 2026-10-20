# 02 — Marcos

Cada marco termina jogável e testável no celular. Só se começa o próximo com o anterior aceito
pelo usuário.

Marco atual: **Marco 2** — especificação aprovada em 2026-10-15 (`docs/M2-especificacao.md`).
Onde paramos e o que vem depois: seção "Estado" da especificação do M2.
Marco 0 aceito em 2026-10-14. Marco 1 aceito em 2026-10-15 (`v1.0`).

---

## Marco 0 — Fundação do repositório
- [x] Projeto Vite + TypeScript estrito + Vitest + ESLint configurados
- [x] `npm run check` (tipos + lint + testes) funcionando
- [x] Repositório no GitHub criado e com o primeiro push
- [x] GitHub Actions: `check` em todo push; deploy de `main` no GitHub Pages
- [x] Página publicada abrindo no celular (tela preta com "Sandbox Mundo" basta)
- [x] `CHANGELOG.md`, `docs/bugs.md` criados

**Aceite:** o usuário abre o link do GitHub Pages no celular e no notebook.

## Marco 1 — O globo
Especificação detalhada: `docs/M1-especificacao.md`.
Planeta redondo com zoom contínuo, Pangeia gerada por semente, polos, biomas reais, pincéis de
terreno e gelo, controle de tempo, painel de depuração.

**Aceite:** girar, aproximar qualquer ponto (incluindo polos) até preencher a tela, editar terreno e
gelo, tudo fluido no celular do usuário.
**Concluído em 2026-10-15** — todas as tarefas T1–T12 marcadas na especificação; celular a 68–91 fps.

## Marco 1.1 — Ajustes visuais da v1.0 (branch `marco-1.1`)
Pedidos do usuário após testar a v1.0 no celular.
- [x] **T12.1 — Projeção:** verificar cubo→esfera e medir distorção (já era equiangular; ver decisões)
- [x] **T13 — Detalhe visual no shader:** bordas orgânicas entre biomas e textura sutil por bioma,
  escondendo a grade, sem mudar a simulação; fps antes/depois
- [x] **T14 — Pincéis com queda suave:** Elevar/Rebaixar fortes no centro e zero na borda, sem platô

**Aceite:** sem visual de "prisma" perto dos cantos do cubo; morro pintado tem forma de morro.
Fecha com PR para `main` e tag `v1.1`. **Publicado em 2026-10-15 (`v1.1`)** e validado pelo usuário no
celular (os números viraram a linha de base de desempenho, em `docs/decisoes.md`).

## Marco 2 — Geologia viva
Placas tectônicas, deriva continental com velocidade controlada pelo jogador (inclusive zero),
montanhas nas colisões, terremotos, vulcões, tsunamis, desastres climáticos (seca, enchente,
furacão). Simulação passa para Web Worker. Ver `docs/03-mundo-geologia.md`.

**Aceite:** a Pangeia se parte em continentes ao longo do tempo acelerado sem travar a tela;
desastres surgem onde a geologia e o clima indicam.

## Marco 3 — Ecologia
Plantas e animais em nível agregado e individual, cadeia alimentar, migração, dragão como predador
de topo, avisos de espécie em risco e de último indivíduo. Ver `docs/04-ecologia.md`.
Anotado em 2026-10-17 (usuário): **floresta grande afeta o clima** (umidade, temperatura); a camada
"Ver biomas" (feita na T7) é a base para ver isso. **Criaturas vistas de cima**, no estilo de um
sandbox de deus visto do alto (conteúdo nosso, regra 8): ao especificar o M3, confirmar que a vista de
perto e a escala do planeta permitem bonecos legíveis (junto com a ideia já registrada de zoom maior
para bonecos pequenos).
Anotado em 2026-10-19 (usuário, proposta P9 em `docs/M2-especificacao.md`): **temperatura no extremo
transforma o planeta** ("Mad Max" no calor máximo, era glacial total no frio máximo, como já dá com os
meteoros). A parte física é do clima (T7); a recomendação é fazer no M3, com a vida reagindo. Decisão do
usuário pendente.
Inclui a base do **feedback ambiental** (vegetação, solo e fauna reagindo a perturbações) e a
**escala visual** pequena dos indivíduos (`docs/00-visao.md`).

**Questão aberta para a especificação do M3 (não decidida, registrada em 2026-10-15):**
escala do planeta versus tamanho dos humanos e das cidades. O usuário **não quer humanos de 1 pixel**.
Hoje, com um planeta do tamanho da Terra, cada célula tem ~33–39 km. Opções a avaliar:
1. **Planeta menor que a Terra** (células menores em km, mesma quantidade de células);
2. **Camada de detalhe local ao aproximar** (ao chegar perto, uma grade fina gerada a partir da
   célula grande, só na região visível);
3. **Humanos desenhados em escala própria** (indivíduos e cidades com tamanho visual fixo,
   independente da escala física do terreno).
Avaliar desempenho no celular, coerência com a simulação agregada × individual e com a escala
visual pequena pedida (`docs/00-visao.md`).
Ideia do usuário (2026-10-17), para M3, M4 e M8: **zoom maior que o de hoje**, para caberem bonecos
pequenos de humanos (uma montanha de 50 pixels com um homem de 5 fica estranho). Entra junto desta
questão de escala.

**Aceite:** 1.000 anos acelerados sem extinção em massa e sem estagnação (teste automático +
observação do usuário).

## Marco 4 — Humanos e economia básica
Aldeias, agricultura, caça, fome, doença, domesticação, crescimento de povoados, comércio simples.
**Uso econômico dos recursos minerais** gerados no M2; desmatamento com consequências ambientais;
povoados bem pequenos no mapa. Ver `docs/05-civilizacao-politica.md` e `docs/04-ecologia.md`.
Pedido do usuário (2026-10-16): os humanos **começam nômades**, com técnicas de caça, antes da
agricultura.
Ideia do usuário (2026-10-17): os nômades comem carcaças e frutas e **passam a caçar quando "dominam
o fogo"**, pegando um graveto de um incêndio, inclusive de um incêndio começado por raio (o raio
entra no M2). Na crônica, esse evento é a "Piromania" (`docs/07-cronica-nomes.md`).
Ideia do usuário (2026-10-17): zoom maior para caberem humanos pequenos (ver a questão de escala do
M3).
Anotado na T6 (2026-10-17): **água potável** (rios, lagos, chuva, água subterrânea, calculada do
clima e do relevo, a partir do M3/M4); humanos **escavando também revelam petróleo** escondido (o
estado "revelado" das jazidas nasce na T6); quem tem urânio no território não sabe usá-lo antes do M7.

## Marco 5 — Política e mente
Evolução de regimes, botão divino de concessão, ideologias, sistemas econômicos, líderes com
traços, legitimidade, golpes e revoluções, crônica do mundo, nomes de cidades.
**Quatro classes sociais** (elite cultural, política, militar com chefe do exército, operários).
Ver `docs/05-civilizacao-politica.md` e `docs/07-cronica-nomes.md`.

## Marco 6 — Guerra
Frentes fluidas, conquista contínua, trincheiras, logística, moral de tropa, combate visível de perto.
**Doutrinas ligadas a cultura, terreno e tecnologia** (ex.: guerra de túneis). Ver `docs/06-guerra.md`.
Anotado em 2026-10-17 (usuário): **floresta grande muda a doutrina de guerra** (cobertura, mobilidade,
emboscada).

## Marco 7 — Tecnologia militar
Árvore tecnológica militar; tanques, aviões, bombardeio, operados pela IA dos humanos.
Dissuasão e reconstrução para o mundo não se autodestruir. **Recursos estratégicos** (petróleo,
nióbio...), doutrina de **batalha profunda**, e consequências ambientais da guerra (incêndio,
contaminação, inverno nuclear) e do combustível fóssil (aquecimento).
Anotado na T6 (2026-10-17): **fontes de energia para usinas** (M4/M7). Petróleo, carvão e urânio já
são jazidas (T6); represa, calor da terra, vento e sol saem do mapa (rio com desnível, rifte ou
vulcão, faixas de vento, sol por latitude) quando as usinas existirem. Usos pedidos pelo usuário:
enxofre e nitratos para explosivos, manganês e cromo para armamento resistente, potássio para a
plantação, lítio e terras raras para eletrônica.

## Marco 8 — Embelezamento
Inclui o acabamento visual do menu de ferramentas (decidido no M2) e a escala visual pequena de
pessoas e cidades.
Sprites melhores, animações, possível pseudo-3D, som.
Pedidos do usuário (2026-10-18): uma lua (bolinha cinza orbitando o planeta) e um sol (bola amarela ao
fundo), simples, só para dizer que tem; o visual do furacão lembrando mais um mapa de meteorologia.
Pedido do usuário (2026-10-16): formações de erosão vistas de perto (pilares de arenito como os da
China, grandes "braços" de pedra); a erosão pelo clima em si é da T7 do M2.
Ideia do usuário (2026-10-17): zoom maior que o de hoje, para humanos pequenos ficarem
proporcionais ao relevo (ver a questão de escala do M3).

Ideia do usuário (2026-10-18), para o M8 ou depois: **câmera em primeira pessoa de um indivíduo**
(ver o mundo pelos olhos de uma criatura ou pessoa). Depende das criaturas (M3/M4) e do relevo em 3D
(o pseudo-3D do M8). Referência do usuário: o vídeo do Andrezitos com o WorldBox em visão 3D,
controlando uma criatura (só como referência de ideia; regra 8: nada copiado).
