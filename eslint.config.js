import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Regra do projeto: toda aleatoriedade passa por src/core/rng.ts.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use o gerador com semente (src/core/rng.ts).' },
      ],
    },
  },
  {
    // Nos testes, `!` é aceitável: se o valor for nulo, o teste falha de qualquer jeito.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
