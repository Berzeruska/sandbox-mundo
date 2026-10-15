# 02 — Marcos

Cada marco termina jogável e testável no celular. Só se começa o próximo com o anterior aceito
pelo usuário.

Marco atual: **Marco 0 → Marco 1**

---

## Marco 0 — Fundação do repositório
- [x] Projeto Vite + TypeScript estrito + Vitest + ESLint configurados
- [x] `npm run check` (tipos + lint + testes) funcionando
- [ ] Repositório no GitHub criado e com o primeiro push
- [x] GitHub Actions: `check` em todo push; deploy de `main` no GitHub Pages
- [ ] Página publicada abrindo no celular (tela preta com "Sandbox Mundo" basta)
- [x] `CHANGELOG.md`, `docs/bugs.md` criados

**Aceite:** o usuário abre o link do GitHub Pages no celular e no notebook.

## Marco 1 — O globo
Especificação detalhada: `docs/M1-especificacao.md`.
Planeta redondo com zoom contínuo, Pangeia gerada por semente, polos, biomas reais, pincéis de
terreno e gelo, controle de tempo, painel de depuração.

**Aceite:** girar, aproximar qualquer ponto (incluindo polos) até preencher a tela, editar terreno e
gelo, tudo fluido no celular do usuário.

## Marco 2 — Geologia viva
Placas tectônicas, deriva continental com velocidade controlada pelo jogador (inclusive zero),
montanhas nas colisões, terremotos, vulcões, tsunamis, desastres climáticos (seca, enchente,
furacão). Simulação passa para Web Worker. Ver `docs/03-mundo-geologia.md`.

**Aceite:** a Pangeia se parte em continentes ao longo do tempo acelerado sem travar a tela;
desastres surgem onde a geologia e o clima indicam.

## Marco 3 — Ecologia
Plantas e animais em nível agregado e individual, cadeia alimentar, migração, dragão como predador
de topo, avisos de espécie em risco e de último indivíduo. Ver `docs/04-ecologia.md`.

**Aceite:** 1.000 anos acelerados sem extinção em massa e sem estagnação (teste automático +
observação do usuário).

## Marco 4 — Humanos e economia básica
Aldeias, agricultura, caça, fome, doença, domesticação, crescimento de povoados, comércio simples.
Ver `docs/05-civilizacao-politica.md`.

## Marco 5 — Política e mente
Evolução de regimes, botão divino de concessão, ideologias, sistemas econômicos, líderes com
traços, legitimidade, golpes e revoluções, crônica do mundo, nomes de cidades.
Ver `docs/05-civilizacao-politica.md` e `docs/07-cronica-nomes.md`.

## Marco 6 — Guerra
Frentes fluidas, conquista contínua, trincheiras, logística, moral de tropa, combate visível de perto.
Ver `docs/06-guerra.md`.

## Marco 7 — Tecnologia militar
Árvore tecnológica militar; tanques, aviões, bombardeio, operados pela IA dos humanos.
Dissuasão e reconstrução para o mundo não se autodestruir.

## Marco 8 — Embelezamento
Sprites melhores, animações, possível pseudo-3D, som.
