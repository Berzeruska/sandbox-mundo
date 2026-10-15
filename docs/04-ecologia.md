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
