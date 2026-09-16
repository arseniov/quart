/**
 * Drift check (T58): fail if `packages/shared-contracts/src/openapi.json`
 * has drifted from what `export:openapi` would write today.
 *
 * Reuses `generateSpec()` from `export-openapi.ts` so there is exactly
 * one place that knows how to assemble the spec. Compares byte-identical
 * JSON after normalisation; on drift, prints a unified diff and exits 1.
 *
 * No writes to the committed spec — the script regenerates the live
 * variant to a temp file so `diff -u` can render a human-readable patch
 * without touching the working tree.
 *
 * Env overrides (all optional):
 *   OPENAPI_DRIFT_COMMITTED_PATH — defaults to
 *                                  packages/shared-contracts/src/openapi.json
 *   OPENAPI_DRIFT_DIFF_BIN       — defaults to `diff`; pass `cat` to skip
 *
 * Exit codes:
 *   0 — committed spec matches live (no drift)
 *   1 — drift detected; unified diff printed to stderr
 *   2 — committed file missing or malformed (treated as drift, loud)
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOutputPath, sortOpenApiKeys } from '../openapi/spec-export.js';

import { generateSpec } from './export-openapi.js';

export const DEFAULT_DRIFT_COMMITTED_PATH = 'packages/shared-contracts/src/openapi.json';

/**
 * Pure comparison: returns `true` if `live` matches `committed` after
 * normalisation. Exported for unit tests so they can exercise the
 * comparison without spawning a subprocess.
 */
export function specsMatch(live: unknown, committed: unknown): boolean {
  return JSON.stringify(sortOpenApiKeys(live), null, 2) === JSON.stringify(sortOpenApiKeys(committed), null, 2);
}

function renderDiff(committedPath: string, livePath: string): string {
  const bin = process.env.OPENAPI_DRIFT_DIFF_BIN ?? 'diff';
  try {
    return execFileSync(bin, ['-u', committedPath, livePath], { encoding: 'utf8' });
  } catch (err) {
    // `diff` exits non-zero when files differ — the captured stdout is
    // the unified diff we want. Other errors (binary missing, EACCES)
    // surface as a thrown exception with no stdout.
    if (err && typeof err === 'object' && 'stdout' in err) {
      const stdout = (err as { stdout: string | Buffer }).stdout;
      return typeof stdout === 'string' ? stdout : stdout.toString('utf8');
    }
    return `(failed to render diff: ${err instanceof Error ? err.message : String(err)})`;
  }
}

function main(): void {
  const workspaceRoot = resolve(process.cwd(), '../..');
  const rawCommitted =
    process.env.OPENAPI_DRIFT_COMMITTED_PATH?.trim() || DEFAULT_DRIFT_COMMITTED_PATH;
  const { absolute: committedAbs, relative: committedRel } = resolveOutputPath(
    rawCommitted,
    workspaceRoot,
  );

  if (!existsSync(committedAbs)) {
    process.stderr.write(
      `check-openapi-drift: committed spec not found at ${committedRel}\n` +
        `Run \`pnpm --filter @quart/api export:openapi\` to seed it.\n`,
    );
    process.exit(2);
  }

  let committed: unknown;
  try {
    committed = JSON.parse(readFileSync(committedAbs, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `check-openapi-drift: committed spec at ${committedRel} is not valid JSON: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  let live: unknown;
  try {
    live = generateSpec();
  } catch (err) {
    process.stderr.write(
      `check-openapi-drift: failed to generate live spec: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  if (specsMatch(live, committed)) {
    process.stdout.write(`OpenAPI spec matches committed copy (${committedRel}).\n`);
    process.exit(0);
  }

  // Drift — write the live spec to a temp file so `diff -u` has two real
  // paths to compare. No mutation of the working tree or the committed file.
  const tmpDir = mkdtempSync(join(tmpdir(), 'openapi-drift-'));
  const livePath = join(tmpDir, 'openapi.json');
  writeFileSync(livePath, JSON.stringify(sortOpenApiKeys(live), null, 2));

  process.stderr.write(`OpenAPI drift detected.\n`);
  process.stderr.write(`  expected: ${committedRel}\n`);
  process.stderr.write(`  live:     ${livePath}\n\n`);
  process.stderr.write(renderDiff(committedAbs, livePath));
  process.exit(1);
}

// Only run when this file is the entry point. Vitest (and any other
// importer) gets the pure helpers without triggering `process.exit`,
// which would otherwise abort the test runner.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = resolve(fileURLToPath(import.meta.url));
if (entryPath === selfPath) {
  main();
}
