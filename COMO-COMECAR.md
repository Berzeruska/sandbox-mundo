# Como começar (para o Dionatan)

## Uma vez só
1. Coloque esta pasta onde quiser no notebook (ex.: `Documentos/sandbox-mundo`).
2. Tenha instalados: **Node.js** (versão LTS), **Git** e o **GitHub CLI** (`gh`).
   Se faltar algum, o próprio Claude Code te guia na instalação.
3. Faça login no GitHub pelo terminal: `gh auth login`.
4. Abra o terminal dentro da pasta e rode: `claude`

## Primeira mensagem para o Claude Code (copie e cole)
> Leia o CLAUDE.md e todos os arquivos de docs/. Depois execute o Marco 0 inteiro:
> configure o projeto, crie o repositório público "sandbox-mundo" no meu GitHub com o gh,
> faça o primeiro push, configure o GitHub Actions com check e deploy no GitHub Pages,
> e me passe o link publicado. Marque as caixas concluídas em docs/02-marcos.md.

## Depois do Marco 0
> Comece o Marco 1 pela tarefa T1, seguindo docs/M1-especificacao.md. Uma tarefa por vez,
> commit a cada tarefa, e me explique cada uma em poucas linhas.

## Como testar no celular
- Pelo link do GitHub Pages (atualiza sozinho a cada push em `main`), ou
- Na mesma rede Wi-Fi: `npm run dev -- --host` e abra no celular o endereço que aparecer.

## Como relatar um problema (quanto mais preciso, melhor o conserto)
- O que eu fiz (passo a passo)
- O que aconteceu
- O que eu esperava
- Em qual aparelho (celular/notebook) e, se possível, print
