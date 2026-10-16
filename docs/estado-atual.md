# Estado atual do projeto

Atualizado em: **2026-10-16**, branch `marco-2`. O jogo publicado na prévia é o do G2 (`c0660ea`)
mais a correção da etiqueta da prévia (`4a11cf8`).
O Claude Code reescreve este arquivo ao fim de cada tarefa. Se outro documento disser outra coisa
sobre "onde estamos", vale este.

## Onde estamos
- **Marco:** M2 — Geologia viva (`docs/M2-especificacao.md`).
- **Bloco atual:** Bloco G (latitude, ciclo de Wilson, riftes).
- **Agora:** o usuário testou o G2 no celular (`c0660ea5`). Os diagnósticos pedidos estão prontos
  (seção "G2 — Teste no celular" da especificação). **Parado esperando aprovação** das propostas
  abaixo.
- **Direção do usuário (2026-10-16):** fechar o G3 dentro do que já foi especificado e seguir a lista
  do marco (T6 em diante). Melhoria nova de placas que não seja bug vai para os docs, não para agora.
  O mesmo vale para reclamações fora do módulo atual: registrar e seguir na prioridade.
- **Prévia:** berzeruska.github.io/sandbox-mundo/previa/marco-2/ — a linha "versão" do painel Dados
  tem que mostrar o último commit do `marco-2`. Versão mais antiga que `4a11cf8` = a aba ou o app
  instalado não recarregou.
- **Publicado em `main`:** v1.1.

## Esperando decisão do usuário
1. **Buraco ao Elevar na fronteira (bug):** aprovar a correção 1 — fenda entre dois continentes nasce
   como vale de rifte (300–800 m abaixo das vizinhas) até ter 3 células de largura; depois o meio vira
   mar como hoje.
2. **Tempo travando com placas no máximo (bug):** escolher (a) baratear a recomposição (a data ainda
   para ~0,5 s) ou (b) recomposição num segundo worker (o tempo não para; mudança maior). Em qualquer
   uma, corrigir o "pior" do relatório para ser por cenário.
3. **"Nenhuma placa come a outra":** a regra registrada (nada de comer alternadamente) é cumprida.
   Acreção de continente pequeno, placa oceânica sumindo por subducção e continente apagado na faixa
   de colisão são do desenho atual. Se a regra deve proibir isso, vira regra nova de placas → docs
   (pela direção do usuário), não agora. Confirmar.
4. **Ordem proposta:** correção 1 → correção 2 → G3 → T6 em diante.

## Feito no M2
- T1 menu por categorias, T2 Web Worker, T3 placas, T4 movimento e controle "Placas",
  T5 fronteiras e relevo (critério de "bonito" passa em 5 sementes).
- Geração v2 (costas e bacias), aceita.
- Correção do travamento do celular em "Gerando mundo… 92%".
- D1–D5 desempenho: metas batidas no celular.
- Correção dos pedaços de placa que colidiam para sempre (`d36c156`), confirmada no celular.
- Menu e painel Dados compactos no celular (`f55e289`).
- G1 latitude (`bcfba4b`), aprovado no celular.
- G2 ciclo de Wilson (`c0660ea`), testado no celular: "bem mais liso".
- Etiqueta "PRÉVIA" não cobre mais o fps do painel Dados (`4a11cf8`): some com o painel aberto.

## Pendente no M2
- [ ] Correções 1 e 2 (acima), depois de aprovadas.
- [ ] G3 — riftes traçados, junção tríplice, aulacógenos, microcontinentes, Pangeia nascendo soldada
  (geração v3), teste de formas aos 2, 5 e 10 min.
- [ ] Antes de fechar o Bloco G: medir de novo latitude e grupos soldados em N = 256; se subir para
  32 placas, medir no Hot 50i.
- [ ] Confirmar no celular: travamento em 92% e lagos retos (`docs/bugs.md`).
- [ ] T6 em diante (minerais, clima, desastres, avisos, teste longo).
- [ ] T7 inclui o que o usuário viu em 2026-10-16: terra em latitude alta sem gelo, polos
  simplificados demais, neve fraca (registrado na T7, não mexer antes).
- [ ] Fim do marco: medir de novo nas condições da linha de base da v1.1 (`docs/decisoes.md`).

## Últimas medições no celular (Infinix Hot 50i, `c0660ea5`)
- Metas: pausado ≥ 85 fps; tempo rodando ≥ 60; placas em deriva ≥ 30 (nunca < 20); geração ≤ 3 s.
- Pausado: 80 fps parado (**abaixo da meta**, antes 91; vigiar no próximo relatório), 91 girando.
- Tempo 20×, placas paradas: 91. Placas 100%: 82–85 (mín. 59). Deriva longa: 84. Ruptura forçada: 84.
- Geração: 2,7 s.
- Recomposição: 900–1.260 ms em média (placas 620–990 · clima ~170). Worker 192 passos/s em vez de
  240 (é o "tempo travando").

## Ressalvas conhecidas do G2
- O "supercontinente" é um aglomerado de continentes encostados, não uma massa compacta.
- Ainda não há junção tríplice (vem no G3).
- Nas sementes `mundo` e `42`, às vezes o supercontinente volta em ~2 min.

## Decisões abertas (do usuário)
- Os 4 itens de "Esperando decisão do usuário".
- **"Tamanho fixo" das placas:** hoje ficam fixas a identidade e a forma; placas oceânicas podem
  encolher até sumir (ver item 3). Falta confirmar se basta.

## Ideias registradas para marcos futuros (não fazer agora)
- M3: escala do planeta × tamanho dos humanos (sem humanos de 1 pixel; 3 opções em `docs/02-marcos.md`);
  base do feedback ambiental.
- M4: uso econômico dos minerais; desmatamento; cidade sobre terreno que muda.
- M5: quatro classes sociais; crônica permanente.
- M6/M7: doutrinas de guerra, recursos estratégicos, consequências ambientais da guerra.
- M8: acabamento visual do menu de ferramentas.
