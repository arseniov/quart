import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the Reflector constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { TenantContext } from '@quart/shared-types';
import type { FastifyRequest } from 'fastify';

/* eslint-disable import/order */
import type { AuthUser } from './decorators/current-user.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService, type VerifiedJwt } from './jwt.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ValkeyService } from './valkey.service.js';
/* eslint-enable import/order */

interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
  user?: AuthUser;
  tenant?: TenantContext;
}

type FastifyLikeRequest = FastifyRequest & RequestWithAuth;

// Short TTL — JWT lifetime bounds the true expiry.
const SESSION_CACHE_TTL_SECONDS = 60;

// Ponytail: JWT `jti` IS the `auth_sessions.id` (UUID). Documented constraint
// in the T16 plan; the guard joins claims->session via this single key. If a
// future token scheme uses a separate nonce, swap this for a (sub, fp) lookup.
//
// Ponytail: `auth_sessions` has no RLS (verified — 0011_rls.up.sql and
// 0015_super_admin_read_bypass.up.sql omit it; Better Auth owns the table
// and reads it globally). A bare `this.db.kysely` read is correct; no
// runInTenantTx wrap needed. Re-check if 00xx adds policies to this table.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
    private readonly valkey: ValkeyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<FastifyLikeRequest>();
    const header = (req.headers.authorization ?? req.headers.Authorization) as string | undefined;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: { code: 'auth.missing', message: 'authorization header required' },
      });
    }

    const token = header.slice(7);
    let claims: VerifiedJwt;
    try {
      claims = await this.jwt.verify(token);
    } catch {
      this.logger.warn({ reason: 'jwt_verify_failed' }, 'jwt auth guard: verification failed');
      throw new UnauthorizedException({
        error: { code: 'auth.invalid', message: 'jwt verification failed' },
      });
    }

    const jti = claims.jti;
    if (!jti) {
      throw new UnauthorizedException({
        error: { code: 'auth.invalid', message: 'jwt missing jti claim' },
      });
    }

    // Valkey cache check (fail-closed). Cached values:
    //   'ok'       -> DB says session valid
    //   'revoked'  -> DB says session revoked (deny without DB round-trip)
    //   null       -> cache miss -> fall through to DB
    try {
      const cached = await this.valkey.getSession(jti);
      if (cached === 'revoked') {
        throw new UnauthorizedException({
          error: { code: 'auth.session_revoked', message: 'session has been revoked' },
        });
      }
      if (cached === 'ok') {
        this.attachUserAndTenant(req, claims);
        return true;
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn({ err: String(err) }, 'valkey unavailable - fail-closed');
      throw new UnauthorizedException({
        error: { code: 'auth.cache_unavailable', message: 'session cache unavailable' },
      });
    }

    // DB session check (source of truth).
    const session = await this.db.kysely
      .selectFrom('auth_sessions')
      .selectAll()
      .where('id', '=', jti)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    if (!session) {
      // Negative cache so a revoked/missing session short-circuits subsequent
      // requests. TTL kept short; absolute_expires_at is the source of truth.
      await this.cacheNegative(jti);
      throw new UnauthorizedException({
        error: { code: 'auth.session_revoked', message: 'session has been revoked' },
      });
    }

    if (session.absolute_expires_at.getTime() < Date.now()) {
      await this.cacheNegative(jti);
      throw new UnauthorizedException({
        error: { code: 'auth.session_expired', message: 'session has expired' },
      });
    }

    // Device fingerprint check (mobile clients bind the token to a device).
    // Fastify lowercases header names; the uppercase form is unreachable in
    // practice but the docs allow `string | string[] | undefined`.
    const fpHeader = req.headers['x-device-fingerprint'] as string | string[] | undefined;
    const fpHeaderStr = Array.isArray(fpHeader) ? fpHeader[0] : fpHeader;
    if (claims.device_fingerprint && fpHeaderStr) {
      const a = Buffer.from(claims.device_fingerprint);
      const b = Buffer.from(fpHeaderStr);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedException({
          error: {
            code: 'auth.fingerprint_mismatch',
            message: 'device fingerprint does not match session',
          },
        });
      }
    }

    // Positive cache. Short TTL — JWT lifetime bounds the true expiry.
    try { await this.valkey.setSession(jti, 'ok', SESSION_CACHE_TTL_SECONDS); } catch { /* ignore */ }

    this.attachUserAndTenant(req, claims);
    return true;
  }

  private async cacheNegative(jti: string): Promise<void> {
    try {
      await this.valkey.setSession(jti, 'revoked', SESSION_CACHE_TTL_SECONDS);
    } catch {
      // best-effort cache write; fail-closed already happened at lookup
    }
  }

  private attachUserAndTenant(req: RequestWithAuth, claims: VerifiedJwt): void {
    // T16 plan §3: `req.user` carries auth claims; `req.tenant` carries the
    // RLS context. `isSuperAdmin` defaults to false until a future task
    // promotes a role-bit in `role_snapshot`.
    const user: AuthUser = {
      id: claims.sub,
      cityId: claims.city_id,
      isSuperAdmin: false,
      roleSnapshot: claims.role_snapshot ?? [],
    };
    const tenant: TenantContext = {
      cityId: claims.city_id,
      userId: claims.sub,
      isSuperAdmin: false,
      requestId: req.id ?? '',
    };
    req.user = user;
    req.tenant = tenant;
  }
}