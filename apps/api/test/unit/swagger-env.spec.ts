import { describe, expect, it } from 'vitest';

import {
  REDACTED,
  SwaggerEnvSchema,
  parseSwaggerServers,
  redactSecretNames,
  resolveSwaggerEnabled,
} from '../../src/openapi/swagger-env.js';

const baseEnv = (overrides: Record<string, unknown> = {}) =>
  SwaggerEnvSchema.parse(overrides);

describe('SwaggerEnvSchema', () => {
  describe('defaults', () => {
    it('defaults NODE_ENV to development', () => {
      expect(baseEnv().NODE_ENV).toBe('development');
    });

    it('SWAGGER_ENABLED is unset by default (unset → NODE_ENV decides)', () => {
      expect(baseEnv().SWAGGER_ENABLED).toBeUndefined();
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

    it('defaults SWAGGER_DESCRIPTION to the T45 spec literal', () => {
      expect(baseEnv().SWAGGER_DESCRIPTION).toBe('Mobile + Admin shared API');
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

  it('respects explicit opt-out in development (SWAGGER_ENABLED=false)', () => {
    // Devs sometimes want the surface off (e.g. focused perf testing).
    expect(
      resolveSwaggerEnabled(baseEnv({ NODE_ENV: 'development', SWAGGER_ENABLED: false })),
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

  it('drops invalid URLs instead of emitting a broken spec', () => {
    expect(parseSwaggerServers('not-a-url,https://b.example.com')).toEqual([
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

describe('redactSecretNames', () => {
  it('returns empty string unchanged', () => {
    expect(redactSecretNames('')).toBe('');
  });

  it('redacts SECRET_FOO=value pairs entirely (name + value)', () => {
    expect(redactSecretNames('debug token: SECRET_FOO=abc123')).toBe(
      `debug token: ${REDACTED}`,
    );
  });

  it('is case-insensitive', () => {
    expect(redactSecretNames('lowercase secret_foo=abc')).toBe(
      `lowercase ${REDACTED}`,
    );
  });

  it('redacts multiple secret patterns', () => {
    expect(redactSecretNames('SECRET_A=1, TOKEN_B=2')).toBe(`${REDACTED}, ${REDACTED}`);
  });

  it('matches API_KEY and PASSWORD prefixes', () => {
    expect(redactSecretNames('API_KEY=xyz PASSWORD=hunter2')).toBe(
      `${REDACTED} ${REDACTED}`,
    );
  });

  it('leaves non-secret text alone', () => {
    expect(redactSecretNames('Quart API for city citizens')).toBe(
      'Quart API for city citizens',
    );
  });

  it('does not redact bare names without an =value', () => {
    // Names without values are left alone — the rule is "no NAME=value
    // pair leaks", not "no name leaks". Bare mentions like
    // "see TOKEN in env" are fine.
    expect(redactSecretNames('set TOKEN in your .env')).toBe(
      'set TOKEN in your .env',
    );
  });
});