module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import', 'security'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:security/recommended',
  ],
  settings: { 'import/resolver': { typescript: true } },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
    'import/no-default-export': 'off',
  },
  ignorePatterns: ['dist', 'build', '.turbo', 'node_modules', 'coverage'],
};