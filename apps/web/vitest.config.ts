import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    alias: {
      '@chess-analyzer/chess-core': path.resolve(__dirname, '../../packages/chess-core/src'),
      '@chess-analyzer/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  resolve: {
    alias: {
      '@chess-analyzer/chess-core': path.resolve(__dirname, '../../packages/chess-core/src'),
      '@chess-analyzer/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
