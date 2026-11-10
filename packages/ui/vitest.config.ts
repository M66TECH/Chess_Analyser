import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    alias: {
      '@chess-analyzer/chess-core': path.resolve(__dirname, '../chess-core/src'),
    },
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
  resolve: {
    alias: {
      '@chess-analyzer/chess-core': path.resolve(__dirname, '../chess-core/src'),
    },
  },
});
