# 04 — Ecologia (Marco 3)

## Problema a resolver
Em sandboxes comuns, o mundo oscila entre desastre e "nada acontece": espécies somem rápido,
predadores morrem de fome, nada se estabiliza. Aqui o objetivo é **equilíbrio dinâmico**: populações
sobem e descem em ciclos, raramente zeram.

## Mecanismos de equilíbrio
1. **Capacidade de suporte** por região e bioma: cada célula sustenta um máximo de biomassa vegetal;
   herbívoros são limitados pelas plantas, carnívoros pelos herbívoros.
2. **Crescimento logístico:** a taxa de nascimento cai quando a população se aproxima do limite.
3. **Ciclo predador–presa:** modelo do tipo Lotka–Volterra com saturação (predador não come
   infinitamente), o que gera oscilação em vez de extinção.
4. **Nichos:** cada espécie tem biomas preferidos, dieta e faixa de temperatura. Espécies com
   nichos diferentes não competem diretamente.
5. **Migração:** população sob fome se espalha para regiões vizinhas antes de morrer.
6. **Refúgio:** uma fração pequena de cada população fica fora de alcance de predadores (abrigo),
   evitando extinção total por caça.

## Predador de topo raro (ex.: dragão)
- Território enorme, reprodução rara, vida longa.
- Com fome, migra e reduz atividade (hiberna) em vez de morrer.
- População mínima viável protegida por regra de baixa mortalidade adulta.

## Domesticação (preparada aqui, usada no Marco 4)
- Espécies têm atributo `domesticável` e `temperamento`.
- Povoado humano estável próximo + tempo de contato → a espécie vira rebanho daquele povo.

## Avisos ao jogador
- **Espécie em risco:** população global abaixo de um limiar.
- **Último indivíduo:** aviso destacado, com botão para ir até ele na câmera.
- **Extinção:** registro permanente na crônica.

## Teste automático de aceite
Rodar 1.000 anos simulados (sem render) com sementes fixas e verificar:
- nenhuma extinção em massa (> X% das espécies em < Y anos);
- populações não ficam paradas (variância mínima ao longo do tempo).
Os limiares X e Y são definidos e ajustados durante o marco, e registrados em `decisoes.md`.

## Feedback ambiental (base no Marco 3; guerra no Marco 7)
Ideia do usuário registrada em 2026-10-15. O ambiente reage ao que as civilizações fazem, e isso
volta para elas:
- **Desmatamento** → erosão, enchentes, deslizamentos e desertificação na região.
- **Queima de combustível fóssil** (petróleo, carvão) → aquecimento global → mais secas e furacões
  (liga com o clima e os desastres do Marco 2 e com a temperatura global).
- **Bombas** (Marco 7) → incêndio, contaminação do solo e da água e, em escala grande,
  **inverno nuclear** (queda de temperatura global e de colheitas).
- **Florestas densas e fauna preservada devem valer a pena** para as civilizações: proteção contra
  enchente e erosão, caça, madeira renovável, chuva regional, vantagem militar defensiva (floresta
  favorece túneis e emboscada, ver `06-guerra.md`).
- O Marco 3 prepara a base (vegetação, solo e fauna reagindo a perturbações); os gatilhos humanos
  entram nos Marcos 4 (desmatamento, agricultura) e 7 (combustível fóssil em escala, bombas).

## Desastres e a vida (ideia do usuário, 2026-10-17; o M2 só muda terreno, bioma e vegetação)
- **Princípio geral: as características do mundo são tratadas em porcentagem** (cobertura de vegetação,
  quanto uma região sustenta, quanto um desastre tira). O M2 já guarda a vegetação de cada célula em
  porcentagem (redesenho dos desastres, `docs/M2-especificacao.md`).
- **Seca:** dificulta a vida na região em até 30% (menos plantas, menos comida e água).
- **Furacão:** "puxa as coisas": arrasta criaturas e objetos leves no caminho.
- **Terremoto:** destrói o que está em cima do ponto onde começa (no M2, terreno e bioma; depois,
  criaturas e construções).
- **Enchente:** deixa solo fértil (várzea), bom para plantas e, no M4, para a agricultura.
