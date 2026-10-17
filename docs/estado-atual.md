# Estado atual do projeto

Atualizado em: **2026-10-17**, branch `marco-2`. O jogo publicado na prévia é o da rodada de correções
depois do teste da vista de perto (último commit do `marco-2` com mudança no jogo).
O Claude Code reescreve este arquivo ao fim de cada tarefa. Se outro documento disser outra coisa
sobre "onde estamos", vale este.

## Onde estamos
- **Marco:** M2 — Geologia viva (`docs/M2-especificacao.md`).
- **Bloco atual:** Bloco G fechado (aprovado no celular em `0155233d`: "está bonito de perto", geração
  2,8 s, metas de fps batidas). **Agora:** bloco Minerais e clima (T6, T7). **Parado na T6:**
  decisões do usuário registradas (19 tipos, nascem também na deriva, províncias com poucas jazidas
  importantes, nome só ao tocar, petróleo escondido até cavar); **esperando aprovação da proposta do
  visual e do custo** e a escolha de como o toque no nome convive com o pincel. Tudo em
  `docs/M2-especificacao.md`, na T6. Nenhum código da T6 ainda.
- **Vista de perto aprovada no celular** (`751d6e39`): 61 fps girando, 46 (mín. 33) com placas;
  travadas 147 → 1. Metas novas de "de perto" registradas (≥ 60 parado/girando; ≥ 30, nunca < 20, com
  placas andando).
- **Remendo nas fronteiras de placa (de perto):** diagnosticado, correção esperando aprovação (muda o
  visual). Causas e proposta na especificação, "Teste no celular (2026-10-17, `751d6e39`)".
- **T6 aprovada** (visual e toque opção a): em andamento.
- **Limite novo:** a textura de cores guarda o bioma em 4 bits (16 biomas, o número de hoje). Bioma
  novo na T7 exige mudar isso (o teste avisa).
- **Planeta cubado:** o que sobra depois do alisamento (hexágonos perto dos 8 cantos, células
  desencontradas numa faixa de ~1 célula nas emendas, divisa reta curta ao longo da emenda perto do
  canto) está descrito na especificação ("O que ainda sobra") com a imagem
  `docs/img/m2-perto-restos.png`; o usuário julga no teste do fim do bloco, junto com o fps de perto.
- **Feito agora** (detalhes em "Teste da rodada no celular" na especificação):
  - Bug do Elevar que subia uma listra: era o "Girar (fps)" do painel Dados girando o globo por baixo
    do dedo; agora qualquer toque desliga o giro de teste.
  - Travadas "fora do jogo": o ajudante 2 criava ~117 MB de lixo por recomposição; agora ~20 MB
    (−83%), recomposição 24% mais rápida, mesmo mundo (teste de impressão digital novo). O registro
    mostra "recomposição há X s" e a causa virou "fora do código da tela (GPU, núcleo ocupado, limpeza
    de memória ou sistema)". Falta o celular dizer se as travadas sumiram.
  - Planeta "cubado" de perto: alisado só no desenho (costas e divisas curvas, sem dobra nas emendas).
    De perto ~40% mais pesado no notebook; falta medir no celular.
- **Acompanhar:** primeira abertura da página 5,0 s no celular (antes 4,6).
- **Decidido em 2026-10-16 (teste do Bloco G):** `42` é falha conhecida de latitude; critério de
  formas mantido; pedacinhos de terra no oceano depois de colisões são aceitáveis; polos, neve demais
  e biomas pouco variados vão para a T7; o Hot 50i continua aparelho-alvo até o fim do M2 (o usuário
  decide com o relatório).
- **Direção geral do usuário (2026-10-16):** o mundo real é a base, não uma cópia exata; o que precisar
  mudar para o jogo funcionar bem pode mudar, com o usuário decidindo o que tiver efeito de jogo.
- **Regra reforçada pelo usuário (2026-10-16):** mecanismo novo com efeito de jogo, mesmo para fazer
  um critério passar, é decisão de design: perguntar antes.
- **Método (regra do usuário, 2026-10-16):** teste por bloco. Sigo de tarefa em tarefa e só paro no
  fim do bloco, com prévia e lista numerada do que testar; paradas obrigatórias: decisão de design,
  teste de portão, meta de desempenho quebrada na estimativa. Blocos do M2: G (correção 2, G3, G4);
  minerais e clima (T6, T7); desastres (T8–T12); final (T13, T14).
- **Correção 1** (`9d5f101`) está na prévia; o teste dela entra na lista do fim do Bloco G.
- **Ordem aprovada:** correção 1 → correção 2 (ajudante 2) → G3 → G4 (continente amassa e vira
  montanha, especificação antes) → T6 em diante.
- **Direção do usuário (2026-10-16, corrigida por ele):** uma coisa por vez, bem feita, cada módulo
  respeitando o seu limite, sem virar bagunça. Não é "não mexer mais em placas": é não misturar.
  Fechar o G3 dentro do que já foi especificado e seguir a lista do marco. Melhoria nova (de placas ou
  de outro módulo) que não seja bug vai para os docs e entra na sua vez; reclamação fora do módulo atual:
  registrar e seguir na prioridade.
- **Prévia:** berzeruska.github.io/sandbox-mundo/previa/marco-2/ — a linha "versão" do painel Dados
  tem que mostrar o último commit do `marco-2` com mudança no jogo.
- **Publicado em `main`:** v1.1.

## Decidido em 2026-10-16
1. Correção 1 aprovada: fenda entre continentes com menos de 3 células nasce como vale de rifte.
2. Tempo travando: opção (b) completa, a recomposição vai para o ajudante 2 com memória compartilhada
   (SharedArrayBuffer); a opção (a), recomposição mais barata, vem depois. Primeiro: testar no celular
   se a memória compartilhada funciona; se não funcionar, perguntar antes de seguir com cópia. O "pior"
   do relatório passa a ser por cenário.
3. Plano de 3 ajudantes do M2 ao M7 e teto de 150 MB de RAM para os dados do jogo (Hot 50i com 4 GB),
   medido no fim de cada marco: `docs/01-arquitetura.md`.
4. Continente apagado na colisão vira G4 (amassar e virar montanha), especificação aprovada antes.
5. Registrados para depois: nuvens, tempestades e furacões em redemoinho na T10; humanos nômades com
   caça antes da agricultura no M4.

## Perguntas respondidas (2026-10-16)
- **Placas em zero liberam o ajudante 1?** Já liberam: sem deriva não há recomposição, e o ajudante 1
  só trabalha quando há passo a dar; o núcleo fica para a tela (placas paradas 91 fps contra 82–85 em
  100%). O plano não muda trabalho de ajudante conforme a velocidade das placas (o resultado
  dependeria do momento, quebrando o determinismo). Com o ajudante 2, nem em 100% as placas pesam no
  ajudante 1.
- **Pré-calcular geologia ao gerar o mundo?** O futuro das placas não (o pincel e a ruptura forçada
  mudam o rumo, e guardar estados futuros custa ~10 MB cada). Geometria e tabelas do clima já são
  pré-calculadas. O ganho real é "recalcular só o que mudou": hoje, depois de cada recomposição, o
  clima, a distância da água e as cores são refeitos no mundo inteiro, quando só a faixa das fronteiras
  e o que fica a favor do vento mudam. Isso entra na opção (a).

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
- G3, riftes traçados: fendas traçadas célula a célula (serpenteiam, degraus de falha transformante,
  junção tríplice, aulacógeno, terceiro braço, microcontinente, margem igual dos dois lados, rifte que
  abre como zíper); geração v3 (a Pangeia nasce soldada e se parte por riftes). Os testes de formas de
  `terra` e `mundo` voltaram a ser testes normais e passam. Geração ~+0,2 s no celular (estimativa
  ~2,9–3,0 s, no limite da meta).
- G4, colisão vira montanha: cordilheira e planalto na placa de cima, crátons com escarpa, oblíqua
  mais baixa e larga, picos e passagens, ombreira de rifte; erosão 0,5% e alisamento 3% (decisão do
  usuário). Altitudes aos 10 min no alvo do mundo real em 4 de 5 sementes.
- Correção 2, ajudante 2 "Terra": memória compartilhada "sim" no Hot 50i; recomposição, clima e cores
  em outro worker, aparecendo 480 passos depois; "pior" do relatório por cenário; "relógio esperou".
- Correção 1, vale de rifte: fenda entre continentes nasce como vale; com 3 células de largura o meio
  vira mar; rifte parado fica como vale em terra (aulacógeno, opção 1 do usuário).

## Pendente no M2
- [ ] T7: vale de rifte entre montanhas com neve (`docs/bugs.md`); nem toda montanha com neve; erosão
  pelo clima (lado chuvoso vira escarpa, planalto seco sobrevive).
- [ ] Travadas: confirmar no celular se caíram com menos lixo de memória no ajudante 2; se não, ver
  "recomposição há X s" (GPU ou disputa de núcleos).
- [ ] Medir no celular "de perto, girando" e "idem, de perto" (cenários novos do "Medir desempenho")
  depois da correção; julgar o que sobra do cubo no teste do fim do bloco Minerais e clima.
- [ ] **Falha conhecida:** semente `42` com 33% da terra acima de 60° em N = 256 aos 10 min.
- [ ] **Falha conhecida:** semente `7` com 0,44% da terra acima de 4.000 m aos 10 min (alvo 0,5%).
- [ ] **Falha conhecida:** 8 de 20 sementes fora do critério de formas aos 3 min (colisões e soldas logo
  depois da quebra). Os testes de CI (`terra`, `mundo`, `7`) passam.
- [ ] Opção (a), recomposição mais barata e clima só onde mudou (complemento da correção 2).
- [ ] Confirmar no celular: travamento em 92% e lagos retos (`docs/bugs.md`).
- [ ] T6 em diante (minerais, clima, desastres, avisos, teste longo).
- [ ] T7 inclui o que o usuário viu em 2026-10-16: terra em latitude alta sem gelo, polos
  simplificados demais, neve fraca (registrado na T7, não mexer antes).
- [ ] Fim do marco: medir de novo nas condições da linha de base da v1.1 (`docs/decisoes.md`).

## Últimas medições no celular (Infinix Hot 50i)
- Metas: pausado ≥ 85 fps; tempo rodando ≥ 60; placas em deriva ≥ 30 (nunca < 20); geração ≤ 3 s.
- `0155233d` (rodada depois do Bloco G, relatado pelo usuário): geração **2,8 s** (meta 3 s); metas de
  fps batidas; primeira abertura 5,0 s (antes 4,6); travadas 147 da tela e 11 da data, todas de
  110–130 ms, com placas 100% a 20× (tratado na rodada seguinte, falta medir).
- `f18969a2` (fim do Bloco G, relatado pelo usuário): geração **3,9 s (acima da meta; corrigido na
  rodada seguinte, falta medir)**; pausado parado 81 (a tela não desenha nada nesse cenário; a meta
  agora vale para "pausado, girando"); "relógio esperou 0 ms", mas o usuário viu a imagem engasgar e a
  data pular de 20 em 20 anos com placas 100% a 20×.
- `c0660ea5`:
- Pausado: 80 fps parado (**abaixo da meta**, antes 91; vigiar no próximo relatório), 91 girando.
- Tempo 20×, placas paradas: 91. Placas 100%: 82–85 (mín. 59). Deriva longa: 84. Ruptura forçada: 84.
- Geração: 2,7 s.
- Recomposição: 900–1.260 ms em média (placas 620–990 · clima ~170). Worker 192 passos/s em vez de
  240 (é o "tempo travando").

## Ressalvas conhecidas (G2/G3)
- O "supercontinente" é um aglomerado de continentes encostados, não uma massa compacta.
- Nas sementes `mundo` e `42`, às vezes o supercontinente volta em ~2 min; em geral, quando o critério
  de formas falha, é porque dois continentes colidiram e se soldaram logo depois da quebra (12 de 20
  sementes passam aos 3 min).

## Decisões abertas (do usuário)
- **"Tamanho fixo" das placas:** hoje ficam fixas a identidade e a forma; placas oceânicas podem
  encolher até sumir. O G4 trata só do continente apagado. Falta confirmar se basta.

## Ideias registradas para marcos futuros (não fazer agora)
- M3: escala do planeta × tamanho dos humanos (sem humanos de 1 pixel; 3 opções em `docs/02-marcos.md`);
  base do feedback ambiental.
- M3, M4 e M8: zoom maior que o de hoje, para caberem humanos pequenos (montanha de 50 pixels com homem
  de 5 fica estranho).
- T10 (neste marco): nuvens translúcidas que somem ao aproximar; tempestades e furacões em redemoinho
  alterando só o clima da região.
- M4: humanos começam nômades, com caça, antes da agricultura; uso econômico dos minerais; desmatamento; cidade sobre terreno que muda.
- M5: quatro classes sociais; crônica permanente.
- M6/M7: doutrinas de guerra, recursos estratégicos, consequências ambientais da guerra.
- M8: acabamento visual do menu de ferramentas; formações de erosão vistas de perto (pilares de
  arenito, "braços" de pedra).
