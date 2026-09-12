import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService, type VerifiedJwt } from './jwt.service.js';
// Value (not `import type`) for the same reason as DbService.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ValkeyService } from './valkey.service.js';

// Ponytail: JWT `jti` IS the `auth_sessions.id` (UUID). Documented constraint
// in the T16 plan; the guard joins claims->session via this single key. If a
// future token scheme uses a separate nonce, swap this for a (sub, fp) lookup.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
    private readonly valkey: ValkeyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = (req.headers.authorization ?? req.headers.Authorization) as string | undefined;
    if (!header || !header.startsWith('Bearer ')) return false;

    const token = header.slice(7);
    let claims: VerifiedJwt;
    try {
      claims = await this.jwt.verify(token);
    } catch {
      this.logger.warn({ reason: 'jwt_verify_failed' }, 'jwt auth guard: verification failed');
      return false;
    }

    const jti = claims.jti;
    if (!jti) return false;

    // Valkey cache check (fail-closed). Cached values:
    //   'ok'       -> DB says session valid
    //   'revoked'  -> DB says session revoked (deny without DB round-trip)
    //   null       -> cache miss -> fall through to DB
    try {
      const cached = await this.valkey.getSession(jti);
      if (cached === 'revoked') return false;
      if (cached === 'ok') {
        (req as unknown as { tenant: VerifiedJwt }).tenant = claims;
        return true;
      }
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'valkey unavailable - fail-closed');
      return false;
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
      try { await this.valkey.setSession(jti, 'revoked', 60); } catch { /* ignore */ }
      return false;
    }

    if (new Date(session.absolute_expires_at as unknown as string).getTime() < Date.now()) {
      try { await this.valkey.setSession(jti, 'revoked', 60); } catch { /* ignore */ }
      return false;
    }

    // Positive cache. Short TTL — JWT lifetime bounds the true expiry.
    try { await this.valkey.setSession(jti, 'ok', 60); } catch { /* ignore */ }

    (req as unknown as { tenant: VerifiedJwt }).tenant = claims;
    return true;
  }
}