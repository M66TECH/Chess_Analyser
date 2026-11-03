import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.turbo/**',
      'clone lichess/**',
      'apps/api/venv/**',
      'apps/web/**',
      'scripts/scratch/**',
    ],
  },
  tseslint.configs.recommended,
);
