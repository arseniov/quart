import { describe, expect, it } from 'vitest';

import {
  SecurityEnvSchema,
  normalizeOrigin,
  parseAllowedOrigins,
  parseCspDirectives,
} from '../../src/security/security-env.js';

const BASE = {
  // All optional fields omitted — exercise the defaults.
};

describe('SecurityEnvSchema', () => {
  it('defaults NODE_ENV to development', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.NODE_ENV).toBe('development');
  });

  it('defaults CORS_ALLOWED_ORIGINS to empty string (no CORS)', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.CORS_ALLOWED_ORIGINS).toBe('');
  });

  it('defaults CORS_ALLOW_CREDENTIALS to false', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.CORS_ALLOW_CREDENTIALS).toBe(false);
  });

  it('defaults MAX_REQUEST_BODY_BYTES to 12mb per spec', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.MAX_REQUEST_BODY_BYTES).toBe(12 * 1024 * 1024);
  });

  it('defaults HSTS_MAX_AGE_SECONDS to 1 year (31536000)', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.HSTS_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it('defaults HSTS_INCLUDE_SUBDOMAINS to true', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.HSTS_INCLUDE_SUBDOMAINS).toBe(true);
  });

  it('defaults HSTS_PRELOAD to false', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.HSTS_PRELOAD).toBe(false);
  });

  it('defaults HELMET_ALLOW_INLINE_STYLES to false', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.HELMET_ALLOW_INLINE_STYLES).toBe(false);
  });

  it('defaults TRUST_PROXY to false', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('defaults COOKIE_SECRET to a 32+ char placeholder', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('defaults HELMET_CSP_DIRECTIVES to empty string', () => {
    const env = SecurityEnvSchema.parse({});
    expect(env.HELMET_CSP_DIRECTIVES).toBe('');
  });

  it('accepts NODE_ENV values', () => {
    for (const v of ['development', 'test', 'production']) {
      expect(SecurityEnvSchema.parse({ ...BASE, NODE_ENV: v }).NODE_ENV).toBe(v);
    }
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => SecurityEnvSchema.parse({ ...BASE, NODE_ENV: 'staging' })).toThrow();
  });

  it('parses CORS_ALLOW_CREDENTIALS from "true" / "false" strings', () => {
    expect(SecurityEnvSchema.parse({ CORS_ALLOW_CREDENTIALS: 'true' }).CORS_ALLOW_CREDENTIALS).toBe(true);
    expect(SecurityEnvSchema.parse({ CORS_ALLOW_CREDENTIALS: 'false' }).CORS_ALLOW_CREDENTIALS).toBe(false);
  });

  it('parses TRUST_PROXY from "true" / "false" strings', () => {
    expect(SecurityEnvSchema.parse({ TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(SecurityEnvSchema.parse({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('parses HSTS_PRELOAD from "true" / "false" strings', () => {
    expect(SecurityEnvSchema.parse({ HSTS_PRELOAD: 'true' }).HSTS_PRELOAD).toBe(true);
    expect(SecurityEnvSchema.parse({ HSTS_PRELOAD: 'false' }).HSTS_PRELOAD).toBe(false);
  });

  it('parses HELMET_ALLOW_INLINE_STYLES from "true" / "false" strings', () => {
    expect(SecurityEnvSchema.parse({ HELMET_ALLOW_INLINE_STYLES: 'true' }).HELMET_ALLOW_INLINE_STYLES).toBe(true);
    expect(SecurityEnvSchema.parse({ HELMET_ALLOW_INLINE_STYLES: 'false' }).HELMET_ALLOW_INLINE_STYLES).toBe(false);
  });

  it('parses MAX_REQUEST_BODY_BYTES size strings', () => {
    expect(SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '512kb' }).MAX_REQUEST_BODY_BYTES).toBe(512 * 1024);
    expect(SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '2mb' }).MAX_REQUEST_BODY_BYTES).toBe(2 * 1024 * 1024);
    expect(SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '1024' }).MAX_REQUEST_BODY_BYTES).toBe(1024);
    expect(SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '1.5mb' }).MAX_REQUEST_BODY_BYTES).toBe(Math.round(1.5 * 1024 * 1024));
  });

  it('rejects malformed MAX_REQUEST_BODY_BYTES values', () => {
    expect(() => SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: 'huge' })).toThrow();
    expect(() => SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '-1mb' })).toThrow();
    expect(() => SecurityEnvSchema.parse({ MAX_REQUEST_BODY_BYTES: '1tb' })).toThrow();
  });

  it('coerces HSTS_MAX_AGE_SECONDS to integer', () => {
    const env = SecurityEnvSchema.parse({ HSTS_MAX_AGE_SECONDS: '86400' });
    expect(env.HSTS_MAX_AGE_SECONDS).toBe(86400);
  });

  it('rejects negative HSTS_MAX_AGE_SECONDS', () => {
    expect(() => SecurityEnvSchema.parse({ HSTS_MAX_AGE_SECONDS: -1 })).toThrow();
  });

  it('rejects COOKIE_SECRET shorter than 32 chars', () => {
    expect(() => SecurityEnvSchema.parse({ COOKIE_SECRET: 'short' })).toThrow();
  });
});

describe('normalizeOrigin', () => {
  it('lowercases scheme and host', () => {
    expect(normalizeOrigin('HTTPS://App.Example')).toBe('https://app.example');
  });

  it('strips the default port (https:443, http:80)', () => {
    expect(normalizeOrigin('https://app.example:443')).toBe('https://app.example');
    expect(normalizeOrigin('http://app.example:80')).toBe('http://app.example');
  });

  it('preserves non-default ports', () => {
    expect(normalizeOrigin('https://app.example:8443')).toBe('https://app.example:8443');
  });

  it('returns a lowercased fallback for malformed input', () => {
    expect(normalizeOrigin('NOT-A-URL')).toBe('not-a-url');
  });
});

describe('parseAllowedOrigins', () => {
  it('returns empty set for empty string', () => {
    expect(parseAllowedOrigins('').size).toBe(0);
  });

  it('splits CSV origins, trims whitespace, drops empties', () => {
    const set = parseAllowedOrigins('https://a.example, https://b.example ,,');
    expect([...set].sort()).toEqual(['https://a.example', 'https://b.example']);
  });

  it('deduplicates repeated origins', () => {
    const set = parseAllowedOrigins('https://x,https://x,https://x');
    expect(set.size).toBe(1);
  });

  it('normalizes scheme + host case-insensitively (RFC 6454)', () => {
    const set = parseAllowedOrigins('https://App.Example');
    // Entries are stored normalized — lookup is case-sensitive on the set
    // itself; the delegator re-normalizes the incoming origin before
    // lookup, so case differences resolve at the comparison site (see
    // cors.spec.ts). Verify the stored value is the lowercased form.
    expect([...set]).toEqual(['https://app.example']);
  });

  it('throws on invalid URL entry with the offending value in the message', () => {
    expect(() => parseAllowedOrigins('not-a-url,https://ok.example')).toThrow(
      /CORS_ALLOWED_ORIGINS contains invalid URL: not-a-url/,
    );
  });
});

describe('parseCspDirectives', () => {
  it('returns undefined for empty / whitespace-only string', () => {
    expect(parseCspDirectives('')).toBeUndefined();
    expect(parseCspDirectives('   ')).toBeUndefined();
  });

  it('parses a directive map', () => {
    const out = parseCspDirectives('{"script-src":["\'self\'","\'unsafe-inline\'"]}');
    expect(out).toEqual({ 'script-src': ["'self'", "'unsafe-inline'"] });
  });

  it('preserves null directives as empty array', () => {
    const out = parseCspDirectives('{"object-src":null}');
    expect(out).toEqual({ 'object-src': [] });
  });

  it('throws on bad JSON', () => {
    expect(() => parseCspDirectives('{not json')).toThrow();
  });

  it('throws when JSON is an array, not an object', () => {
    expect(() => parseCspDirectives('["a","b"]')).toThrow(/must be a JSON object/);
  });

  it('throws when a directive value is not string[] / null', () => {
    expect(() => parseCspDirectives('{"script-src":"self"}')).toThrow(/string\[\]/);
    expect(() => parseCspDirectives('{"script-src":[1,2]}')).toThrow(/string\[\]/);
  });
});
