import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.next-e2e/**', '**/.pytest_cache/**', '**/.ruff_cache/**', '**/.venv/**', '.pnpm-store/**', '**/generated/**', '**/next-env.d.ts', 'work/**', 'evaluations/results/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
