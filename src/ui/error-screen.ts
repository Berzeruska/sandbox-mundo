/**
 * Tela de erro: em vez de travar em "Gerando mundo…", mostra o que deu errado (texto que pode ser
 * copiado e mandado no relato de bug) e um botão "Tentar de novo".
 */
export class ErrorScreen {
  private root: HTMLDivElement;
  private text: HTMLPreElement;
  private shown = false;

  constructor(parent: HTMLElement, private onRetry: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'error-screen';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'error-title';
    title.textContent = 'Algo deu errado';
    const hint = document.createElement('div');
    hint.className = 'error-hint';
    hint.textContent = 'Se acontecer de novo, mande este texto no relato do bug:';
    this.text = document.createElement('pre');
    this.text.className = 'error-text';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'panel-btn primary';
    retry.textContent = 'Tentar de novo';
    retry.addEventListener('click', () => this.onRetry());
    this.root.append(title, hint, this.text, retry);
    parent.append(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Mostra o erro (o primeiro fica; os seguintes são acrescentados, para não esconder a causa). */
  show(message: string): void {
    this.text.textContent = this.shown ? `${this.text.textContent}\n\n— e depois —\n${message}` : message;
    this.shown = true;
    this.root.hidden = false;
  }
}
