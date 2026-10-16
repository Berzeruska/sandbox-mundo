/**
 * Recargas para isolar a página (memória compartilhada, correção 2). O jogo recarrega uma vez quando
 * abre sem o isolamento que o service worker dá. O usuário viu recarga ao reabrir (2026-10-16): este
 * contador separa "o jogo recarregou" (sobe) de "o navegador reabriu a página por conta própria" (não
 * sobe). Fica no aparelho (localStorage); falha de armazenamento só desliga a contagem.
 */
const COUNT_KEY = 'sandbox-mundo:recargas-isolamento';

export function isolationReloads(): number {
  try {
    return Number(localStorage.getItem(COUNT_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function countIsolationReload(): void {
  try {
    localStorage.setItem(COUNT_KEY, String(isolationReloads() + 1));
  } catch {
    // sem armazenamento: só não conta
  }
}
