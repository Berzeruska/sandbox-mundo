/**
 * Memória compartilhada entre os ajudantes (workers), plano em `docs/01-arquitetura.md`.
 *
 * Com a página isolada entre origens, os arrays grandes que os dois lados usam (grade, tabelas do
 * clima e do sombreado, mundo) nascem num SharedArrayBuffer: o outro ajudante recebe o mesmo
 * buffer e enxerga os mesmos bytes, sem cópia. Sem isolamento (primeira visita, testes), nascem
 * num ArrayBuffer comum e cada lado tem a própria cópia.
 */
let enabled = false;

/** Liga a memória compartilhada (só tem efeito se o navegador a liberar). */
export function enableSharedMemory(on: boolean): void {
  enabled = on && typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export function sharedMemoryEnabled(): boolean {
  return enabled;
}

interface TypedArrayClass<T> {
  new (lengthOrBuffer: number | ArrayBufferLike): T;
  readonly BYTES_PER_ELEMENT: number;
}

/** Array tipado novo, zerado; compartilhável quando a memória compartilhada está ligada. */
export function newArray<T>(Kind: TypedArrayClass<T>, length: number): T {
  return enabled ? new Kind(new SharedArrayBuffer(length * Kind.BYTES_PER_ELEMENT)) : new Kind(length);
}
