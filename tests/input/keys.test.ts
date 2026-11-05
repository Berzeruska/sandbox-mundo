import { describe, expect, it } from 'vitest';
import { keyAxes } from '../../src/input/keys';

describe('teclado do notebook', () => {
  it('cima aproxima, baixo afasta; esquerda e direita giram; opostas se anulam', () => {
    expect(keyAxes(new Set(['ArrowUp']))).toEqual({ zoom: 1, turn: 0 });
    expect(keyAxes(new Set(['ArrowDown']))).toEqual({ zoom: -1, turn: 0 });
    expect(keyAxes(new Set(['ArrowLeft', 'ArrowUp']))).toEqual({ zoom: 1, turn: -1 });
    expect(keyAxes(new Set(['ArrowRight']))).toEqual({ zoom: 0, turn: 1 });
    expect(keyAxes(new Set(['ArrowLeft', 'ArrowRight']))).toEqual({ zoom: 0, turn: 0 });
    expect(keyAxes(new Set())).toEqual({ zoom: 0, turn: 0 });
  });
});
