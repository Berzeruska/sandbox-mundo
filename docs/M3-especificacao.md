# M3 — Especificação da ecologia (RASCUNHO para aprovação do usuário)

**Estado:** rascunho de 2026-11-06. Nada desta simulação tem código. Hoje as plantas e os animais são desenho (`docs/M3-maquete.md`). Base: `docs/04-ecologia.md`. As perguntas em aberto estão marcadas com **[decidir]**; decisões visuais vêm com 4 a 6 opções e imagem antes do código (regra 14).

## 1. Objetivo
Equilíbrio dinâmico: populações sobem e descem em ciclos e raramente zeram. O jogador vê a vida reagir a clima, desastres e aos poderes dele. Critério de aceite no item 8.

## 2. Modelo: de longe números, de perto indivíduos
- **Mundo todo:** por célula grande (n = 256), números guardados no ajudante 1, que é o relógio: biomassa vegetal e população de cada espécie presente. Só nas células de terra e mar com vida; custo a medir na tarefa E1.
- **Perto da câmera:** os números viram indivíduos só na maquete, como já acontece com o desenho. O indivíduo mostra a população da célula: nascer, comer e morrer aparecem nele, mas quem manda são os números. Sair de perto devolve o indivíduo ao número.
- **Determinismo (regra 4):** os números andam no relógio, com sorteio por semente. Os indivíduos só no desenho não alteram o mundo, a não ser nos poderes do jogador, registrados como comando.
- **Alternativa descartada:** simular cada indivíduo do planeta, porque não cabe em 8 ms nem na CPU, com 26 espécies em 118 mil células de terra.

## 3. Plantas simuladas
- Cada célula já guarda a vegetação em porcentagem (M2). O M3 acrescenta **capacidade** por bioma, clima e solo, e **crescimento logístico** em direção a ela.
- **Espécies e estados** (`src/maquete/plants.ts`): a fração de muda, adulta, seca e queimada de cada célula sai da cobertura e do histórico: fogo e seca deixam queimada ou seca; a volta começa em mudas. A maquete deixa de sortear e lê essa fração.
- **Sucessão:** depois do fogo, primeiro capim e arbusto, depois as árvores. Velocidade por bioma, com a mesma recuperação de hoje como base.
- **Efeito no clima:** floresta grande aumenta a chuva da região (feedback já registrado). **[decidir]** se entra agora, com custo a medir, ou no ajuste depois do marco.

## 4. Animais simulados
Tabela inicial, para ajustar medindo. Grupo é o tamanho típico; dieta define quem come quem.

| Espécie | Biomas | Dieta | Grupo | Domesticável (M4) | Temperamento |
|---|---|---|---|---|---|
| Rena | Tundra, taiga | Plantas | 3–8 | Sim | Arisco |
| Lobo-ártico | Tundra, gelo | Rena, lebre | 2–5 | Sim | Caçador |
| Lebre | Tundra, taiga | Plantas | 1–3 | Não | Arisco |
| Cervo | Floresta, campo | Plantas | 2–6 | Não | Arisco |
| Alce | Taiga, floresta | Plantas | 1–2 | Não | Bravo |
| Javali | Floresta, tropical | Onívoro | 2–6 | Sim | Bravo |
| Lobo | Taiga, floresta | Cervo, lebre, javali | 3–6 | Sim | Caçador |
| Urso | Taiga, floresta | Onívoro | 1 | Não | Bravo |
| Bisão | Campo, estepe | Plantas | 4–12 | Sim | Bravo |
| Antílope | Savana, campo, estepe | Plantas | 4–12 | Não | Arisco |
| Zebra | Savana | Plantas | 4–10 | Não | Arisco |
| Elefante | Savana | Plantas | 2–6 | Sim | Bravo |
| Leão | Savana | Zebra, antílope | 2–6 | Não | Caçador |
| Capivara | Pântano, tropical | Plantas | 3–8 | Não | Manso |
| Macaco | Tropical | Onívoro | 3–10 | Não | Arisco |
| Onça | Tropical | Capivara, macaco, javali | 1 | Não | Caçador |
| Jacaré | Pântano | Capivara, peixes | 1–3 | Não | Caçador |
| Camelo | Desertos | Plantas | 2–5 | Sim | Manso |
| Cabra-montesa | Montanha | Plantas | 2–6 | Sim | Arisco |
| Águia | Montanha | Lebre, peixes | 1 | Sim | Caçador |
| Cardume | Mar | Plâncton (fundo fixo) | Muitos | Não | Arisco |
| Baleia | Mar fundo | Plâncton | 1–3 | Não | Manso |
| Cachalote | Mar fundo | Lula, lula-gigante | 1–3 | Não | Bravo |
| Tubarão | Mar | Cardume | 1–2 | Não | Caçador |
| Lula | Mar | Cardume | 2–6 | Não | Arisco |
| Lula-gigante | Mar fundo | Cardume | 1 | Não | Bravo |

**Mecanismos** (`docs/04-ecologia.md`): capacidade por bioma; crescimento logístico; predador e presa com saturação, para oscilar sem extinguir; nichos de bioma e temperatura; migração para a célula vizinha com fome; refúgio, uma pequena fração que o predador não alcança.

**Desastres:** fogo mata e espanta; seca reduz a capacidade em até 30%; enchente e tsunami matam quem está na água; terremoto mata no ponto de início; furacão arrasta; meteoro e vulcão apagam a área. **Extremos de temperatura (P9):** era glacial e deserto vermelho mudam capacidade e nichos.

**Avisos:** espécie em risco, último indivíduo com botão para ir até ele, extinção registrada para a crônica.

## 5. Poderes de deus sobre as criaturas
Matar, mudar características e acompanhar com a câmera, mais pôr criaturas no mundo. **[decidir]** com 4 a 6 opções e imagem de interface:
1. Como escolher: tocar no animal ou num pincel de área.
2. Quais características mudam: tamanho, fome, agressividade, velocidade, fertilidade.
3. Se a mudança passa para os filhotes.
4. Se acompanhar com a câmera trava o zoom e a velocidade.

## 6. Classe mítica
Dragão, kraken e baleia branca colossal. **Só deus os põe no mundo; nenhum nasce sozinho.** São indivíduos simulados de verdade, poucos, sempre no mapa, e não entram nos números. **[decidir]**, com opções:
1. Fome e caça: o que comem e com que estrago.
2. Território: fixo ou andando pelo mundo.
3. Reprodução: nenhuma, ou só com outro posto por deus.
4. Morte: se envelhecem ou só morrem por poder e desastre.

As folhas `animais/dragao.png` e `animais/miticos.png` já dão forma e poses; o modelo entra com a simulação.

## 7. Sangue e morte
Sangue leve, de diorama. **[decidir]** com imagens: tamanho, quanto tempo dura, e se há pedaços. Hoje a pose "morto" é só desenho, em 2,5% dos animais; isso sai quando a morte for simulada.

## 8. Teste automático de aceite
1.000 anos simulados, sem desenho, com sementes fixas (nenhum teste depende do relógio real, regra 12):
- nenhuma extinção em massa: **proposta**, menos de 20% das espécies em menos de 100 anos, sem desastre gigante;
- populações não ficam paradas: variância mínima ao longo do tempo;
- ciclos entre predador e presa aparecem em pelo menos 3 pares;
- mesmo resultado com a mesma semente.

Os limiares são propostas e ficam em `docs/decisoes.md` depois de medir.

## 9. Desempenho
Mesmas metas do jogo. O "Medir desempenho" ganha um cenário com populações cheias, em "Muitos" e 20×. Teto proposto para os dados novos: 60 MB. Se o relógio passar de 1 ms por passo, os números de cada espécie andam em turnos, uma parte do mundo a cada passo.

## 10. Tarefas propostas, na ordem
- **E1.** Biomassa e capacidade nas células; ler na maquete. Medir memória e tempo.
- **E2.** Populações em números, sem predador; teste de crescimento.
- **E3.** Predador e presa, migração e refúgio; teste de 1.000 anos.
- **E4.** Desastres matando e espantando; avisos.
- **E5.** Indivíduos da maquete lendo os números; comer, fugir, caçar e morrer.
- **E6.** Poderes de deus, depois da decisão do item 5.
- **E7.** Classe mítica, depois da decisão do item 6.
- **E8.** Sangue e morte, depois da decisão do item 7.
- **E9.** Extremos de temperatura e feedback ambiental.
- **E10.** Fechamento do marco: medição, CHANGELOG, PR para o `main`.

## Fora deste marco
Humanos e domesticação em uso (M4). Guerra e bombas (M7). A troca da textura do globo fica adiada, sem data (decisão de 2026-11-06).
