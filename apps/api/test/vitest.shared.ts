import { resolve } from 'node:path';

import * as ts from 'typescript';
import type { Plugin } from 'vitest/config';

// Vitest's `esbuild` option is forwarded to esbuild's transform API, which
// does not accept `plugins`. esbuild's build-plugin API (used by
// @anatine/esbuild-decorators) therefore can't be plugged in directly. We
// instead wrap the same logic as a Vite plugin: for any .ts file that contains
// a decorator AND tsconfig.json has `emitDecoratorMetadata: true`, we
// transpile it ourselves with TypeScript so `design:paramtypes` is emitted.
export function decoratorMetadataPlugin(): Plugin {
  const tsconfigPath = resolve(process.cwd(), 'tsconfig.json');
  const configFile = ts.findConfigFile(tsconfigPath, ts.sys.fileExists);
  if (!configFile) {
    throw new Error(`tsconfig.json not found relative to ${tsconfigPath}`);
  }
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
  // Force ESM output regardless of tsconfig module so transpileModule never
  // emits require() into a type:module package.
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: false,
  };
  const decoratorPattern = /@\w/;

  return {
    name: 'quart:decorator-metadata',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.[mc]?tsx?$/.test(id)) return null;
      if (!decoratorPattern.test(code)) return null;
      const out = ts.transpileModule(code, {
        compilerOptions,
        fileName: id,
      });
      return { code: out.outputText, map: out.sourceMapText };
    },
  };
}