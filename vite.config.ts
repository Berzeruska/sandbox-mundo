/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base: './'` faz o build funcionar tanto na raiz quanto em /sandbox-mundo/ (GitHub Pages).
export default defineConfig({
  base: './',
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
