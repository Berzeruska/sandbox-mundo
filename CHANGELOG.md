# Changelog

## [Não lançado]

## [3.0] — aguardando a aprovação do usuário — Marco 3: ecologia
- **De perto, a maquete:** ao aproximar, o globo dá lugar a uma maquete em 3D do mesmo lugar, que carrega em pedaços: relevo em terraços limpos, montanhas em degraus com neve, rios em curva, lagos, cachoeiras,
  pântano, gelo, deserto com dunas e mesetas, vulcões, 19 plantas em 4 estados e as 19 jazidas com a cor de cada minério. Os desastres do M2 acontecem nela em 3D.
- **Vida em números e em indivíduos:** 26 espécies de terra e de mar com capacidade pelo bioma, crescimento logístico, caça com saturação, refúgio e migração. De longe o mundo guarda números; de perto
  cada pedaço mostra os bichos do lugar: nascem, pastam, caçam, fogem e morrem (sangue leve, sem pedaços).
- **Desastres e clima mexem com a vida:** fogo, lava, água e fenda matam e espantam; a seca tira até 30% do que a terra sustenta; no planeta congelado ou em calor extremo quem não cabe some; floresta grande segura a chuva da região.
- **Cartão "Vida":** todas as espécies com o total do mundo e ícones no globo onde vivem; poderes de deus: pôr, matar, acompanhar com a câmera e mudar tamanho, fome, agressividade, velocidade e fertilidade da espécie.
- **Classe mítica:** dragão, kraken e baleia branca colossal, só postos por deus.
- **Avisos:** espécie em risco, último indivíduo (tocar leva até ele), extinção e recuperação.
- **Ritmo do tempo:** na maquete, em 1×, um mês por segundo, para fogo, bichos e chuva ficarem na mesma escala.
- Medição no notebook-alvo, no Firefox, e decisões provisórias a revisar: `docs/M3-revisao.md`, `docs/M3-fidelidade.md`, `docs/medicao-m3-final.txt`.

## [2.0] — 2026-11-05 — Marco 2: geologia viva
- Placas tectônicas: a Pangeia se parte, os continentes derivam, colidem e se soldam, dorsais abrem oceanos, rupturas e ciclo de Wilson. Controle
  "Placas" de 0 a 100%; em 0 a geologia congela. A recomposição roda num ajudante, sem travar a tela nem o relógio.
- Toda a simulação em Web Workers. Menu por categorias, camada "Ver placas" e o painel "Medir desempenho", com registro de travadas.
- Desastres naturais e provocados: terremoto, vulcão, tsunami, meteoro com cratera de verdade, furacão, tempestade de areia, incêndio, raio, seca, enchente. Frequência de "Nenhum" a "Muitos",
  avisos só dos grandes e lista completa.
- Tipos de mundo na abertura (cartões "Escolha o seu mundo"), entre eles o arquipélago.
- Clima que acompanha as placas e a temperatura global: controle de temperatura, ciclo glacial, nível do mar e inverno de impacto, sem tranco na tela.
- Recursos minerais e camada "Ver recursos"; o relevo revela jazidas.
- Modo de tempo geológico: em 20× ou Máx com placas andando, planeta inteiro, zoom travado e a data rolando de 500 em 500 ou de 1.000 em 1.000 anos.
- Meta de desempenho medida no notebook-alvo: 60 fps em todos os cenários, sem travadas (`docs/medicao-2026-11-05-final.txt`).
- Pendências registradas para o ajuste fino depois do M3 em `docs/02-marcos.md`.

## [1.1] — 2026-10-15 — Ajustes visuais da v1.0
- Projeção cubo→esfera verificada: já era a equiangular (área maior/menor 1,41; a gnomônica seria
  5,16). O losango nos cantos do cubo é geométrico e foi escondido no desenho (abaixo).
- Grade escondida no shader: fronteiras orgânicas entre biomas, costas e calotas, e textura sutil
  por bioma; somem ao afastar o zoom. Ruído lido de textura 3D: custo de GPU praticamente nulo.
- Pincéis Elevar/Rebaixar em forma de sino (forte no centro, zero na borda) e com teto macio:
  fazem morro e bacia, não platô.
- Sombreado de relevo: encostas iluminadas de noroeste, inclusive nas montanhas naturais.
- A mesma semente gera exatamente o mesmo mundo da v1.0 (conferido byte a byte).

## [1.0] — 2026-10-15 — Marco 1: o globo
- Planeta cube-sphere (6 × 256² células) desenhado em WebGL2, pixel nítido, luz suave e espaço.
- Pangeia gerada por semente (número ou palavra), ~30% de terra num supercontinente, cordilheiras.
- Clima por latitude, altitude, umidade e sombra de chuva (ventos por faixa de latitude);
  16 biomas; calotas polares.
- Controles: girar (o ponto sob o dedo acompanha o dedo, inclusive nos polos), pinça, roda do mouse,
  toque/clique duplo, inércia, botão "norte para cima".
- Pincéis: elevar, rebaixar, água, gelo e derreter, tamanho 1–30, com recálculo local do clima.
- Relógio de passo fixo com pausa, 1×, 2×, 5×, 20× e máximo (barra de espaço pausa).
- Novo mundo por semente, também pela URL (`?seed=...`); painel de depuração com fps.
- Instalável como app (PWA) e abre offline.
- Correção: lagos e costas com bordas retas no celular (envio parcial da textura; ver `docs/bugs.md`).
- Desempenho: 60 fps no notebook (Radeon 610M), 68–91 fps no celular do usuário; mundo gerado em ~0,6 s.

## [0.1] — 2026-10-14 — Marco 0: fundação
- Documentação inicial do projeto (visão, arquitetura, marcos, sistemas).
- Projeto Vite + TypeScript estrito + Vitest + ESLint, `npm run check`,
  GitHub Actions (check em todo push, deploy de `main` no GitHub Pages), página inicial.
