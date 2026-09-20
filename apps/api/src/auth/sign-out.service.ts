// apps/api/src/auth/sign-out.service.ts
// GH #45: Sign-out now delegates the actual session revoke to Better Auth's
// /sign-out (auth.instance.api.signOut({ headers })), which removes the BA
// session row + cookie. The `auth_sessions` row that SessionService wrote on
// sign-in is no longer the runtime cache for a guard — it's a write-only
// audit artifact that stays around for correlation, so we don't revoke it.
//
// We still write the `auth.sign_out` audit row (GH #32 invariant) tagged
// `via: 'quart_sign_out'` so the §3.8 chain sees the Quart-side event;
// BA's plugin matcher fires independently with `via: 'ba_sign_out'` for
// any caller that hits BA's /sign-out directly (admin web app, SDK).
import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';
import type { AuthUser } from './decorators/current-user.decorator.js';

@Injectable()
export class SignOutService {
  private readonly logger = new Logger(SignOutService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  /**
   * Forward the caller's Authorization header into BA's `/sign-out` so the
   * BA session row + cookie are invalidated server-side. Writes the
   * `auth.sign_out` audit row afterwards so the chain reflects the
   * Quart-side event regardless of BA's response shape.
   *
   * BA failure is non-fatal: a 401 from BA just means the session was
   * already gone (concurrent sign-out, expired cookie) — the caller still
   * gets a 204 and the audit row lands.
   */
  async signOut(user: AuthUser, requestId: string | undefined, authorization: string | undefined): Promise<void> {
    const sessionId = user.sessionId ?? null;

    if (authorization) {
      const headers = new Headers();
      headers.set('authorization', authorization);
      try {
        await this.auth.instance.api.signOut({ headers });
      } catch (err) {
        this.logger.warn(
          { err: String(err), userId: user.id },
          'sign-out: BA signOut failed (non-fatal — likely already revoked)',
        );
      }
    }

    try {
      await this.audit.writeSystem(this.db.kysely, {
        action: 'auth.sign_out',
        targetType: 'session',
        targetId: sessionId ? `ba:${sessionId}` : `user:${user.id}`,
        payload: { via: 'quart_sign_out', user_id: user.id, ba_session_id: sessionId },
        // SystemAuditEvent expects `string | null` (the request id either
        // parses as a UUID or is null — never undefined). The controller
        // forwards `req.id` which can be undefined for some Fastify edge
        // cases, so coerce here.
        requestId: requestId ?? null,
        ip: null,
        userAgent: null,
      });
    } catch (err) {
      this.logger.warn({ err: String(err), userId: user.id }, 'sign-out: audit write failed (non-fatal)');
    }
  }
}