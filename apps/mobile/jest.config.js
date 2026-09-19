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
};
