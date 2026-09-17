import base from '@quart/config/eslint/base.js';

export default [
  { ignores: ['src/types.gen.ts'] },
  ...base,
];