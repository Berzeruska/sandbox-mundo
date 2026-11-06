# Maquete dentro do jogo (T2 e T3)

## Como funciona
- **Passagem:** a 18 px por célula grande os pedaços começam a carregar, ainda com o globo na tela. A 32 px a vista crava na maquete do mesmo lugar, com o mesmo "para cima" da tela. Globo e maquete nunca aparecem juntos. Afastando além do limite, ou se o tempo geológico travar o zoom, volta ao globo.
- **Comandos:** a câmera é uma só (`src/render/view-camera.ts`). Na maquete, ↑/↓, roda e pinça aproximam, ←/→ giram e arrastar anda. Toque, pincéis, desastres e animações usam o mesmo ponto do planeta das duas vistas.
- **Pedaços:** 32×32 células finas (4 por célula grande), montados num ajudante próprio (`src/maquete/worker.ts`) a partir de uma cópia do chão. Com o relógio andando, a cópia é refeita 1 vez por segundo e só os pedaços com células mudadas são refeitos.
- **Aresta do cubo:** cada pedaço é montado nas coordenadas da própria face. Um mapa plano (`src/maquete/chart.ts`) abre as faces vizinhas em volta da face central, giradas de 90° em 90°. Trocar de face central não refaz nenhum pedaço.
- **Canto do cubo:** nos 8 cantos só 3 faces se encontram e sobra um quadrante vazio. Ele é preenchido em leque, copiando a aresta. **Limite:** nesse quadrante o relevo forma anéis.
- **Borda:** os lados sem vizinho carregado mostram as camadas de terra. O que está na vista é sempre carregado, então a borda só aparece de relance, enquanto os pedaços chegam.

## O globo achatado
**Causa:** só no protótipo apagado, que media a tela uma vez, ao abrir. Em tela cheia a imagem interna ficava em 1854×961, esticada para 1920×1080. **Reproduzido** numa janela real antes de apagar.

**O jogo não tem esse defeito:** ele mede a tela a cada quadro. Conferido em janelas reais (largura ÷ altura do globo, medidas na imagem):

| Janela | Razão |
|---|---:|
| 1920×1080, tela cheia | 1,000 |
| 1390×699 | 0,998 |
| 880×790 | 1,024 |
| 1480×490 | 1,000 |

Os 2,4% da janela 880×790 são o traçado do litoral e das nuvens na medida automática, que varre a imagem a partir do centro; a conta do desenho é a mesma nas quatro.

## Conferido em janela real de 1920×1080
Pinça entra na maquete; ← gira; arrastar anda; o menu abre (com o véu escuro de sempre do M2); desastre e toque caem no ponto certo e o fogo aparece; atravessei da face 4 para a 0 sem salto; ↓ volta ao globo. Nenhum erro no console.

## Capturas
Toda captura sai de um navegador em janela, com a GPU do notebook, num compositor sem tela (`gnome-shell --headless`): é janela de verdade e não aparece na tela do usuário.

## Plantas por bioma (T4)
As 19 espécies das folhas em `plantas/`, nos estados muda, adulta, seca e queimada (`src/maquete/plants.ts`), com as correções do `LEIAME.md`. A página `prototipo/folhas.html` mostra todas no motor. Em cada espécie, da esquerda para a direita: muda, adulta, seca e queimada.

![plantas](img/m3/plantas.png)

Cada bioma tem as próprias espécies, com matas agrupadas. Taiga muito fria usa o pinheiro com neve. No mundo, cerca de 12% das plantas são mudas e 2% estão secas. Onde a vegetação volta depois de um desastre, nascem mudas.

**O fogo do M2 deixa as árvores queimadas:** a célula em chamas, queimada ou com cinza usa o modelo queimado. A cópia do mundo chega a cada segundo e só os pedaços mudados são refeitos.

![fogo](img/m3/fogo-maquete.png)

## Água, relevo e vulcões (T5)
![água e relevo](img/m3/agua-relevo.png)

- **Rios e lagos (`src/maquete/rivers.ts`):** só para o desenho; a simulação não sabe deles. As bacias enchem a partir do mar, a chuva de cada bioma desce e o que junta água bastante vira rio. Bacia funda vira lago. Os rios são refeitos quando o relevo muda.
- **Cachoeira:** degrau no nível da água, com espuma no pé. **Costa:** areia com contorno nítido, só perto do mar e dos rios.
- **Mar congelado:** água clara com placas de gelo. **Deserto:** patamares muito mais largos, com dunas facetadas de vez em quando.
- **Montanhas:** picos separados, da altura que o mundo tem ali, com chapéu de neve. **Vulcões:** os do M2, com cratera. Em erupção, lava na cratera e nos canais, e fumaça em cubos.

**Limite:** o nível dos rios sobe e desce em patamares; os rios não passam acima de 1.900 m.

## Jazidas e petróleo (T6)
![jazidas](img/m3/jazidas.png)

As 19 jazidas de `recursos/jazidas.png`, como amontoados de pedras facetadas com veios, cristais ou cubos (`src/maquete/deposits.ts`). Rótulos desta folha em inglês: são os nomes usados no código. **Petróleo misto:** cerca de 30% das manchas de petróleo afloram na maquete como poça preta e brilhante, com borda de terra; o resto segue invisível até cavar. **Limite:** isso é só desenho, para o globo do M2 e o mundo não mudarem. Tocar na poça ainda não diz "petróleo"; o jogo só conta como revelado o que foi cavado. O M4 decide o uso.

## Animais (T7)
![animais](img/m3/animais.png)

As 26 espécies aprovadas, nos biomas certos, com 5 poses (parado, 2 quadros de andar, comendo, morto), em `src/maquete/animals.ts`. Andam ao acaso e não saem do pedaço onde nasceram (`src/render/maquete-animals.ts`). Cerca de 2,5% aparecem deitados, só para a pose existir. Sem fome, caça, nascimento ou morte de verdade: isso vem com a especificação do M3. Kraken, baleia branca e dragão são da classe mítica e não aparecem sozinhos.

**O que difere das folhas:** os corpos são mais simples, as listras da zebra e as pintas da onça saem por faceta, sem o desenho fino. A água é opaca: os animais do mar aparecem só com a parte que passa da superfície, por isso a lula e o cardume quase não se veem.
