// Integration-only vitest config: same decorator-metadata plugin + plugins as
// the base config, but does NOT exclude `test/integration/**`. Used to run
// integration tests via `pnpm test:integration` (which is currently broken
// by the base config's exclude pattern).
//
// Ponytail: this is a temporary workaround for the broken `pnpm
// test:integration` script. When the base config's exclude pattern is fixed
// to be conditional on a CLI flag (e.g. `--include-integration`), this file
// can be deleted.
import { defineConfig, type Plugin } from 'vitest/config';
import * as ts from 'typescript';
import { resolve } from 'node:path';

function decoratorMetadataPlugin(): Plugin {
  const tsconfigPath = resolve(process.cwd(), 'tsconfig.json');
  const configFile = ts.findConfigFile(tsconfigPath, ts.sys.fileExists);
  if (!configFile) throw new Error(`tsconfig.json not found relative to ${tsconfigPath}`);
  const text = ts.sys.readFile(configFile);
  if (text === undefined) throw new Error(`failed to read ${configFile}`);
  const parsed = ts.parseJsonConfigFileContent(
    ts.parseConfigFileTextToJson(configFile, text).config,
    ts.sys,
    resolve(configFile, '..'),
  );
  if (!parsed.options.emitDecoratorMetadata) {
    throw new Error('apps/api/tsconfig.json must have emitDecoratorMetadata: true');
  }
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: false,
  };
  return {
    name: 'quart:decorator-metadata',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.[mc]?tsx?$/.test(id)) return null;
      if (!/@\w/.test(code)) return null;
      const out = ts.transpileModule(code, { compilerOptions, fileName: id });
      return { code: out.outputText, map: out.sourceMapText };
    },
  };
}

export default defineConfig({
  plugins: [decoratorMetadataPlugin()],
  test: {
    pool: 'forks',
    exclude: ['**/node_modules/**', 'test/e2e/**'],
  },
});
