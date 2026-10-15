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
