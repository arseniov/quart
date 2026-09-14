import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the app's version from the nearest `package.json`.
 *
 * Used by both `openapi/swagger.config.ts` (Swagger UI `info.version`)
 * and `scripts/export-openapi.ts` (the headless export). Centralising
 * the read means a release bump is a single `version:` field away from
 * showing up in the OpenAPI spec — without the export script and the
 * runtime Swagger UI drifting.
 *
 * Returns `null` when the package.json is missing or unreadable so the
 * caller can distinguish "we shipped 0.0.0 as the placeholder" from
 * "the manifest is gone, log loudly". A literal `0.0.0` is a real (if
 * placeholder) version and is returned as the string `'0.0.0'`.
 *
 * ponytail: file-resolve, no `import.meta.url` indirection. Bumping
 * to ESM-aware resolution is one `fileURLToPath(new URL('..', import.meta.url))`
 * away if this module ever ships as a published package.
 */
export function readAppVersion(): string | null {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}
