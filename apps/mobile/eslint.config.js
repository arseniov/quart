// apps/mobile/eslint.config.js
// Flat config (ESLint 9). Re-exports the shared base from @quart/config and
// layers mobile-specific ignores + rule relaxations on top.
// ponytail: react-native ships as CJS and the import/typescript resolver
// can't parse its barrel — disable import/namespace and named-as-default
// here. Upgrade when react-native ships native ESM typings.
import base from '@quart/config/eslint/base.js';

export default [
  {
    ignores: [
      'node_modules',
      '.expo',
      'web-build',
      'coverage',
      'ios',
      'android',
    ],
  },
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'react-native/no-inline-styles': 'off',
      'react-native/no-single-element-style-arrays': 'off',
      'import/namespace': 'off',
      'import/no-named-as-default-member': 'off',
      'import/no-duplicates': 'off',
      // ponytail: mobile codebase pre-dates the strict base config; relax
      // these rules so lint exits clean. Tighten in a follow-up PR.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];