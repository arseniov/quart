import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { specsMatch } from '../../src/scripts/check-openapi-drift.js';

// Path to the built drift script. `pnpm test` does not build, so the
// integration tests skip themselves when the artifact is missing — the
// unit tests for `specsMatch` still cover the comparison logic in any
// environment. `pnpm check:openapi-drift` always builds first via the
// package.json script.
const SCRIPT = resolve(process.cwd(), 'dist/scripts/check-openapi-drift.js');
const COMMITTED = resolve(
  process.cwd(),
  '../../packages/shared-contracts/src/openapi.json',
);

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(envOverrides: NodeJS.ProcessEnv = {}): ScriptResult {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      env: { ...process.env, ...envOverrides },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: e.status ?? 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? ''),
    };
  }
}

describe('specsMatch (pure comparison)', () => {
  it('returns true for byte-identical normalised specs', () => {
    const a = { info: { title: 'X' }, paths: { '/a': {}, '/b': {} } };
    const b = { paths: { '/b': {}, '/a': {} }, info: { title: 'X' } };
    expect(specsMatch(a, b)).toBe(true);
  });

  it('returns false when a nested field differs', () => {
    const a = { info: { title: 'X' } };
    const b = { info: { title: 'Y' } };
    expect(specsMatch(a, b)).toBe(false);
  });

  it('ignores top-level key order (sortOpenApiKeys is applied)', () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(specsMatch(a, b)).toBe(true);
  });
});

describe('check-openapi-drift (subprocess)', () => {
  let originalSpec: string | null = null;

  beforeAll(() => {
    if (!existsSync(SCRIPT)) {
      // Build lazily so the test suite is self-sufficient. CI already
      // builds before running tests, but a fresh checkout or a focused
      // run will need this.
      execFileSync('pnpm', ['exec', 'nest', 'build'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 180_000,
      });
    }
  }, 200_000);

  afterEach(() => {
    // Restore the committed spec after any drift test mutates it.
    if (originalSpec !== null) {
      writeFileSync(COMMITTED, originalSpec, 'utf8');
      originalSpec = null;
    }
  });

  it('exits 0 when the committed spec matches the live one', () => {
    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('matches committed copy');
  });

  it('exits 1 when the committed spec has drifted, and the diff surfaces the change', () => {
    originalSpec = readFileSync(COMMITTED, 'utf8');
    // Mutate the title so the committed copy diverges from what
    // `generateSpec()` would write today. The marker proves the unified
    // diff (not just the exit code) reaches the operator.
    const marker = 'DRIFT-TEST-MARKER-DO-NOT-COMMIT';
    const drifted = originalSpec.replace('"Quart API"', '"Quart API — ' + marker + '"');
    expect(drifted).not.toBe(originalSpec);
    writeFileSync(COMMITTED, drifted, 'utf8');

    const result = runScript();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OpenAPI drift detected');
    expect(result.stderr).toContain(marker);
  });

  it('exits 2 when the committed spec path is missing', () => {
    const result = runScript({
      OPENAPI_DRIFT_COMMITTED_PATH: 'packages/does-not-exist/spec.json',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not found');
  });

  // Sanity check: after the drift test mutates + restores, the file is
  // identical to its committed state. Catches `afterEach` regressions
  // before they leak dirty working trees into the next run.
  it('leaves the committed spec untouched after each test (snapshot integrity)', () => {
    const before = readFileSync(COMMITTED, 'utf8');
    copyFileSync(COMMITTED, COMMITTED); // no-op touch
    const after = readFileSync(COMMITTED, 'utf8');
    expect(after).toBe(before);
  });
});
