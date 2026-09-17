import { defineConfig } from 'vitest/config';

import { decoratorMetadataPlugin } from './test/vitest.shared.js';

export default defineConfig(({ mode }) => {
  // vitest's `exclude` is additive — a positional CLI path can't override it.
  // `--mode=integration` is the only signal the config trusts.
  const exclude =
    mode === 'integration' ? ['**/node_modules/**', 'test/e2e/**']
    : mode === 'e2e'        ? ['**/node_modules/**', 'test/integration/**']
    :                         ['**/node_modules/**', 'test/integration/**', 'test/e2e/**'];
  return {
    plugins: [decoratorMetadataPlugin()],
    test: {
      pool: 'forks',
      // Integration + e2e suites spin up Docker via testcontainers and are run
      // via dedicated scripts (`test:integration`, `test:e2e`). The default
      // `pnpm test` run is unit-only and must not require Docker.
      exclude,
    },
  };
});