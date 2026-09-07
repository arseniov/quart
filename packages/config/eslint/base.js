import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

// Flat config (ESLint 9 native). Plugins are imported here so they resolve from
// this package's node_modules — consumer packages need only `eslint` on PATH.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/.turbo/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  security.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    settings: { 'import/resolver': { typescript: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'import/no-default-export': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
);
