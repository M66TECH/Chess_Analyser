import { defineConfig } from 'vitest/config';

// Configuration racine pour `vitest run` depuis la racine.
//
// Cette config ne couvre QUE packages/chess-core (les tests logiques).
// Les tests UI (packages/ui) et orchestrateur (apps/web) ont leur propre
// config jsdom et se lancent depuis leur workspace :
//   npm test --workspace @chess-analyzer/ui
//   cd apps/web && npx vitest run
//
// Sans cette config, vitest scanne TOUT le disque y compris clone lichess/
// dont les tests échouent car ils importent des deps internes à lila.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/chess-core/src/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/clone lichess/**',
      '**/apps/api/**',
      '**/.next/**',
      '**/e2e/**',
      'packages/ui/**',
      'apps/web/**',
    ],
  },
});
