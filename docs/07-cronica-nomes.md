# 07 — Crônica do mundo e nomes

## Crônica
- Registro permanente de eventos importantes, cada um com: ano, tipo, lugar, envolvidos e uma linha
  de resumo montada por frases-modelo (templates), sem IA externa.
- Exemplos: fundação de cidade, mudança de regime, guerra declarada, paz, batalha decisiva,
  revolução, golpe, desastre grande, extinção, último indivíduo, nascimento e morte de líder.
- **Consultável como dicionário:** busca por nome, filtro por ano, civilização, tipo e região.
- Tocar num evento leva a câmera até o lugar onde ele aconteceu.
- Limite de tamanho: eventos menores entram em resumos por década para não inchar a memória.

## Nomes de cidades
- Base: listas de nomes de cidades antigas reais por tradição cultural (ex.: romana, grega,
  mesopotâmica, egípcia, fenícia, persa, céltica, nórdica, chinesa antiga, mesoamericana).
- Cada civilização recebe uma tradição na fundação e usa nomes dela.
- Quando a lista esgota, gerar nomes novos com as sílabas típicas daquela tradição.
- As listas ficam em arquivos de dados em `src/data/names/`, editáveis pelo usuário.

## Nomes de pessoas e países
- Mesmo método: tradição cultural → lista + gerador por sílabas.
- Países nomeados pela capital, pelo povo ou pelo regime (ex.: "Reino de X", "República de X").
