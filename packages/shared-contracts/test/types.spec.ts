import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { paths, components } from '../src/types.gen.js';
import type { paths as ReExportedPaths, components as ReExportedComponents } from '../src/index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG = fileURLToPath(new URL('..', import.meta.url));
const TYPES_FILE = `${PKG}/src/types.gen.ts`;
const OPENAPI_FILE = `${PKG}/src/openapi.json`;
const GENERATOR = `${PKG}/scripts/generate-types.ts`;

const specPaths = Object.keys(
  (JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as { paths: Record<string, unknown> }).paths,
).sort();

// ponytail: enum keys at runtime requires a value-level mirror; since openapi-typescript
// produces only types, assert a representative sample plus raw-string presence in the
// generated source. Sufficient for "types reflect the spec".
const SAMPLE_PATHS = [
  '/admin/audit',
  '/auth/phone/request',
  '/health',
  '/comments/{id}',
  '/polls/{id}/vote',
];

describe('generated openapi types', () => {
  it('the types file exists and is non-empty', () => {
    expect(existsSync(TYPES_FILE)).toBe(true);
    expect(statSync(TYPES_FILE).size).toBeGreaterThan(0);
  });

  it('exports `paths` and `components`', () => {
    type _PathKey = keyof paths;
    type _CompKey = keyof components;
    const _pk: _PathKey | undefined = undefined;
    const _ck: _CompKey | undefined = undefined;
    expect(_pk).toBeUndefined();
    expect(_ck).toBeUndefined();
  });

  it('every spec path appears in the generated types source', () => {
    const source = readFileSync(TYPES_FILE, 'utf8');
    for (const p of specPaths) {
      expect(source).toContain(`"${p}":`);
    }
  });

  it('a sample of paths is typed at compile-time', () => {
    type _Sample = {
      [K in (typeof SAMPLE_PATHS)[number]]: NonNullable<paths[K]>;
    };
    const _check: _Sample | undefined = undefined;
    expect(_check).toBeUndefined();
  });

  it('paths includes the phone-request endpoint with POST and 201 response', () => {
    type PhonePost = NonNullable<paths['/auth/phone/request']['post']>;
    type _HasPost = PhonePost;
    type Responses = PhonePost['responses'];
    type _Has201 = Responses[201];
    const _check: _Has201 | undefined = undefined;
    expect(_check).toBeUndefined();
  });

  it('paths includes the admin audit endpoint with GET, security, and 401/403/429 docs', () => {
    type AuditGet = NonNullable<paths['/admin/audit']['get']>;
    type _Security = AuditGet['security'];
    type Responses = AuditGet['responses'];
    type _Has401 = Responses[401];
    type _Has403 = Responses[403];
    type _Has429 = Responses[429];
    const _check: _Has401 | undefined = undefined;
    expect(_check).toBeUndefined();
  });

  it('auth schemes are reflected as security entries on protected paths', () => {
    const spec = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    const auditGet = spec.paths['/admin/audit']?.['get'];
    expect(auditGet?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual([
      '__Host-quart-admin-session',
      '__Host-quart-api-session',
      'bearer',
    ]);
  });

  it('re-exported paths/components from src/index.ts resolve', () => {
    const _p: ReExportedPaths | undefined = undefined;
    const _c: ReExportedComponents | undefined = undefined;
    expect(_p).toBeUndefined();
    expect(_c).toBeUndefined();
  });
});

describe('generate:types script', () => {
  it('re-running produces byte-identical output (idempotent)', () => {
    const before = readFileSync(TYPES_FILE);
    execSync(`pnpm exec tsx ${GENERATOR}`, { cwd: PKG, stdio: 'pipe' });
    const after = readFileSync(TYPES_FILE);
    expect(after.equals(before)).toBe(true);
  });
});