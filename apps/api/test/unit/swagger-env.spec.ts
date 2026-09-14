import { describe, expect, it } from 'vitest';

import {
  SwaggerEnvSchema,
  parseSwaggerServers,
  redactSecrets,
  resolveSwaggerEnabled,
} from '../../src/openapi/swagger-env.js';

const baseEnv = (overrides: Record<string, unknown> = {}) =>
  SwaggerEnvSchema.parse(overrides);

describe('SwaggerEnvSchema', () => {
  describe('defaults', () => {
    it('defaults NODE_ENV to development', () => {
      expect(baseEnv().NODE_ENV).toBe('development');
    });

    it('defaults SWAGGER_ENABLED to false (opt-in)', () => {
      expect(baseEnv().SWAGGER_ENABLED).toBe(false);
    });

    it('defaults SWAGGER_PATH to /docs', () => {
      expect(baseEnv().SWAGGER_PATH).toBe('/docs');
    });

    it('defaults SWAGGER_JSON_PATH to /openapi.json', () => {
      expect(baseEnv().SWAGGER_JSON_PATH).toBe('/openapi.json');
    });

    it('defaults SWAGGER_TITLE to "Quart API"', () => {
      expect(baseEnv().SWAGGER_TITLE).toBe('Quart API');
    });

    it('defaults SWAGGER_DESCRIPTION to empty string', () => {
      expect(baseEnv().SWAGGER_DESCRIPTION).toBe('');
    });

    it('defaults SWAGGER_VERSION to empty string (caller falls back to package.json)', () => {
      expect(baseEnv().SWAGGER_VERSION).toBe('');
    });

    it('defaults SWAGGER_SERVERS to empty string (no servers emitted)', () => {
      expect(baseEnv().SWAGGER_SERVERS).toBe('');
    });
  });

  describe('SWAGGER_ENABLED', () => {
    it('accepts native booleans', () => {
      expect(baseEnv({ SWAGGER_ENABLED: true }).SWAGGER_ENABLED).toBe(true);
      expect(baseEnv({ SWAGGER_ENABLED: false }).SWAGGER_ENABLED).toBe(false);
    });

    it('accepts "true" / "false" strings', () => {
      expect(baseEnv({ SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
      expect(baseEnv({ SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
    });
  });

  describe('SWAGGER_PATH', () => {
    it('accepts custom paths', () => {
      expect(baseEnv({ SWAGGER_PATH: '/api-docs' }).SWAGGER_PATH).toBe('/api-docs');
    });

    it('rejects empty paths', () => {
      expect(() => SwaggerEnvSchema.parse({ SWAGGER_PATH: '' })).toThrow();
    });
  });

  describe('SWAGGER_JSON_PATH', () => {
    it('accepts custom paths', () => {
      expect(baseEnv({ SWAGGER_JSON_PATH: '/spec/openapi.json' }).SWAGGER_JSON_PATH).toBe(
        '/spec/openapi.json',
      );
    });

    it('rejects empty paths', () => {
      expect(() => SwaggerEnvSchema.parse({ SWAGGER_JSON_PATH: '' })).toThrow();
    });
  });

  describe('NODE_ENV', () => {
    it('accepts the three env values', () => {
      for (const v of ['development', 'test', 'production']) {
        expect(baseEnv({ NODE_ENV: v }).NODE_ENV).toBe(v);
      }
    });

    it('rejects unknown NODE_ENV', () => {
      expect(() => SwaggerEnvSchema.parse({ NODE_ENV: 'staging' })).toThrow();
    });
  });
});

describe('resolveSwaggerEnabled', () => {
  it('returns false in production by default (security default-off)', () => {
    expect(resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('returns true in production when SWAGGER_ENABLED=true is set explicitly', () => {
    expect(
      resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: true })),
    ).toBe(true);
  });

  it('returns true in development even without explicit flag (dev convenience)', () => {
    expect(resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'development' }))).toBe(true);
  });

  it('returns true in test by default', () => {
    expect(resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'test' }))).toBe(true);
  });

  it('returns false in production even when SWAGGER_ENABLED=false is set explicitly', () => {
    expect(
      resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: false })),
    ).toBe(false);
  });
});

describe('parseSwaggerServers', () => {
  it('returns empty list for empty input', () => {
    expect(parseSwaggerServers('')).toEqual([]);
  });

  it('splits CSV into trimmed entries', () => {
    expect(parseSwaggerServers('https://a.example.com,https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('skips empty entries from double commas / trailing comma', () => {
    expect(parseSwaggerServers('https://a.example.com,,https://b.example.com,')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('dedupes entries', () => {
    expect(parseSwaggerServers('https://a.example.com,https://a.example.com')).toEqual([
      'https://a.example.com',
    ]);
  });

  it('trims whitespace', () => {
    expect(parseSwaggerServers('  https://a.example.com  , https://b.example.com ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

describe('redactSecrets', () => {
  it('returns empty string unchanged', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('redacts SECRET_* substrings, leaving the value intact', () => {
    // We mask the *name* (SECRET_FOO) — the value (=abc123) stays
    // so the description is still readable.
    expect(redactSecrets('debug token: SECRET_FOO=abc123')).toBe(
      'debug token: [redacted]=abc123',
    );
  });

  it('redacts multiple secret patterns', () => {
    expect(redactSecrets('SECRET_A=1, TOKEN_B=2')).toBe('[redacted]=1, [redacted]=2');
  });

  it('leaves non-secret text alone', () => {
    expect(redactSecrets('Quart API for city citizens')).toBe('Quart API for city citizens');
  });
});
