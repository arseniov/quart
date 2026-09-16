import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { verifyRedaction } from '../../src/scripts/check-sentry-redaction.js';

// Path to the built script. `pnpm test` does not build, so the
// integration tests skip themselves when the artifact is missing — the
// unit tests for `verifyRedaction` still cover the comparison logic in
// any environment. `pnpm check:sentry-redaction` always builds first
// via the package.json script.
const SCRIPT = resolve(process.cwd(), 'dist/scripts/check-sentry-redaction.js');

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(): ScriptResult {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      env: process.env,
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

describe('verifyRedaction (pure check)', () => {
  it('returns no failures when the scrubber is healthy', () => {
    expect(verifyRedaction()).toEqual([]);
  });
});

describe('check-sentry-redaction (subprocess)', () => {
  beforeAll(() => {
    if (!existsSync(SCRIPT)) {
      execFileSync('pnpm', ['exec', 'nest', 'build'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 180_000,
      });
    }
  }, 200_000);

  it('exits 0 when the scrubber scrubs everything', () => {
    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('all synthetic PII was scrubbed');
  });
});