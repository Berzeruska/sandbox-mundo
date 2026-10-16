# Estado atual do projeto

Atualizado em: **2026-10-16**, commit de referência `c0660ea` (branch `marco-2`).
O Claude Code reescreve este arquivo ao fim de cada tarefa. Se outro documento disser outra coisa
sobre "onde estamos", vale este.

## Onde estamos
- **Marco:** M2 — Geologia viva (`docs/M2-especificacao.md`).
- **Bloco atual:** Bloco G (latitude, ciclo de Wilson, riftes).
- **Tarefa atual:** G2 — Ciclo de Wilson. **Feita e publicada na prévia; esperando o teste no celular.**
- **Próxima tarefa:** G3 — Riftes traçados e formas (só depois do teste do G2).
- **Prévia:** berzeruska.github.io/sandbox-mundo/previa/marco-2/ — a linha "versão" do painel Dados
  tem que mostrar o último commit do `marco-2` (`git log -1`). O jogo do G2 é o de `c0660ea`; os
  commits só de documentação depois dele não mudam o jogo. Versão mais antiga que `c0660ea` = a aba
  ou o app instalado não recarregou.
- **Publicado em `main`:** v1.1.

## Feito no M2
- T1 menu por categorias, T2 Web Worker, T3 placas, T4 movimento e controle "Placas",
  T5 fronteiras e relevo (critério de "bonito" passa em 5 sementes).
- Geração v2 (costas e bacias), aceita.
- Correção do travamento do celular em "Gerando mundo… 92%" (tela de erro, shader reserva,
  conferência de versão).
- D1–D5 desempenho: metas batidas no celular.
- Correção dos pedaços de placa que colidiam para sempre (`d36c156`), confirmada no celular.
- Menu e painel Dados compactos no celular (`f55e289`).
- G1 latitude (`bcfba4b`), aprovado no celular.
- G2 ciclo de Wilson (`c0660ea`): supercontinente se forma, dura ~2–2,5 min e racha pelas suturas;
  ciclo ~8,5 min nas sementes `terra` e `ilha`.

## Pendente no M2
- [ ] Teste do G2 no celular (o que olhar: linha "ciclo" no painel Dados; supercontinente se forma
  e racha; fps com "Medir desempenho", incluindo o cenário "ruptura forçada").
- [ ] G3 — riftes traçados, junção tríplice, aulacógenos, microcontinentes, Pangeia nascendo soldada
  (geração v3), teste de formas aos 2, 5 e 10 min.
- [ ] Antes de fechar o Bloco G: medir de novo latitude e grupos soldados em N = 256; se subir para
  32 placas, medir no Hot 50i.
- [ ] Confirmar no celular: travamento em 92% e lagos retos (`docs/bugs.md`).
- [ ] Avaliar as imagens de formas e a T5.
- [ ] T6 (minerais) e o resto da lista do M2: **congelados** até o Bloco G terminar.
- [ ] Fim do marco: medir de novo nas condições da linha de base da v1.1 (`docs/decisoes.md`).

## Últimas medições no celular (Infinix Hot 50i)
- Metas: pausado ≥ 85 fps; tempo rodando ≥ 60; placas em deriva ≥ 30 (nunca < 20); geração ≤ 3 s.
- Bloco D (relatório do aparelho): **91 fps pausado, 82 fps com tempo rodando, geração 2,7 s.**
- `d36c156` e G1 (`bcfba4b2`): todas as metas batidas.
- G2: **ainda não medido no celular.** No notebook a recomposição custa 261 ms (antes do G1: 239 ms);
  o celular decide.

## Ressalvas conhecidas do G2 (já contadas ao usuário)
- O "supercontinente" é um aglomerado de continentes encostados, não uma massa compacta; o ciclo
  fica sutil nos mapas.
- Ainda não há junção tríplice (vem no G3).
- Nas sementes `mundo` e `42`, às vezes o supercontinente volta em ~2 min (colisão logo após a ruptura).

## Decisões abertas (do usuário)
- **"Tamanho fixo" das placas:** ao pé da letra é impossível com placas rígidas (dorsais crescem,
  subducção encolhe). Hoje ficam fixas a identidade e a forma. Falta confirmar se basta.

## Ideias registradas para marcos futuros (não fazer agora)
- M3: escala do planeta × tamanho dos humanos (sem humanos de 1 pixel; 3 opções em `docs/02-marcos.md`);
  base do feedback ambiental.
- M4: uso econômico dos minerais; desmatamento; cidade sobre terreno que muda.
- M5: quatro classes sociais; crônica permanente.
- M6/M7: doutrinas de guerra, recursos estratégicos, consequências ambientais da guerra.
- M8: acabamento visual do menu de ferramentas.
