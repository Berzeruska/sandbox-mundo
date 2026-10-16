# CLAUDE.md — instruções para o Claude Code neste repositório

Este arquivo é lido automaticamente pelo Claude Code ao abrir a pasta.
Ele governa COMO trabalhar. O QUE construir está em `docs/`.

## Idioma
- Conversa com o usuário, commits, comentários de alto nível e documentação: **português do Brasil**.
- Nomes no código (variáveis, funções, arquivos): inglês curto e consistente.

## Quem é o usuário neste projeto
- Dionatan é o designer e o testador. Ele joga, relata e decide o design.
- Ele está aprendendo programação com o projeto. Ao terminar cada tarefa, explique em 3–5 linhas
  o que foi feito e por que, sem jargão desnecessário.
- Ele testa no celular e no notebook. Toda mudança precisa funcionar nos dois.

## Ordem de leitura antes de qualquer trabalho
0. `docs/estado-atual.md` — onde paramos, o que está pendente.
1. `docs/02-marcos.md` — em qual marco estamos e o que falta.
2. A especificação do marco atual (ex.: `docs/M1-especificacao.md`).
3. `docs/01-arquitetura.md` — regras técnicas.
4. `docs/decisoes.md` — decisões já tomadas. Não as reverta sem perguntar.
5. Os documentos de sistema relevantes à tarefa.

## Regras de trabalho
1. **Um marco por vez.** Não implemente nada de marcos futuros, nem "já deixando pronto".
   Se uma tarefa exigir isso, pare e pergunte.
2. **Uma tarefa por vez**, na ordem da especificação do marco. Cada tarefa termina com:
   - `npm run check` passando (tipos + lint + testes);
   - o jogo abrindo sem erro no console (`npm run dev`);
   - commit próprio;
   - a caixa da tarefa marcada em `docs/02-marcos.md` ou na especificação do marco.
3. **Testes para lógica pura.** Toda função de simulação, geração ou geometria ganha teste no Vitest.
   Renderização e entrada (toque/mouse) são verificadas manualmente e descritas no relato da tarefa.
4. **Determinismo.** Toda aleatoriedade passa pelo gerador com semente (`src/core/rng.ts`).
   Mesma semente = mesmo mundo. Nunca use `Math.random()` na simulação.
5. **Simulação separada da renderização.** A simulação nunca toca no DOM, no canvas ou no WebGL.
   A renderização só lê o estado.
6. **Orçamento de celular.** Aparelho-alvo: **Infinix Hot 50i** (Helio G81, só 2 núcleos fortes A75
   + 6 A55, GPU Mali-G52 MP2, tela 720p 120 Hz). Otimize pensando nele; não há opção de qualidade:
   o jogo inteiro tem que rodar bem nele. Metas no aparelho: pausado ≥ 85 fps, tempo rodando
   ≥ 60, placas em deriva ≥ 30 (nunca abaixo de 20), geração ≤ 3 s; notebook 60 fps. Estime com CPU
   desacelerada 6× antes de pedir medição; o relatório "Medir desempenho" do aparelho é a verdade.
   Se uma mudança derrubar isso, conserte antes de seguir.
7. **Sem dependência nova sem justificativa.** Antes de instalar um pacote, diga qual, por que e o
   tamanho aproximado. Registre em `docs/decisoes.md`.
8. **Nada do WorldBox.** Não copie, descompile nem reproduza código, sprites, sons ou nomes de
   mecânicas proprietárias. A ideia de "sandbox de deus" é livre; o conteúdo é nosso.
9. **Dúvida de design é do usuário.** Se a especificação não decide algo que muda a experiência de
   jogo, pergunte em uma frase com opções. Se for detalhe técnico, decida, registre e siga.
10. **Nunca diga que está pronto sem ter rodado.** "Deve funcionar" não é relato.
11. **Quando parar para o usuário testar** (regra do usuário, 2026-10-15): tarefas sem mudança que
    ele veja ou sinta no jogo (infraestrutura, refatoração, testes, documentação) seguem direto para
    a próxima, sem parar para aprovação, mas sempre com commit e relato. Pare e peça teste só quando
    houver algo visível ou sentido no jogo, ou uma decisão de design. Ao parar, publique a prévia do
    branch (`/previa/<branch>/`) e passe o link.
12. **Nenhum teste depende do relógio real** (regra do usuário): lógica com tempo vira função pura
    com tempos sintéticos. Medições de desempenho não são testes de aprovação.
13. **Desempenho a cada marco** (regra do usuário): ao fim de cada marco, medir de novo nas condições
    da linha de base da v1.1 (`docs/decisoes.md`) e comparar; o relatório do aparelho-alvo decide.

## Git e GitHub
- Branch `main` sempre jogável. Trabalho de cada marco em `marco-N` (ex.: `marco-1`).
- Mensagens de commit em português, no formato `tipo(área): descrição`.
  Tipos: `feat`, `fix`, `docs`, `test`, `perf`, `refactor`, `chore`.
  Ex.: `feat(globo): zoom por pinça no celular`.
- Ao concluir o marco: atualizar `CHANGELOG.md`, abrir PR de `marco-N` para `main`, e após o merge
  criar a tag `vN.0` (ex.: `v1.0`).
- O GitHub Actions roda `npm run check` em todo push e publica `main` no GitHub Pages.
- Nunca use `git push --force` em `main`. Nunca apague histórico.

## Documentação viva
- **Ao fim de cada tarefa, reescreva `docs/estado-atual.md`** (marco e tarefa atuais, feito, pendente,
  últimas medições do celular, decisões abertas, ideias para marcos futuros) no mesmo commit.
  O usuário sobe esse arquivo num Project do Claude que o orienta; se ele envelhecer, o orientador
  responde com informação velha.
- Mudou comportamento? Atualize o documento de sistema correspondente no mesmo commit.
- Decisão técnica relevante? Nova entrada em `docs/decisoes.md` (data, decisão, motivo, alternativa descartada).
- Bug encontrado pelo usuário? Registre em `docs/bugs.md` com: como reproduzir, causa, correção.

## Comandos
- `npm run dev` — servidor local (acessível pelo celular na mesma rede: use `--host`).
- `npm run check` — tipos + lint + testes. Obrigatório antes de commit.
- `npm run build` — build de produção.
- `npm test` — só os testes.
