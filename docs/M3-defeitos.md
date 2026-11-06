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
