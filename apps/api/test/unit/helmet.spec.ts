import { describe, expect, it } from 'vitest';

import { DEFAULT_CSP, buildHelmetOptions } from '../../src/security/helmet.js';
import { type SecurityEnv, SecurityEnvSchema } from '../../src/security/security-env.js';

const baseEnv = (overrides: Partial<SecurityEnv> = {}): SecurityEnv =>
  SecurityEnvSchema.parse({
    NODE_ENV: 'development',
    ...overrides,
  });

describe('DEFAULT_CSP', () => {
  it('locks default-src to self (default-deny)', () => {
    expect(DEFAULT_CSP['default-src']).toEqual(["'self'"]);
  });

  it('disables object-src', () => {
    expect(DEFAULT_CSP['object-src']).toEqual(["'none'"]);
  });

  it('blocks framing entirely', () => {
    expect(DEFAULT_CSP['frame-ancestors']).toEqual(["'none'"]);
  });

  it('keeps scripts strictly self-hosted', () => {
    expect(DEFAULT_CSP['script-src']).toEqual(["'self'"]);
  });
});

describe('buildHelmetOptions', () => {
  it('returns contentSecurityPolicy.useDefaults=false (we own the policy)', () => {
    const opts = buildHelmetOptions({ env: baseEnv() });
    const csp = opts.contentSecurityPolicy as {
      useDefaults: boolean;
      directives: Record<string, string[] | null>;
    };
    expect(csp.useDefaults).toBe(false);
  });

  it('wires default-deny CSP directives', () => {
    const opts = buildHelmetOptions({ env: baseEnv() });
    const directives = (opts.contentSecurityPolicy as {
      directives: Record<string, string[] | null>;
    }).directives;
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['form-action']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(directives['font-src']).toEqual(["'self'", 'data:']);
    expect(directives['connect-src']).toEqual(["'self'"]);
    expect(directives['upgrade-insecure-requests']).toEqual([]);
  });

  it('sets X-Frame-Options to deny', () => {
    const opts = buildHelmetOptions({ env: baseEnv() });
    expect(opts.xFrameOptions).toEqual({ action: 'deny' });
  });

  it('sets Cross-Origin-Resource-Policy to same-site', () => {
    const opts = buildHelmetOptions({ env: baseEnv() });
    expect(opts.crossOriginResourcePolicy).toEqual({ policy: 'same-site' });
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const opts = buildHelmetOptions({ env: baseEnv() });
    expect(opts.referrerPolicy).toEqual({ policy: 'strict-origin-when-cross-origin' });
  });

  it('omits strictTransportSecurity in development', () => {
    const opts = buildHelmetOptions({ env: baseEnv({ NODE_ENV: 'development' }) });
    expect(opts.strictTransportSecurity).toBeUndefined();
  });

  it('omits strictTransportSecurity in test', () => {
    const opts = buildHelmetOptions({ env: baseEnv({ NODE_ENV: 'test' }) });
    expect(opts.strictTransportSecurity).toBeUndefined();
  });

  it('sets strictTransportSecurity in production with default 1y maxAge and includeSubDomains', () => {
    const opts = buildHelmetOptions({ env: baseEnv({ NODE_ENV: 'production' }) });
    expect(opts.strictTransportSecurity).toEqual({
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    });
  });

  it('honors custom HSTS_MAX_AGE_SECONDS and HSTS_INCLUDE_SUBDOMAINS=false in prod', () => {
    const opts = buildHelmetOptions({
      env: baseEnv({
        NODE_ENV: 'production',
        HSTS_MAX_AGE_SECONDS: 86_400,
        HSTS_INCLUDE_SUBDOMAINS: false,
      }),
    });
    expect(opts.strictTransportSecurity).toEqual({
      maxAge: 86_400,
      includeSubDomains: false,
      preload: false,
    });
  });

  it('uses override CSP when HELMET_CSP_DIRECTIVES is set', () => {
    const opts = buildHelmetOptions({
      env: baseEnv({
        HELMET_CSP_DIRECTIVES: JSON.stringify({
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'"],
        }),
      }),
    });
    const directives = (opts.contentSecurityPolicy as {
      directives: Record<string, string[] | null>;
    }).directives;
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    // Frame-ancestors / object-src / base-uri from defaults should NOT carry over.
    expect(directives['frame-ancestors']).toBeUndefined();
    expect(directives['object-src']).toBeUndefined();
  });

  it('throws when HELMET_CSP_DIRECTIVES is malformed JSON', () => {
    expect(() =>
      buildHelmetOptions({
        env: baseEnv({ HELMET_CSP_DIRECTIVES: '{bad' }),
      }),
    ).toThrow();
  });
});
