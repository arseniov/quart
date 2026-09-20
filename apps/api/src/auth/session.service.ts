// apps/api/src/auth/session.service.ts
// GH #30 spec-review follow-up (was gap 2 — "reuse the existing createSession
// helper"). Phone-OTP /verify + BA's `databaseHooks.session.create.after`
// both call this helper so the audit chain (auth_sessions row + session_created
// HMAC row) lands atomically and in the same order regardless of caller.
// GH #45: dropped the JWT minting path — Better Auth owns the bearer, and
// the mobile (GH #46) will call BA's /sign-in/* endpoints directly. The
// `auth_sessions` row stays as a write-only audit artifact.
//
// Two-phase write:
//
//  1. Tenant tx (when the user has a default_city_id): INSERT into
//     `auth_sessions` + write the `session_created` audit row in the SAME
//     transaction so the chain entry can never outlive (or predate) the
//     session it describes.
//
//  2. Fallback to writeSystem when no city context exists yet: the INSERT
//     itself is fine outside the tenant tx (auth_sessions has no RLS), but
//     the chain needs to land somewhere — the sentinel city carries it.

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService, tryParseUuid } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

// Absolute expiry window for the `auth_sessions` row. BA's own session
// cookie drives runtime auth now (BaAuthGuard), so this row is a write-only
// audit artifact — the row exists so chain walks can correlate a session
// row to the BA session that produced it, but no guard reads it.
const SESSION_ROW_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionUser {
  id: string;
  handle: string;
  display_name: string;
  email: string | null;
  phone_e164: string | null;
  avatar_url: string | null;
  preferred_locale: string;
  city_id: string | null;
  needs_onboarding: boolean;
  roles: string[];
}

export interface SessionUserRow {
  id: string;
  handle: string;
  display_name: string;
  email: string | null;
  phone_e164: string | null;
  avatar_url: string | null;
  locale: string;
  default_city_id: string | null;
}

export interface CreateSessionInput {
  user: SessionUserRow;
  roles: string[];
  ip: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
  requestId: string | null;
  /** Merged into the `session_created` audit payload (e.g. `{ via: 'phone_otp' }`). */
  auditPayload: Record<string, unknown>;
}

export interface CreateSessionResult {
  /** The Quart user projection — same shape BA's mobile session needs. */
  user: SessionUser;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Persist a `session_created` audit row + an `auth_sessions` row keyed
   * to the BA session id that just produced it. Returns the Quart user
   * projection; no tokens are minted (BA's bearer is the runtime auth
   * surface, and GH #46's mobile callers will use BA's /sign-in/* endpoints
   * directly).
   */
  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const { user, roles, ip, userAgent, deviceFingerprint, requestId, auditPayload } = input;
    const cityId = user.default_city_id;

    // Fresh session id + absolute expiry. The row is a write-only audit
    // artifact — chain walks correlate it back to the BA session via
    // `auditPayload.ba_session_id` for BA-driven sign-ins.
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_ROW_TTL_SECONDS * 1000);

    if (cityId) {
      // Happy path — user has a city. runInTenantTx keeps RLS GUCs set
      // for the INSERT + audit, both of which happen in the same tx.
      await this.db.runInTenantTx(this.tenantCtx(cityId, user.id, requestId), async (trx) => {
        await trx
          .insertInto('auth_sessions')
          .values({
            id: sessionId,
            user_id: user.id,
            device_fingerprint: deviceFingerprint,
            ip,
            user_agent: userAgent ?? '',
            absolute_expires_at: expiresAt,
          } as never)
          .execute();

        await this.audit.write(trx, {
          tenant: this.tenantCtx(cityId, user.id, requestId),
          action: 'session_created',
          targetType: 'session',
          targetId: sessionId,
          payload: {
            ...auditPayload,
            device_fingerprint: deviceFingerprint,
          },
          ip,
          userAgent,
        });
      });
    } else {
      // No city yet — fall back to writeSystem for the session row
      // audit. auth_sessions has no RLS so the INSERT itself is fine
      // outside the tenant tx, but the chain needs to land somewhere.
      await this.db.kysely
        .insertInto('auth_sessions')
        .values({
          id: sessionId,
          user_id: user.id,
          device_fingerprint: deviceFingerprint,
          ip,
          user_agent: userAgent ?? '',
          absolute_expires_at: expiresAt,
        } as never)
        .execute();

      await this.audit.writeSystem(this.db.kysely, {
        action: 'session_created',
        targetType: 'session',
        targetId: sessionId,
        payload: {
          ...auditPayload,
          device_fingerprint: deviceFingerprint,
        },
        requestId,
        ip,
        userAgent,
      });
    }

    return {
      user: {
        id: user.id,
        handle: user.handle,
        display_name: user.display_name,
        email: user.email,
        phone_e164: user.phone_e164,
        avatar_url: user.avatar_url,
        preferred_locale: user.locale,
        city_id: cityId,
        // Mirrors the mobile's onboarding-gate logic: no city → user must
        // pick one before the map / tabs are usable. See app/(app)/_layout.tsx.
        needs_onboarding: !cityId,
        roles,
      },
    };
  }

  private tenantCtx(cityId: string, userId: string, requestId: string | null): TenantContext {
    return {
      cityId,
      userId,
      isSuperAdmin: false,
      // audit_log.request_id is uuid-typed; non-UUIDs from middleware
      // (e.g. `req-abc12345`) coerce to NULL so the insert doesn't 22P02.
      // tryParseUuid returns `null` for non-UUID inputs — the TenantContext
      // contract still requires a string field, so fall back to ''.
      requestId: tryParseUuid(requestId) ?? '',
    };
  }
}