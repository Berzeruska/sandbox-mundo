import { describe, expect, it } from 'vitest';
import { GAME_NAME, titleText } from '../../src/core/version';

describe('version', () => {
  it('monta o título com o nome do jogo', () => {
    expect(titleText()).toContain(GAME_NAME);
  });
});
