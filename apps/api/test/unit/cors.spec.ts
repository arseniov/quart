import { describe, expect, it } from 'vitest';

import {
  buildCorsOptions,
  describeCorsSurface,
  type CorsBuildOptions,
} from '../../src/security/cors.js';
import { type SecurityEnv, SecurityEnvSchema } from '../../src/security/security-env.js';

const baseEnv = (overrides: Partial<SecurityEnv> = {}): SecurityEnv =>
  SecurityEnvSchema.parse({
    ...overrides,
  });

const build = (overrides: Partial<SecurityEnv> = {}) =>
  buildCorsOptions({ env: baseEnv(overrides) } as CorsBuildOptions);

const invokeOrigin = async (
  opts: ReturnType<typeof build>,
  origin: string | undefined,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const fn = opts.origin as (o: string | undefined, cb: (e: Error | null, v: unknown) => void) => void;
    fn(origin, (err, v) => (err ? reject(err) : resolve(v)));
  });

describe('describeCorsSurface', () => {
  it('exposes the expected methods, headers, max-age', () => {
    const s = describeCorsSurface();
    expect(s.methodsAllowed).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    expect(s.headersAllowed).toEqual(['Authorization', 'Content-Type', 'X-Request-ID', 'X-Trace-Context']);
    expect(s.headersExposed).toEqual(['X-Request-ID', 'X-Trace-Context', 'Retry-After']);
    expect(s.preflightMaxAgeSeconds).toBe(600);
  });
});

describe('buildCorsOptions — empty allowed origins (no CORS)', () => {
  const opts = build();

  it('origin is false (no Access-Control-Allow-Origin header)', () => {
    expect(opts.origin).toBe(false);
  });

  it('credentials stays false', () => {
    expect(opts.credentials).toBeFalsy();
  });

  it('still wires allowed methods, headers, exposed headers, maxAge', () => {
    expect(opts.methods).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    expect(opts.allowedHeaders).toEqual(['Authorization', 'Content-Type', 'X-Request-ID', 'X-Trace-Context']);
    expect(opts.exposedHeaders).toEqual(['X-Request-ID', 'X-Trace-Context', 'Retry-After']);
    expect(opts.maxAge).toBe(600);
  });

  it('uses strictPreflight and 204 success status', () => {
    expect(opts.strictPreflight).toBe(true);
    expect(opts.optionsSuccessStatus).toBe(204);
  });
});

describe('buildCorsOptions — allowed origins configured', () => {
  it('returns a function origin delegator (never `*`)', () => {
    const opts = build({ CORS_ALLOWED_ORIGINS: 'https://app.example' });
    expect(typeof opts.origin).toBe('function');
  });

  it('echoes a matching origin (true)', async () => {
    const opts = build({ CORS_ALLOWED_ORIGINS: 'https://app.example,https://admin.example' });
    expect(await invokeOrigin(opts, 'https://app.example')).toBe(true);
    expect(await invokeOrigin(opts, 'https://admin.example')).toBe(true);
  });

  it('rejects a non-matching origin (false)', async () => {
    const opts = build({ CORS_ALLOWED_ORIGINS: 'https://app.example' });
    expect(await invokeOrigin(opts, 'https://evil.example')).toBe(false);
  });

  it('returns false when no Origin header is sent (server-to-server)', async () => {
    const opts = build({ CORS_ALLOWED_ORIGINS: 'https://app.example' });
    expect(await invokeOrigin(opts, undefined)).toBe(false);
  });

  it('sets credentials=true only when CORS_ALLOW_CREDENTIALS=true', () => {
    expect(build({ CORS_ALLOWED_ORIGINS: 'https://app.example' }).credentials).toBeFalsy();
    expect(build({ CORS_ALLOWED_ORIGINS: 'https://app.example', CORS_ALLOW_CREDENTIALS: true }).credentials).toBe(true);
  });

  it('rejects credentials=true without origins (config-time guard)', () => {
    expect(() => build({ CORS_ALLOW_CREDENTIALS: true })).toThrow(
      /CORS_ALLOW_CREDENTIALS=true requires at least one entry/,
    );
  });

  it('honors multi-origin CSV', () => {
    const opts = build({
      CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example ,https://c.example',
    });
    expect(typeof opts.origin).toBe('function');
  });

  it('still wires methods / headers / maxAge alongside the delegator', () => {
    const opts = build({ CORS_ALLOWED_ORIGINS: 'https://app.example' });
    expect(opts.methods).toContain('POST');
    expect(opts.allowedHeaders).toContain('Authorization');
    expect(opts.exposedHeaders).toContain('X-Request-ID');
    expect(opts.maxAge).toBe(600);
    expect(opts.optionsSuccessStatus).toBe(204);
  });
});
