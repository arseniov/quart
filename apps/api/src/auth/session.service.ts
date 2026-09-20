// apps/api/src/auth/session.service.ts
// GH #30 spec-review follow-up (was gap 2 — "reuse the existing createSession
// helper"). Phone-OTP /verify is the first session-issuing controller; the
// forthcoming email-login controller will return the same shape and call this
// same helper. The audit chain (auth_sessions row + session_created HMAC row)
// is unforgiving — both halves must land atomically and in the same order
// regardless of the caller, otherwise a chain walk across two controllers
// diverges.
//
// Two-phase write (unchanged from the prior inline implementation):
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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService, type JwtClaims } from './jwt.service.js';
import type { SessionResponse, SessionUser } from './session.dto.js';

// Access TTL (1h) matches the lifetime used elsewhere in the stack for
// short-lived JWTs; refresh TTL (30d) is the same window Quart's
// `auth_sessions.absolute_expires_at` accepts. The two sign() calls share
// the same `jti` (== sessionId) so JwtAuthGuard reads one auth_sessions
// row regardless of which token the caller presents, but differ in TTL
// so a stolen access token can't outlive its short window. Refresh
// reuse is enforced at the auth_sessions row level (30d), not the JWT.
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

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

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Mint a fresh session for `user` and return tokens + the Quart user
   * projection. Mirrors the email-login contract (forthcoming) so the
   * mobile client can switch flows without changing its parsing.
   */
  async createSession(input: CreateSessionInput): Promise<SessionResponse> {
    const { user, roles, ip, userAgent, deviceFingerprint, requestId, auditPayload } = input;
    const cityId = user.default_city_id;

    // Fresh session id + absolute expiry. The session row is the source
    // of truth for "is this session alive"; JwtAuthGuard reads it on every
    // request. `last_seen_at` is stamped by the guard on each authenticated
    // hit, so we leave it at the default (== created_at) here.
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

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

    // Sign two distinct JWTs. They share the same `jti` (== sessionId)
    // so JwtAuthGuard sees one session regardless of which the caller
    // presents — but they differ in TTL so a stolen access token can't
    // outlive its short window.
    const baseClaims: Omit<JwtClaims, never> = {
      sub: user.id,
      city_id: cityId ?? '',
      scope_type: 'city',
      scope_id: cityId,
      role_snapshot: roles,
      device_fingerprint: deviceFingerprint,
    };
    const accessToken = await this.jwt.sign(baseClaims, {
      jti: sessionId,
      ttlSeconds: ACCESS_TTL_SECONDS,
    });
    const refreshToken = await this.jwt.sign(baseClaims, {
      jti: sessionId,
      ttlSeconds: REFRESH_TTL_SECONDS,
    });

    const dto: SessionUser = {
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
    };

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      refresh_expires_at: expiresAt.toISOString(),
      user: dto,
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
