import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JwtService } from '../../src/auth/jwt.service.js';

const privHex = randomBytes(32).toString('hex');

const fullClaims = {
  sub: 'user-1',
  city_id: 'city-1',
  scope_type: 'city' as const,
  scope_id: 'city-1',
  role_snapshot: ['citizen'],
  device_fingerprint: null,
};

describe('JwtService', () => {
  it('round-trips a signed JWT and validates it', async () => {
    const svc = new JwtService({
      env: { JWT_SIGNING_KEY: privHex, JWT_ISSUER: 'quart.app' },
    } as never);
    const token = await svc.sign(fullClaims, { jti: 's-1', ttlSeconds: 60 });
    const claims = await svc.verify(token);
    expect(claims.sub).toBe('user-1');
    expect((claims as { city_id: string }).city_id).toBe('city-1');
    expect(claims.jti).toBe('s-1');
    expect(claims.iss).toBe('quart.app');
  });

  it('rejects a tampered token', async () => {
    const svc = new JwtService({
      env: { JWT_SIGNING_KEY: privHex, JWT_ISSUER: 'quart.app' },
    } as never);
    const token = await svc.sign(
      { ...fullClaims, sub: 'u', city_id: 'c', scope_id: 'c', role_snapshot: [] },
      { jti: 'j', ttlSeconds: 60 },
    );
    const bad = token.slice(0, -2) + 'AA';
    await expect(svc.verify(bad)).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const svcA = new JwtService({
      env: { JWT_SIGNING_KEY: privHex, JWT_ISSUER: 'quart.app' },
    } as never);
    const otherHex = randomBytes(32).toString('hex');
    const svcB = new JwtService({
      env: { JWT_SIGNING_KEY: otherHex, JWT_ISSUER: 'quart.app' },
    } as never);
    const token = await svcA.sign(
      { ...fullClaims, sub: 'u', city_id: 'c', scope_id: 'c', role_snapshot: [] },
      { jti: 'j', ttlSeconds: 60 },
    );
    await expect(svcB.verify(token)).rejects.toThrow();
  });
});
