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

**Aceite:** 1.000 anos acelerados sem extinção em massa e sem estagnação (teste automático +
observação do usuário).

## Marco 4 — Humanos e economia básica
Aldeias, agricultura, caça, fome, doença, domesticação, crescimento de povoados, comércio simples.
**Uso econômico dos recursos minerais** gerados no M2; desmatamento com consequências ambientais;
povoados bem pequenos no mapa. Ver `docs/05-civilizacao-politica.md` e `docs/04-ecologia.md`.

## Marco 5 — Política e mente
Evolução de regimes, botão divino de concessão, ideologias, sistemas econômicos, líderes com
traços, legitimidade, golpes e revoluções, crônica do mundo, nomes de cidades.
**Quatro classes sociais** (elite cultural, política, militar com chefe do exército, operários).
Ver `docs/05-civilizacao-politica.md` e `docs/07-cronica-nomes.md`.

## Marco 6 — Guerra
Frentes fluidas, conquista contínua, trincheiras, logística, moral de tropa, combate visível de perto.
**Doutrinas ligadas a cultura, terreno e tecnologia** (ex.: guerra de túneis). Ver `docs/06-guerra.md`.

## Marco 7 — Tecnologia militar
Árvore tecnológica militar; tanques, aviões, bombardeio, operados pela IA dos humanos.
Dissuasão e reconstrução para o mundo não se autodestruir. **Recursos estratégicos** (petróleo,
nióbio...), doutrina de **batalha profunda**, e consequências ambientais da guerra (incêndio,
contaminação, inverno nuclear) e do combustível fóssil (aquecimento).

## Marco 8 — Embelezamento
Inclui o acabamento visual do menu de ferramentas (decidido no M2) e a escala visual pequena de
pessoas e cidades.
Sprites melhores, animações, possível pseudo-3D, som.
