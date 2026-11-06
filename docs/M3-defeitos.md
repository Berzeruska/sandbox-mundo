# Defeitos do bloco "fazer a maquete funcionar"
Cada um reproduzido no Firefox 158 do notebook, em janela de 1920×1080, num compositor sem tela (nada aparece na tela do usuário), antes de corrigir.

## A1. Tranco no corte
**Reproduzido:** entrando na maquete pela primeira vez, a thread da tela travou 53 ms no primeiro quadro; antes dele, uma série de quadros de 28–34 ms. E, além do desempenho, a imagem saltava: o globo é visto de cima e a maquete entrava de repente inclinada.

**Causas e correção:**
- *Salto da imagem:* a inclinação agora acompanha a distância. No corte a maquete está quase vertical (como o globo) e vai inclinando conforme aproxima, e o caminho inverso vale para sair.
- *Primeiro desenho:* os programas só terminavam de compilar no primeiro desenho de verdade; agora eles desenham um triângulo cada um, atrás da tela de carregamento.
- *Modelos dos animais:* eram montados todos no primeiro quadro; agora um por quadro, antes do corte.
- *Subidas para a GPU:* cada pedaço subia as plantas de perto e de longe. Agora as de perto só vêm para os pedaços perto da câmera, e há um teto de 3 ms de subida por quadro.

**Medido depois:** 3 idas e voltas, nenhum bloqueio da thread da tela acima de 40 ms. **Limite:** ainda aparecem intervalos de 130–380 ms entre quadros, com a thread da tela livre. O mesmo tipo de intervalo aparece no Chromium nesse compositor sem tela e não no Chromium sem janela: atribuo ao compositor, sem prova definitiva. O teste do corte no Firefox do usuário decide.

## A2. Setas de aproximar e afastar param
**Reproduzido em parte:** depois de mexer num deslizante do menu (pincel, temperatura), ↑ e ↓ não fazem nada enquanto ele estiver com o foco. Corrigido: só caixa de texto fica com as setas. Também limpei a tecla presa ao trocar de tela cheia ou esconder a página, porque uma seta presa anula a outra.

**Não reproduzi** o defeito ligado só a entrar e sair da maquete: passei por seta, roda, pinça de toque, arrastar, menu, tecla segurada pelo corte e 20×, sem falhar. Em 20× ou Máx com placas o zoom trava de propósito (aviso "tempo geológico"). Se voltar a acontecer, o teste vai dizer em que sequência.

## A3. A pausa não para os animais
**Reproduzido e corrigido:** o tempo dos animais agora para com o relógio. Medido: rodando, a soma das posições mudou de 822,68 para 828,11 em 1 s; pausado, ficou em 828,141 por 2 s.

## A4. Animal sem cabeça em cima do gelo
**Causa:** cachalote e baleia nadam na superfície; no mar congelado o corpo aparecia entre as placas, e a frente do corpo não tinha tampa. **Corrigido:** nada de nadador em mar congelado, e o corpo fechado na frente.

## A5. Bolas brancas no rio
**Causa:** a espuma do pé das cachoeiras eram bolas paradas. **Corrigido:** lascas brancas achatadas na água, como em `bioma/agua.png`.

## A6. Mancha preta do terremoto
**Causa:** a cor quase preta da fenda do globo virava uma mancha em toda a célula. **Corrigido:** na maquete o chão fica com a cor do bioma, e a fenda é uma rachadura fina por cima. O chão queimado também deixou de ser quase preto.

## A7. Fumaça parada
**Corrigido:** a fumaça é desenhada a cada quadro: sai da cratera em erupção, sobe, cresce e some encolhendo.

## A8. GPU da transição do globo acima de 8 ms no Firefox
**Reproduzido o número, não o peso:** pelo método que o relatório usava no Firefox (esperar a GPU lendo 1 pixel), deu 8,1 ms a meia distância, pior 10,0, e no seu teste 10,4. Mas o Firefox tem o relógio de verdade da GPU, atrás de uma preferência. Comparando os dois no mesmo notebook e na mesma cena:

| Cena do globo | Por espera | Relógio da GPU |
|---|---:|---:|
| Longe | 4,9 ms | 2,5 ms |
| Longe, na transição | 5,9 ms | 2,5 ms |
| Meio | 7,3 ms | 5,3 ms (pior 7,5) |
| Meio, na transição | 6,9 ms | 5,0 ms (pior 5,5) |

**Conclusão:** o estouro vinha da medida por espera, que dá 2 a 3 ms a mais no Firefox. O desenho do globo não mudou. Falta o seu relatório com o relógio ligado para confirmar no seu Firefox.

**Como medir no Firefox (proposta):** o relatório agora usa o relógio da GPU quando há, e diz na linha da GPU qual método usou.
- **Preciso:** em `about:config`, ligar `webgl.enable-privileged-extensions`, uma vez. Essa preferência libera mais informação para as páginas, e pode ser desligada depois de medir.
- **Sem isso:** a medida por espera, avisando que dá 2 a 3 ms acima do real.
