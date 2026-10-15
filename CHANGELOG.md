# Changelog

## [Não lançado]

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
