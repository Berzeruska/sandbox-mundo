#!/usr/bin/env bash
# Monta o site inteiro em $1: main na raiz, cada marco-* em previa/<branch>/ e previa/atual/,
# que redireciona para a prévia mais recente (o branch de marco com commit mais novo que ainda não está no main).
set -euo pipefail
out=$(mkdir -p "$1" && cd "$1" && pwd)
root=$(pwd)
work=$(mktemp -d)
git fetch --quiet --no-tags origin '+refs/heads/*:refs/remotes/origin/*'

# build <ref> <pasta de destino> [etiqueta da prévia]
build() {
  local ref=$1 dest=$2 label=${3:-} dir sha
  sha=$(git rev-parse "origin/$ref")
  dir="$work/$(echo "$ref" | tr '/' '-')"
  git worktree add --quiet --detach "$dir" "$sha"
  (
    cd "$dir"
    npm ci --no-audit --no-fund --silent
    GITHUB_SHA=$sha VITE_PREVIEW=$label npm run build --silent
  ) || return 1
  mkdir -p "$dest"
  cp -r "$dir/dist/." "$dest/"
  git worktree remove --force "$dir"
  rm -rf "$dir"
}

build main "$out"

latest=''
for branch in $(git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' 'refs/remotes/origin/marco-*'); do
  # Um branch antigo que não compila mais fica de fora, sem derrubar o site.
  if build "$branch" "$out/previa/$branch" "$branch"; then
    if [ -z "$latest" ] && [ "$(git rev-list --count "origin/main..origin/$branch")" -gt 0 ]; then
      latest=$branch
    fi
  else
    echo "Aviso: a prévia de $branch não compilou e ficou de fora." >&2
  fi
done

# Sem prévia à frente do main, "atual" é o próprio main.
if [ -n "$latest" ]; then target="../$latest/"; up="../../$latest/"; else target='../../'; up='../../../'; fi
redirect() {
  mkdir -p "$1"
  cat > "$1/index.html" <<HTML
<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<title>Sandbox Mundo — prévia mais recente</title>
<script>location.replace('$2' + location.search + location.hash);</script>
<noscript><meta http-equiv="refresh" content="0; url=$2"></noscript>
<p>Abrindo a prévia mais recente… <a href="$2">continuar</a></p>
</html>
HTML
}
redirect "$out/previa/atual" "$target"
[ -d "$out/previa/${latest:-none}/prototipo" ] && redirect "$out/previa/atual/prototipo" "${up}prototipo/"
echo "previa/atual -> ${latest:-main}"
cd "$root"
