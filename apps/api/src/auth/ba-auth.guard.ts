// apps/api/src/auth/ba-auth.guard.ts
// GH #44: replaces JwtAuthGuard for BA-era session validation. The Quart-
// minted JWT pair (access + refresh) issued by LoginController is gone
// — BA now issues its own session tokens via /auth/sign-in/*, and this
// guard validates them by calling BA's own getSession API. Mobile and
// admin web clients keep sending `Authorization: Bearer <token>`; BA's
// 1.0.20 `getSession` accepts the same shape, so no client-side change
// is required for the swap.
//
// `AuthUser` / `TenantContext` populated downstream stay shape-compatible
// with JwtAuthGuard so RbacGuard, MfaGuard, AuditInterceptor, and the
// controllers remain unaware of the underlying auth source. `req.user.id`
// and `req.tenant.userId` carry BA's user.id — the BA `user` table is now
// the source of truth for the authenticated principal. The legacy Quart
// `users.id` mapping is a follow-up (GH #45).
//
// Audit chain integration (GH #34 ba-audit.hook) is unaffected: BA's
// `databaseHooks.session.create.after` runs BEFORE this guard (the row
// exists by the time getSession returns), and downstream controllers'
// audit writes still key off `req.user.id`.

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the Reflector constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { TenantContext } from '@quart/shared-types';
import type { FastifyRequest } from 'fastify';

// Value (not `import type`) — `new BaAuthGuard(...)` in tests needs the
// runtime class, and DI needs `design:paramtypes` to resolve AuthService.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';
import type { AuthUser } from './decorators/current-user.decorator.js';
// Value (not `import type`) for the same DI/test reasons as AuthService.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MfaService } from './mfa.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  // Under @nestjs/platform-fastify the wrapped request's top-level `id`
  // is Fastify's default (`'req-N'`); RequestIdMiddleware writes the real
  // request id onto `raw.id`. Read both so the audit chain's request_id
  // is populated, matching JwtAuthGuard's behaviour.
  id?: string;
  raw?: { id?: string };
  user?: AuthUser;
  tenant?: TenantContext;
}

type FastifyLikeRequest = FastifyRequest & RequestWithAuth;

/**
 * Subset of BA 1.0.20's `getSession` response we actually read. The full
 * type widens with plugins (organization, admin, …); this guard only
 * needs the canonical session+user fields populated by the BA core.
 *
 * Verified against better-auth 1.0.20 (better-auth/dist/auth-B_LFm6_Y
 * .d.ts — `getSession: ... Promise<{ session: Session; user: User }>`).
 */
interface BaSessionResponse {
  session: {
    id: string;
    userId: string;
    token?: string;
    expiresAt?: Date | string;
  };
  user: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  };
}

@Injectable()
export class BaAuthGuard implements CanActivate {
  private readonly logger = new Logger(BaAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
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

    // Re-broadcast the inbound Authorization to BA. getSession accepts a
    // Web-standard Headers instance; building one preserves the bearer
    // so BA resolves the session without us re-parsing the token.
    const headers = new Headers();
    headers.set('authorization', header);

    let session: BaSessionResponse | null;
    try {
      session = (await this.auth.instance.api.getSession({
        headers,
      })) as BaSessionResponse | null;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'ba auth guard: getSession failed');
      throw new UnauthorizedException({
        error: { code: 'auth.session_invalid', message: 'session invalid' },
      });
    }

    if (!session) {
      throw new UnauthorizedException({
        error: { code: 'auth.session_invalid', message: 'session invalid' },
      });
    }

    await this.attachUserAndTenant(req, session);
    return true;
  }

  // GH #45 follow-up: pull MFA state from `mfa_credentials` so MfaGuard
  // can gate officer endpoints without a bearer claim. `getMfaState`
  // reads `enrolled_at` + `verified_at` in a tenant tx — with BA
  // sessions we have no city_id, so RLS scopes the read to zero rows
  // until BA users get a city-resolution path. The lookup is best-effort:
  // any failure (RLS, missing row, DB hiccup) leaves `mfaEnrolledAt`
  // and `mfaVerifiedAt` undefined, which MfaGuard treats as "not
  // enrolled" — a fail-closed default that protects officer endpoints
  // even when this guard can't reach the DB.
  private async attachUserAndTenant(req: RequestWithAuth, session: BaSessionResponse): Promise<void> {
    // BA's `user.id` is now the canonical principal identifier. The
    // cityId slot stays empty-string — matches JwtAuthGuard's behaviour
    // for users with no default_city_id (see session.service.ts:108
    // `city_id: cityId ?? ''`). Downstream code that needs a real city
    // reads it from the user's `default_city_id` row, same as before.
    const requestId = req.raw?.id ?? req.id ?? '';
    const userId = session.user.id;
    const user: AuthUser = {
      id: userId,
      cityId: '',
      isSuperAdmin: false,
      roleSnapshot: [],
      requestId,
      // BA's session row id (not a JWT `jti`). sign-out.service.ts:47
      // keys the auth_sessions revoke on `user.sessionId`; for BA
      // sessions we wire BA's session id so the revoke becomes a real
      // UPDATE instead of a silent no-op. GH #45 will replace this
      // code path with delegation to BA's /sign-out, but until then
      // the session row exists and the revoke should fire.
      sessionId: session.session.id,
    };

    try {
      const state = await this.mfa.getMfaState(userId, '');
      if (state.enrolledAt) user.mfaEnrolledAt = state.enrolledAt.getTime();
      if (state.verifiedAt) user.mfaVerifiedAt = state.verifiedAt.getTime();
    } catch (err) {
      // Best-effort lookup — swallow the error so the request continues.
      // MfaGuard's `!user.mfaEnrolledAt` branch is the fail-closed gate.
      this.logger.warn(
        { err: String(err), userId },
        'ba auth guard: mfa state lookup failed; defaulting to not enrolled',
      );
    }

    const tenant: TenantContext = {
      cityId: '',
      userId,
      isSuperAdmin: false,
      requestId,
    };
    req.user = user;
    req.tenant = tenant;
  }
}