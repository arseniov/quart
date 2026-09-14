import { describe, expect, it } from 'vitest';

import { ThrottlerEnvSchema } from '../../src/security/throttler-env.js';

describe('ThrottlerEnvSchema', () => {
  describe('THROTTLE_ENABLED', () => {
    it('defaults to true', () => {
      const env = ThrottlerEnvSchema.parse({});
      expect(env.THROTTLE_ENABLED).toBe(true);
    });

    it('accepts "true" / "false" strings', () => {
      expect(ThrottlerEnvSchema.parse({ THROTTLE_ENABLED: 'true' }).THROTTLE_ENABLED).toBe(true);
      expect(ThrottlerEnvSchema.parse({ THROTTLE_ENABLED: 'false' }).THROTTLE_ENABLED).toBe(false);
    });

    it('accepts native booleans', () => {
      expect(ThrottlerEnvSchema.parse({ THROTTLE_ENABLED: true }).THROTTLE_ENABLED).toBe(true);
      expect(ThrottlerEnvSchema.parse({ THROTTLE_ENABLED: false }).THROTTLE_ENABLED).toBe(false);
    });
  });

  describe('THROTTLE_TTL_SECONDS', () => {
    it('defaults to 60', () => {
      expect(ThrottlerEnvSchema.parse({}).THROTTLE_TTL_SECONDS).toBe(60);
    });

    it('coerces string values to integers', () => {
      expect(ThrottlerEnvSchema.parse({ THROTTLE_TTL_SECONDS: '120' }).THROTTLE_TTL_SECONDS).toBe(120);
    });

    it('rejects zero or negative values', () => {
      expect(() => ThrottlerEnvSchema.parse({ THROTTLE_TTL_SECONDS: 0 })).toThrow();
      expect(() => ThrottlerEnvSchema.parse({ THROTTLE_TTL_SECONDS: -1 })).toThrow();
    });
  });

  describe('per-action limits', () => {
    it('uses the spec defaults', () => {
      const env = ThrottlerEnvSchema.parse({});
      expect(env.THROTTLE_LOGIN_LIMIT).toBe(5);
      expect(env.THROTTLE_SIGNUP_LIMIT).toBe(3);
      expect(env.THROTTLE_PASSWORD_RESET_LIMIT).toBe(3);
      expect(env.THROTTLE_MAGIC_LINK_LIMIT).toBe(5);
      expect(env.THROTTLE_MFA_LIMIT).toBe(10);
    });

    it('coerces string values to positive integers', () => {
      const env = ThrottlerEnvSchema.parse({
        THROTTLE_LOGIN_LIMIT: '7',
        THROTTLE_SIGNUP_LIMIT: '4',
      });
      expect(env.THROTTLE_LOGIN_LIMIT).toBe(7);
      expect(env.THROTTLE_SIGNUP_LIMIT).toBe(4);
    });

    it('rejects zero or negative limits', () => {
      expect(() => ThrottlerEnvSchema.parse({ THROTTLE_LOGIN_LIMIT: 0 })).toThrow();
      expect(() => ThrottlerEnvSchema.parse({ THROTTLE_LOGIN_LIMIT: -3 })).toThrow();
    });
  });

  describe('THROTTLE_DEFAULT_LIMIT', () => {
    it('defaults to 60 (generous baseline per spec)', () => {
      expect(ThrottlerEnvSchema.parse({}).THROTTLE_DEFAULT_LIMIT).toBe(60);
    });
  });

  describe('THROTTLE_VALKEY_URL', () => {
    it('defaults to empty string (in-memory storage)', () => {
      expect(ThrottlerEnvSchema.parse({}).THROTTLE_VALKEY_URL).toBe('');
    });

    it('accepts a redis:// URL', () => {
      expect(
        ThrottlerEnvSchema.parse({ THROTTLE_VALKEY_URL: 'redis://127.0.0.1:6379' }).THROTTLE_VALKEY_URL,
      ).toBe('redis://127.0.0.1:6379');
    });
  });

  it('parses a complete env object', () => {
    const env = ThrottlerEnvSchema.parse({
      THROTTLE_ENABLED: 'false',
      THROTTLE_TTL_SECONDS: '30',
      THROTTLE_LOGIN_LIMIT: '10',
      THROTTLE_SIGNUP_LIMIT: '5',
      THROTTLE_PASSWORD_RESET_LIMIT: '5',
      THROTTLE_MAGIC_LINK_LIMIT: '7',
      THROTTLE_MFA_LIMIT: '15',
      THROTTLE_DEFAULT_LIMIT: '120',
      THROTTLE_VALKEY_URL: 'redis://valkey:6379',
    });
    expect(env).toMatchObject({
      THROTTLE_ENABLED: false,
      THROTTLE_TTL_SECONDS: 30,
      THROTTLE_LOGIN_LIMIT: 10,
      THROTTLE_SIGNUP_LIMIT: 5,
      THROTTLE_PASSWORD_RESET_LIMIT: 5,
      THROTTLE_MAGIC_LINK_LIMIT: 7,
      THROTTLE_MFA_LIMIT: 15,
      THROTTLE_DEFAULT_LIMIT: 120,
      THROTTLE_VALKEY_URL: 'redis://valkey:6379',
    });
  });
});
