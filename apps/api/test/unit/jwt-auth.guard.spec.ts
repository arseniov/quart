import { describe, it, expect, vi } from 'vitest';

import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import type { JwtService } from '../../src/auth/jwt.service.js';
import type { ValkeyService } from '../../src/auth/valkey.service.js';
import type { DbService } from '../../src/db/db.service.js';

describe('JwtAuthGuard', () => {
  const claims = {
    sub: 'u-1',
    city_id: 'c-1',
    scope_type: 'city' as const,
    scope_id: 'c-1',
    role_snapshot: ['citizen'],
    device_fingerprint: null,
  };
  const validToken = 'valid.jwt.token';
  const req: unknown = { headers: { authorization: `Bearer ${validToken}` } };

  function build(svc: JwtService, db: DbService, valkey: ValkeyService): JwtAuthGuard {
    return new JwtAuthGuard(svc, db, valkey);
  }

  function makeCtx(request: unknown): { switchToHttp: () => { getRequest: () => unknown; getResponse: () => unknown } } {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status: () => undefined }),
      }),
    };
  }

  it('rejects when Authorization header is missing', async () => {
    const g = build({ verify: vi.fn() } as never, {} as never, {} as never);
    await expect(g.canActivate(makeCtx({ headers: {}, url: '/x' }))).resolves.toBe(false);
  });

  it('rejects when JWT verify throws', async () => {
    const jwt = { verify: vi.fn(async () => { throw new Error('bad sig'); }) } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = {} as ValkeyService;
    const g = build(jwt, db, valkey);
    await expect(g.canActivate(makeCtx(req))).resolves.toBe(false);
  });

  it('rejects when session is revoked in DB', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-1' })) } as unknown as JwtService;
    const db = {
      kysely: {
        selectFrom: vi.fn(() => ({
          selectAll: vi.fn(() => ({
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                executeTakeFirst: vi.fn(async () => ({ id: 'sess-1', revoked_at: new Date() })),
              })),
            })),
          })),
        })),
      },
    } as unknown as DbService;
    const valkey = {} as ValkeyService;
    const g = build(jwt, db, valkey);
    await expect(g.canActivate(makeCtx(req))).resolves.toBe(false);
  });

  it('rejects when Valkey throws (fail-closed)', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-2' })) } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = { getSession: vi.fn(async () => { throw new Error('valkey down'); }) } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    await expect(g.canActivate(makeCtx(req))).resolves.toBe(false);
  });

  it('accepts a valid token with valid session', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-3' })) } as unknown as JwtService;
    const db = {
      kysely: {
        selectFrom: vi.fn(() => ({
          selectAll: vi.fn(() => ({
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                executeTakeFirst: vi.fn(async () => ({ id: 'sess-3', revoked_at: null })),
              })),
            })),
          })),
        })),
      },
    } as unknown as DbService;
    const valkey = { getSession: vi.fn(async () => 'ok') } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    await expect(g.canActivate(makeCtx(req))).resolves.toBe(true);
  });
});