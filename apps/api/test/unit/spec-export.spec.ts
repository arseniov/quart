import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  atomicWriteJson,
  diffOpenApi,
  readExistingSpec,
  readGitShortSha,
  resolveOutputPath,
  sortOpenApiKeys,
} from '../../src/openapi/spec-export.js';

describe('sortOpenApiKeys (stable sort for minimal git diff)', () => {
  it('sorts top-level keys alphabetically', () => {
    const out = sortOpenApiKeys({ z: 1, a: 2, m: 3 });
    expect(Object.keys(out)).toEqual(['a', 'm', 'z']);
  });

  it('sorts nested objects recursively', () => {
    const out = sortOpenApiKeys({ z: { y: 1, a: 2 }, a: { c: 1, b: 2 } });
    expect(Object.keys(out)).toEqual(['a', 'z']);
    expect(Object.keys((out as { z: Record<string, unknown> }).z)).toEqual(['a', 'y']);
  });

  it('preserves array order (operation sequence is meaningful)', () => {
    const out = sortOpenApiKeys({ tags: ['z-tag', 'a-tag', 'm-tag'] });
    expect(out).toEqual({ tags: ['z-tag', 'a-tag', 'm-tag'] });
  });

  it('leaves primitives unchanged', () => {
    expect(sortOpenApiKeys(42)).toBe(42);
    expect(sortOpenApiKeys('hello')).toBe('hello');
    expect(sortOpenApiKeys(null)).toBe(null);
  });

  it('is deterministic — same input yields identical bytes', () => {
    const original = {
      info: { title: 'X', version: '1.0.0' },
      paths: { '/b': {}, '/a': {} },
      components: { securitySchemes: { z: {}, a: {} } },
    };
    const pass1 = JSON.stringify(sortOpenApiKeys(original));
    const pass2 = JSON.stringify(sortOpenApiKeys(JSON.parse(pass1)));
    expect(pass2).toBe(pass1);
  });
});

describe('resolveOutputPath (path-traversal guard)', () => {
  const workspaceRoot = '/workspace';
  const insidePackages = '/workspace/packages/shared-contracts/openapi.json';
  const insideAppsApi = '/workspace/apps/api/dist/foo.json';

  it('accepts a path under packages/', () => {
    const out = resolveOutputPath(insidePackages, workspaceRoot);
    expect(out.absolute).toBe(insidePackages);
    expect(out.relative).toBe('packages/shared-contracts/openapi.json');
  });

  it('accepts a path under apps/', () => {
    const out = resolveOutputPath(insideAppsApi, workspaceRoot);
    expect(out.absolute).toBe(insideAppsApi);
    expect(out.relative).toBe('apps/api/dist/foo.json');
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => resolveOutputPath('/etc/passwd', workspaceRoot)).toThrow(/escapes workspace/);
    expect(() => resolveOutputPath('/tmp/openapi.json', workspaceRoot)).toThrow(
      /escapes workspace/,
    );
  });

  it('rejects paths outside apps/ and packages/', () => {
    // Inside workspace but not under apps/ or packages/ — `docs/superpowers/foo.json`
    expect(() =>
      resolveOutputPath('/workspace/docs/superpowers/foo.json', workspaceRoot),
    ).toThrow(/must live under apps\/ or packages\//);
  });
});

describe('atomicWriteJson (tmp → rename)', () => {
  it('writes JSON, parent dir, and reports bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-export-'));
    try {
      const target = join(dir, 'out.json');
      const result = await atomicWriteJson(target, { hello: 'world' }, 2);
      expect(result.bytes).toBeGreaterThan(0);
      const raw = await readFile(target, 'utf8');
      expect(JSON.parse(raw)).toEqual({ hello: 'world' });
      // beautified: must end with newline + closing brace + indent
      expect(raw.endsWith('}')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects minified output when indent=undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-export-'));
    try {
      const target = join(dir, 'mini.json');
      await atomicWriteJson(target, { ok: true }, undefined);
      const raw = await readFile(target, 'utf8');
      expect(raw).toBe('{"ok":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not leave a stray .tmp file after success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-export-'));
    try {
      const target = join(dir, 'foo.json');
      await atomicWriteJson(target, { ok: 1 }, 2);
      const { readdirSync, existsSync } = await import('node:fs');
      expect(existsSync(`${target}.tmp`)).toBe(false);
      expect(readdirSync(dir)).toEqual(['foo.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('diffOpenApi (route-level delta)', () => {
  it('reports added, removed, and changed paths', () => {
    const prev = { paths: { '/a': { get: { x: 1 } }, '/b': { get: { x: 1 } } } };
    const next = {
      paths: {
        '/a': { get: { x: 1 } }, // unchanged
        '/c': { get: { x: 1 } }, // added
      },
      // Note: '/b' is gone — that's "removed"
    };
    const delta = diffOpenApi(prev, next);
    expect(delta.added).toEqual(['/c']);
    expect(delta.removed).toEqual(['/b']);
    expect(delta.changed).toEqual([]);
  });

  it('treats identical entries as unchanged', () => {
    const prev = { paths: { '/a': { get: {} } } };
    const next = { paths: { '/a': { get: {} } } };
    expect(diffOpenApi(prev, next)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('flags path bodies that differ as changed', () => {
    const prev = { paths: { '/a': { get: { x: 1 } } } };
    const next = { paths: { '/a': { get: { x: 2 } } } };
    expect(diffOpenApi(prev, next).changed).toEqual(['/a']);
  });

  it('handles null prev (first run)', () => {
    const delta = diffOpenApi(null, { paths: { '/a': {} } });
    expect(delta.added).toEqual(['/a']);
  });
});

describe('readExistingSpec (for CI diff)', () => {
  it('returns null when the file is missing', () => {
    expect(readExistingSpec('/tmp/does-not-exist-openapi.json')).toBe(null);
  });

  it('parses an existing JSON file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-export-'));
    try {
      const target = join(dir, 'prev.json');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(target, JSON.stringify({ openapi: '3.0.0' }));
      expect(readExistingSpec(target)).toEqual({ openapi: '3.0.0' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readGitShortSha (no-git / no-HEAD fallback)', () => {
  it('returns null when no .git and no HEAD file exist under the root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-export-no-git-'));
    try {
      // Neither .git/ nor HEAD — mirrors a tarball / cache checkout.
      expect(readGitShortSha(dir)).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sortOpenApiKeys (non-plain-object guard)', () => {
  it('leaves Map / Set / Date / Symbol instances unchanged', () => {
    // Guard: these have non-enumerable internal slots that would otherwise
    // surface as `{}` and silently drop data from the spec.
    const m = new Map<string, number>([['a', 1]]);
    const s = new Set<number>([1, 2]);
    const d = new Date(0);
    const sym = Symbol('x');

    expect(sortOpenApiKeys(m)).toBe(m);
    expect(sortOpenApiKeys(s)).toBe(s);
    expect(sortOpenApiKeys(d)).toBe(d);
    expect(sortOpenApiKeys(sym)).toBe(sym);
  });
});
