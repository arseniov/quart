import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * Recursively sort OpenAPI object keys so diffs are minimal across runs.
 *
 * OpenAPI doesn't specify key order, but `@nestjs/swagger` emits objects
 * in registration order (which depends on insertion order — non-stable).
 * We sort three top-level sections:
 *   - `info` — version, title, description surface
 *   - `components` — securitySchemes / schemas order is non-deterministic
 *   - `paths` — operation order depends on controller scan order
 *
 * Arrays are NOT sorted (operation sequence matters). Non-object values
 * pass through unchanged.
 *
 * Pure function — same input yields same bytes. Stable enough to commit
 * the artifact and review routing changes via plain git diff.
 *
 * Edge cases guarded: `Map`, `Set`, `Date`, `Symbol`, and any other
 * non-plain-object instances pass through unchanged (we can't enumerate
 * their keys the way `Object.keys` does on a plain record). This keeps
 * the function total — if `@nestjs/swagger` ever starts emitting, say,
 * a `Date` inside an example, we don't throw, we just emit it.
 */
export function sortOpenApiKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortOpenApiKeys(v)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;
  // `Object.prototype.toString.call(...)` short-circuits built-ins whose
  // own keys don't enumerate the way plain-object keys do. Anything that
  // isn't `[object Object]` is passed through as-is.
  const tag = Object.prototype.toString.call(value);
  if (tag !== '[object Object]') return value;
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    out[key] = sortOpenApiKeys(obj[key]);
  }
  return out as unknown as T;
}

/**
 * Resolve and validate the output path. Rejects paths that escape the
 * workspace (defense-in-depth — the script never wants to write
 * `../../../etc/foo`). The acceptable anchors are the `apps/api` and
 * `packages/*` directories under the workspace root.
 *
 * Relative paths resolve against `workspaceRoot`, NOT `process.cwd()`,
 * so the script works regardless of where it's invoked from.
 *
 * Returns an absolute path that has been confirmed to live inside the
 * allowed anchors.
 */
export function resolveOutputPath(
  rawPath: string,
  workspaceRoot: string,
): { absolute: string; relative: string } {
  const abs = isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath);
  const rel = relative(workspaceRoot, abs);
  // `..` segments mean the path escapes the workspace root.
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`output path escapes workspace: ${rawPath}`);
  }
  const segments = rel.split('/');
  const anchor = segments[0] ?? '';
  const insideAllowedAnchor =
    anchor === 'apps' || anchor === 'packages' || anchor.startsWith('packages/') || rel.startsWith('apps/api');
  if (!insideAllowedAnchor) {
    throw new Error(
      `output path must live under apps/ or packages/: ${rawPath} (resolved: ${rel})`,
    );
  }
  return { absolute: abs, relative: rel };
}

/**
 * Atomic file write — guarantees that consumers never see a half-written
 * spec. Writes to `<path>.tmp` synchronously, then `rename`s onto the
 * final path. `rename` is atomic on POSIX, so a concurrent reader sees
 * the old file or the new file, never a partial.
 *
 * Creates parent directories first; if the rename fails after a successful
 * tmp write, the tmp file stays on disk for inspection — we explicitly
 * do not auto-clean, so a failure surfaces loudly in the next CI run.
 *
 * ponytail: `EXDEV` (cross-device rename) is not handled. The export job
 * always writes inside the same filesystem as the tmp file (CI cache,
 * working tree), so a retry isn't needed in practice. If the output ever
 * crosses a mount point, swap `rename` for `copyFile + unlink`.
 */
export async function atomicWriteJson(
  absolutePath: string,
  data: unknown,
  indent: number | undefined,
): Promise<{ bytes: number; finalPath: string }> {
  const json = indent !== undefined ? JSON.stringify(data, null, indent) : JSON.stringify(data);
  await mkdir(dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.tmp`;
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, absolutePath);
  return { bytes: Buffer.byteLength(json, 'utf8'), finalPath: absolutePath };
}

/**
 * Diff two OpenAPI specs at the path level. Returns the route-level
 * delta: paths added/removed/changed between `prev` and `next`. The
 * `changed` list compares the JSON-stringified body of each shared path.
 *
 * Used as an optional report when the export script is run with an
 * existing committed spec — the diff shows up in CI logs as a clear
 * "what changed in this PR" summary rather than a noisy unified diff.
 */
export function diffOpenApi(
  prev: { paths?: Record<string, unknown> } | null,
  next: { paths?: Record<string, unknown> } | null,
): { added: string[]; removed: string[]; changed: string[] } {
  const prevPaths = prev?.paths ?? {};
  const nextPaths = next?.paths ?? {};
  const prevKeys = new Set(Object.keys(prevPaths));
  const nextKeys = new Set(Object.keys(nextPaths));

  const added: string[] = [];
  for (const k of nextKeys) {
    if (!prevKeys.has(k)) added.push(k);
  }
  const removed: string[] = [];
  for (const k of prevKeys) {
    if (!nextKeys.has(k)) removed.push(k);
  }
  const changed: string[] = [];
  for (const k of nextKeys) {
    if (prevKeys.has(k)) {
      const a = JSON.stringify(prevPaths[k]);
      const b = JSON.stringify(nextPaths[k]);
      if (a !== b) changed.push(k);
    }
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/**
 * Read the git HEAD short SHA. Returns `null` when:
 *   - `cwd` is not inside a git repo (no `.git` directory and no `HEAD` file)
 *   - git is not installed
 *   - the resolved HEAD has no short-sha (detached / unborn)
 *
 * We shell out to `git rev-parse --short HEAD` rather than reading
 * `.git/HEAD` ourselves so that packed refs / worktrees Just Work.
 */
export function readGitShortSha(repoRoot: string): string | null {
  if (!existsSync(resolve(repoRoot, '.git')) && !existsSync(resolve(repoRoot, 'HEAD'))) {
    // Not in a git repo (CI cache or tarball). Return null — callers
    // include the SHA as an extension field only when present.
    return null;
  }
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Read the JSON spec from disk if present. Returns null when the file
 * doesn't exist or can't be parsed — used to drive the diff report.
 *
 * Note: concurrent reads of the file mid-rename are possible but the
 * worst case is a `null` return (caught below), which the caller treats
 * as "first run" — fine since `pnpm` is single-process.
 */
export function readExistingSpec(absolutePath: string): Record<string, unknown> | null {
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
