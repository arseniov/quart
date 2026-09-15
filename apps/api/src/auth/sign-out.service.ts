import { Injectable, Logger } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the AuditService + DbService + ValkeyService
// constructor parameters. Mirrors the pattern in magic-link.service.ts /
// password-reset.service.ts.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import { SESSION_CACHE_TTL_SECONDS } from './constants.js';
import type { AuthUser } from './decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ValkeyService } from './valkey.service.js';


/**
 * Revoke the caller's session: stamp `revoked_at` + `revoke_reason` on the
 * `auth_sessions` row, append an `auth.sign_out` audit row in the same
 * transaction, and poison the Valkey session cache so JwtAuthGuard denies
 * any subsequent request on this jti without a DB round-trip.
 *
 * Idempotent: the UPDATE carries `revoked_at IS NULL`, so a second call
 * for an already-revoked session is a no-op. The audit row is still
 * written on replay — "user explicitly signed out at T" is a fact the
 * chain wants to attest even if the revoke itself is a no-op.
 *
 * `auth_sessions` has no RLS (verified — 0011_rls.up.sql and
 * 0015_super_admin_read_bypass.up.sql omit it; Better Auth owns the
 * table). 0011 grants `SELECT, INSERT, UPDATE, DELETE` to `quart_app`,
 * so the UPDATE runs cleanly under the SET LOCAL ROLE issued by
 * runInTenantTx. The audit row goes in the same transaction so a
 * successful revoke always has a matching chain entry.
 */
@Injectable()
export class SignOutService {
  private readonly logger = new Logger(SignOutService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly valkey: ValkeyService,
  ) {}

  async signOut(user: AuthUser, requestId: string | undefined): Promise<void> {
    const jti = user.sessionId;
    // JwtAuthGuard always sets sessionId from claims.jti; if it's missing
    // we can't revoke anything. The guard would have already 401'd on a
    // JWT missing the jti claim, so this is a defensive no-op.
    if (!jti) return;

    await this.db.runInTenantTx(this.tenantCtx(user, requestId), async (trx) => {
      await trx
        .updateTable('auth_sessions')
        .set({ revoked_at: new Date(), revoke_reason: 'signout' } as never)
        .where('id', '=', jti)
        .where('revoked_at', 'is', null)
        .execute();

      // Audit regardless of whether the revoke matched: explicit sign-out
      // at time T is a fact, even if a replay sees the session already
      // revoked. (Audit chain verifier accounts for repeated action rows
      // on same target.)
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, requestId),
        action: 'auth.sign_out',
        targetType: 'session',
        targetId: jti,
        payload: { jti },
      });
    });

    // Best-effort cache poison. The DB row + the guard's fail-closed
    // behavior already enforce the revoke; the cache just shortens the
    // hot path. Failure here is non-fatal — a stale 'ok' line expires
    // in SESSION_CACHE_TTL_SECONDS at worst.
    try {
      await this.valkey.setSession(jti, 'revoked', SESSION_CACHE_TTL_SECONDS);
    } catch (err) {
      // Mirror jwt-auth.guard's pino-warn pattern: log once per failure
      // so cache outages are visible without breaking the request.
      this.logger.warn(
        { err: String(err), jti },
        'sign-out: valkey poison failed (DB is source of truth)',
      );
    }
  }

  private tenantCtx(user: AuthUser, requestId: string | undefined) {
    return {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: requestId ?? '',
    };
  }
}