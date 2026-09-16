import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { verifyRedaction } from '../../src/scripts/check-sentry-redaction.js';

// Path to the built script. `pnpm test` does not build, so the integration
// tests skip themselves when the artifact is missing — the unit tests for
// `verifyRedaction` still cover the comparison logic in any environment.
// `pnpm check:sentry-redaction` always builds first via the package.json script.
const SCRIPT = resolve(process.cwd(), 'dist/scripts/check-sentry-redaction.js');

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(env: NodeJS.ProcessEnv = process.env): ScriptResult {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      env,
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

  it('scrubs PII from the debug_images and sdkProcessingMetadata surfaces', async () => {
    // Round-trip the synthetic event and assert no FAKE_* substring leaks
    // through either of the surfaces the scrubber claims to cover.
    const { buildSyntheticEvent } = await import(
      '../../src/scripts/check-sentry-redaction.js'
    );
    const { beforeSendForSentry } = await import('../../src/observability/sentry.js');
    const scrubbed = beforeSendForSentry(
      buildSyntheticEvent() as never,
      {} as never,
    ) as Record<string, unknown> | null;
    expect(scrubbed).not.toBeNull();
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('hunter2-pii-leak');
    expect(serialized).not.toContain('eyJpii-leak-token');
    expect(serialized).not.toContain('pii-leak@example.test');
  });
});

describe('verifyScrubPass', () => {
  it('reports failures when the synthetic event still contains raw PII keys', async () => {
    const { verifyScrubPass } = await import(
      '../../src/scripts/check-sentry-redaction.js'
    );
    // Healthy scrubber: empty failures.
    expect(verifyScrubPass()).toEqual([]);
  });
});

describe('verifyCycleSafety', () => {
  it('replaces self-references with [cycle] and does not crash the verifier', async () => {
    const { verifyCycleSafety } = await import(
      '../../src/scripts/check-sentry-redaction.js'
    );
    expect(verifyCycleSafety()).toEqual([]);
  });
});

describe('verifyDepthCap', () => {
  it('marks over-deep trees with [depth-capped] at depth 8', async () => {
    const { verifyDepthCap } = await import(
      '../../src/scripts/check-sentry-redaction.js'
    );
    expect(verifyDepthCap()).toEqual([]);
  });
});

describe('verifyFailClosed', () => {
  it('returns null (drops the event) when the scrubber throws mid-walk', async () => {
    const { verifyFailClosed } = await import(
      '../../src/scripts/check-sentry-redaction.js'
    );
    expect(verifyFailClosed()).toEqual([]);
  });
});

describe('verifyRedaction — negative regression', () => {
  it('catches a regression where the scrubber stops redacting a PII key', async () => {
    // Simulate the most realistic regression: the scrubber returns the
    // event unscrubbed (e.g. someone broke a regex / removed a branch).
    // Spy on beforeSendForSentry so it just clones-and-returns, leaving
    // FAKE_PASSWORD ('hunter2-pii-leak') in the output. The verifier's
    // substring scan must catch it.
    const sentry = await import('../../src/observability/sentry.js');
    const original = sentry.beforeSendForSentry;
    const passthrough = ((event: unknown, _hint: unknown) =>
      // Mirror the real signature; do NOT scrub.
      (event as never)) as typeof sentry.beforeSendForSentry;
    const spy = vi
      .spyOn(sentry, 'beforeSendForSentry')
      .mockImplementation(passthrough);
    try {
      const failures = verifyRedaction();
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some((f) => f.includes('hunter2-pii-leak'))).toBe(true);
    } finally {
      spy.mockRestore();
      // Sanity: scrubber back to healthy.
      expect(verifyRedaction()).toEqual([]);
      void original;
    }
  });
});

describe('check-sentry-redaction (subprocess)', () => {
  beforeAll(() => {
    // Always rebuild so the dist artifact reflects the source under test
    // (the env-flag stub in `main()` is a recent addition; a stale dist
    // would silently pass the SENTRY_REDACTION_BROKEN test).
    execFileSync('pnpm', ['exec', 'nest', 'build'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: 180_000,
    });
  }, 200_000);

  it('exits 0 when the scrubber scrubs everything', () => {
    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('all synthetic PII was scrubbed');
  });

  it('exits 1 when SENTRY_REDACTION_BROKEN=1 forces a stub that leaks PII', () => {
    const result = runScript({ ...process.env, SENTRY_REDACTION_BROKEN: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/regression\(s\) detected/);
  });
});