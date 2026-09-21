// apps/mobile/jest.config.js
// Load jest-expo's full preset then extend transformIgnorePatterns with the
// unified/remark/rehype ecosystem so Babel transforms these ESM packages.
// ponytail: no shared setupFiles — mocks stay inline per test (matches
// existing pattern across src/{api,lib,components}/__tests__).
const expo = require('jest-expo/jest-preset');

const EXTRA_TRANSFORMABLE = [
  'unified',
  'remark-.*',
  'rehype-.*',
  'mdast-util-.*',
  'hast-util-.*',
  'micromark.*',
  'trim-lines',
  'trim-trailing-lines',
  'unist-.*',
  'vfile.*',
  'bail',
  'trough',
  'is-plain-obj',
  'decode-named-character-reference',
  'character-entities.*',
  'property-information',
  'space-separated-tokens',
  'comma-separated-tokens',
  'web-namespaces',
  'html-void-elements',
  'ccount',
  'escape-string-regexp',
  'markdown-table',
  'zwitch',
  'longest-streak',
  'stringify-entities',
  'devlop',
  'estree-util-is-identifier-name',
  '@ungap/structured-clone',
];

// Inherit jest-expo's whitelist, then add unified ecosystem packages.
const [firstPattern, ...rest] = expo.transformIgnorePatterns;
const inherited = firstPattern.replace(/\)$/, '');
const extended = `${inherited}|${EXTRA_TRANSFORMABLE.join('|')})`;

module.exports = {
  ...expo,
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transformIgnorePatterns: [`${extended}`, ...rest],
  // GH #54 — global RTL cleanup + fake-timer drain so unmounts don't
  // leak react-query's 5-min gc setTimeout past jest's FORCE_EXIT_DELAY.
  // maxWorkers: 1 prevents the parallel-worker "A worker process has
  // failed to exit gracefully" message that surfaces when jest's worker
  // shutdown races with the fake-timer cleanup (the suite is small enough
  // that sequential execution costs nothing).
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  maxWorkers: 1,
};
