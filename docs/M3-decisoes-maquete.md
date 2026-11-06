# Decisões visuais da maquete

Capturas numa janela de navegador de 1920×1080, reduzidas na folha, ao lado das referências. Sempre no mesmo lugar e com o mesmo mundo (semente `terra`). Para ver no jogo, acrescente à URL da prévia: `?relevo=`, `?pedras=`, `?oleo=`, `?aa=`.

GPU medida na entrada da maquete, build de desenvolvimento, sem janela, 1080p, numa rodada só: diferenças de menos de 0,5 ms ficam dentro da variação.

## 1. Relevo
![relevo](img/m3/dec-relevo.png)

| Opção | Encosta entre patamares | Terra à mostra | GPU |
|---|---|---|---:|
| **1 Terraços ligados (recomendo, já no jogo)** `terraco` | 1,3 célula de largura, inclinação ~0,5 | sim | 6,4 ms |
| 2 Rampas longas `rampa` | 5 células, inclinação ~0,12 | não | 6,6 ms |
| 3 Degrau alto `degrau` | 0,55 célula, inclinação ~1,1 | sim | 7,0 ms |
| 4 Encosta lisa `lisa` | sem patamar | não | 6,9 ms |

**Recomendo a 1:** é a mais próxima dos blocos 4 e 5 e ninguém fica preso, porque a inclinação cabe numa caminhada. As inclinações são conta, sem teste: ainda não há humanos andando (M4). Em todas, penhasco alto continua só na montanha e o deserto mantém os patamares largos.

## 2. Pedrinhas das jazidas
![pedras](img/m3/dec-pedras.png)

| Opção | O que é | GPU |
|---|---|---:|
| **1 Amontoados grandes (recomendo, já no jogo)** | 2 por célula, tamanho da folha | 6,4 ms |
| 2 Pedras miúdas `pedras=miudas` | 4 por célula, metade do tamanho | 6,6 ms |

**Recomendo a 1:** é a proporção de `recursos/jazidas.png` e dá para reconhecer o minério na entrada da maquete.

## 3. Petróleo aparente
![óleo](img/m3/dec-oleo.png)

| Opção | O que é | GPU |
|---|---|---:|
| **1 Poças pequenas (recomendo, já no jogo)** | até 1 poça em cada 3 células da mancha aparente | sem diferença medida |
| 2 Poça única grande `oleo=unica` | 1 em cada 8 células, o dobro do tamanho | sem diferença medida |

**Recomendo a 1:** a mancha lê como campo de petróleo sem abrir crateras no terreno. **Limite:** na semente `terra` só há mancha aparente dentro da taiga, por isso a poça aparece entre os pinheiros, com as árvores abrindo espaço. Em qualquer opção, a poça é só desenho: o globo e o mundo não mudam (`docs/M3-maquete.md`).

## 4. Suavização
Recorte aumentado 4×, para ver as bordas; em tamanho normal a diferença é bem menor.

![suavização](img/m3/dec-suavizacao.png)

| Opção | Entrada | De perto | Efeito |
|---|---:|---:|---|
| **FXAA (recomendo, já no jogo)** | 6,4 ms | 5,6 ms | Bordas lisas; interior das faces um pouco mais macio |
| MSAA 4× `aa=msaa4` | **12,0 ms** | **9,1 ms** | Bordas mais nítidas; **estoura a meta de 8 ms** |
| Sem suavização `aa=off` | 5,2 ms | 4,5 ms | Serrilhado visível |

**Recomendo FXAA.** O MSAA 4× só caberia baixando outra coisa, então fica fora, a não ser que você prefira assim.
