# Bugs

Formato: data — como reproduzir — causa — correção — commit.

## 2026-10-15 — Lagos e costas com bordas retas, cantos de 90° e formas em V (celular)

- **Como reproduzir:** no celular do usuário, usar Rebaixar com pincel 29 (perto das bordas entre
  faces do cubo fica mais evidente). Surgem lagos/costas com bordas perfeitamente retas, cantos em
  90° e, perto de um canto do cubo, formas em V.
- **Investigação (descartado):**
  - Emenda na geração/clima: diferença média de elevação entre vizinhos dentro da face 42 m vs.
    entre faces 49 m; troca de bioma 2,8% vs. 2,3%. Sem emenda.
  - Pincel cortado na borda ou quadrado: pincel 29 sobre a borda das faces 0/4 mudou exatamente as
    3.344 células do círculo (faces 0 e 4), e sobre o canto as 3.264 (faces 0, 2 e 4), nenhuma fora
    do raio. Os **dados** sempre estiveram certos; o pincel já era um círculo na esfera.
- **Causa:** no desenho. Depois de cada pincelada, só um retângulo por face era reenviado à GPU,
  lido direto do array completo com `UNPACK_ROW_LENGTH` + `UNPACK_SKIP_PIXELS/ROWS` +
  `UNPACK_IMAGE_HEIGHT`. Alguns drivers de celular tratam esses parâmetros errado em texturas 3D:
  o retângulo recebe pixels de outro lugar da face, gerando bordas retas e cantos de 90°; onde os
  retângulos de três faces se encontram, num canto do cubo, aparece o V. Simulando um driver que
  ignora os parâmetros de "pular", o defeito descrito é reproduzido exatamente.
- **Correção:** o retângulo é copiado para um bloco contínuo (`packRect` em `src/render/dirty.ts`)
  e enviado sem nenhum parâmetro de desempacotamento especial. Com o mesmo driver defeituoso
  simulado, o desenho fica idêntico, pixel a pixel, ao correto. Testes novos: pincel sobre borda e
  sobre canto do cubo afeta as faces vizinhas e exatamente o círculo; `packRect` copia o retângulo
  certo.
- **Imagem:** `docs/img/bug-2026-10-15-antes-depois.png` (esquerda: antes; direita: depois).
- **Pendente:** confirmar no celular do usuário, pelo link publicado.

## 2026-10-15 — Celular trava em "Gerando mundo… 92–96% (cores)" para sempre

- **Como reproduzir:** abrir a prévia do marco-2 no celular do usuário. A barra para em 92–96%
  ("cores"), o relógio continua andando e o mundo nunca aparece. No notebook funciona.
- **Análise:** 92% é exatamente a soma das etapas antes de "cores", a última da geração. O relógio
  andando prova que o worker estava vivo. Então algo lançou uma exceção **em silêncio** logo no fim:
  no worker, depois da etapa "cores", ou na tela, ao receber o mundo (criação do desenho e
  compilação do shader). Ninguém escondia o "carregando" quando dava erro, então a espera nunca
  terminava.
- **Hipóteses:**
  1. *Cache do service worker misturando versões:* improvável, porque os arquivos do worker e da
     página têm hash no nome e uma página sempre carrega o próprio worker. Mesmo assim, agora a
     tela e o worker conferem a versão um do outro.
  2. *Shader novo (interpolação das placas) falhando na GPU do celular:* é a principal suspeita,
     porque o shader estreou nesta versão e é o que roda ao receber o mundo. Limites de recurso
     foram descartados por medição: o shader usa 93 vetores de uniforms (o mínimo garantido em
     celular é 224) e 5 texturas (mínimo 16). Ele compila na GPU do notebook e no SwiftShader (GPU
     por software, com limites mínimos). Sobram defeitos de compilador de driver de celular:
     vetores locais com índice dinâmico e laços com `break`, que o shader usava.
  3. *Worker sem memória:* possível; agora apareceria na tela como erro.
- **Correção:**
  - Shader reescrito sem vetores locais nem laços (candidatas e sondas desenroladas).
  - Se o shader completo falhar, o desenho cai sozinho num shader **simplificado** (sem
    interpolação: as placas andam aos saltos de 2 células, mas o jogo abre). O painel de depuração
    mostra "desenho: completo" ou "simplificado (motivo)", com o texto do erro do driver.
  - Nunca mais espera infinita: erro no worker, no shader ou em qualquer parte da tela abre uma tela
    "Algo deu errado" com o texto do erro (pode ser selecionado e copiado), a versão e o aparelho,
    e um botão "Tentar de novo" (limpa o cache do jogo e recarrega). Um vigia mostra a mesma tela se
    a geração passar 20 s sem dar notícia.
  - Protocolo com aperto de mão: o worker manda a versão dele; se não for a da tela, a página limpa
    o cache e recarrega sozinha uma vez (no máximo uma vez por minuto, para não entrar em laço) e,
    se persistir, mostra o erro.
- **Verificado no navegador:** GPU real e SwiftShader abrem com desenho completo; compilação do
  shader de placas forçada a falhar cai no simplificado e o jogo abre; os dois shaders falhando
  mostram a tela de erro; erro forçado no worker mostra o texto e a pilha; worker mudo mostra o erro
  do vigia em 20 s; versão diferente recarrega uma vez e depois mostra o erro; o botão recarrega.
  Movimento suave sem regressão (0 saltos, máximo 0,45% dos pixels por quadro).
- **Pendente:** confirmar no celular do usuário. Se ainda falhar, o texto da tela de erro (ou o
  "desenho: simplificado (motivo)") diz a causa exata.
