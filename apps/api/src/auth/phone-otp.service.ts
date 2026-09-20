// apps/api/src/auth/phone-otp.service.ts
// GH #30: phone-OTP /verify now mints a session in one step. Mirrors the
// (forthcoming) email-login response shape: short-lived access JWT +
// 30-day refresh JWT + the Quart `user` projection. Audit chain gets two
// rows — `phone_verified` (pre-tenant, sentinel city) and `session_created`
// (in-tenant so the chain lands under the user's city).
//
// The Quart users table is city-scoped under RLS. The phone lookup runs
// against `db.kysely` directly (the bootstrap pool role is a Postgres
// image SUPERUSER, which BYPASSRLSes — see 0011_rls.up.sql / 0040_*.up.sql).
// Everything that needs RLS-gated writes (session_created audit) then opens
// a `runInTenantTx` against the user's `default_city_id`.
import { createHash, randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below. Matches the
// pattern in magic-link.service.ts / mfa.service.ts.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService } from './jwt.service.js';
import type { JwtClaims } from './jwt.service.js';
import type {
  VerifyOtpSessionResponse,
  VerifyOtpSessionUser,
} from './phone-otp.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TwilioService } from './twilio.service.js';

// Access token TTL (1h) matches the lifetime used elsewhere in the stack
// for short-lived JWTs; refresh TTL (30d) is the same window Quart's
// `auth_sessions.absolute_expires_at` accepts. The refresh token is a
// SEPARATE sign (different jti) so revocation can target either.
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

// Reused across other auth services — same loose UUID regex used by
// RequestIdMiddleware, etc. Keeps `request_id` uuid-typed in audit_log
// without 22P02.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VerifyInput {
  phoneNumber: string;
  code: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
}

/**
 * Phone-OTP verification + session issuance. Two-phase write:
 *
 *  1. `phone_verified` audit row (sentinel city, pre-tenant) — captures
 *     the OTP-success event before any user lookup. Same pattern as
 *     magic-link.consume (gh #4) and password-reset.issue.
 *
 *  2. Inside `runInTenantTx` against the user's city: INSERT into
 *     `auth_sessions`, then write the `session_created` audit row in the
 *     SAME transaction so the session and its chain entry are atomic
 *     (a future revoker needs the row to exist for the audit to be true).
 *
 * The session id is the JWT `jti`; JwtAuthGuard reads auth_sessions by id
 * to authorise every subsequent request. If the city is null (the user
 * hasn't onboarded), session_created falls back to writeSystem — the
 * audit chain still needs the row, even if no city context exists yet.
 */
@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly twilio: TwilioService,
  ) {}

  async verifyAndIssueSession(
    input: VerifyInput,
  ): Promise<VerifyOtpSessionResponse> {
    // Twilio Verify holds the actual OTP comparison. A `false` here is
    // either a bad code or a code from a different phone — surface 422
    // without leaking which.
    const ok = await this.twilio.verifyOtp(input.phoneNumber, input.code);
    if (!ok) {
      throw new UnprocessableEntityException({
        error: { code: 'phone_otp.invalid_code', message: 'OTP code is invalid or expired' },
      });
    }

    // phone_verified — the OTP is valid; the user lookup can still fail.
    // Use a SHA-256 prefix of the phone as targetId so the chain row
    // stays within the varchar(64) audit_log.target_id column (raw E.164
    // runs up to 16 chars, so this is comfortably under the limit — but
    // using the hash keeps the format consistent with other auth chains
    // that store hashed identifiers).
    const phoneHash = createHash('sha256')
      .update(input.phoneNumber)
      .digest('hex')
      .slice(0, 40);
    await this.audit.writeSystem(this.db.kysely, {
      action: 'phone_verified',
      targetType: 'phone_otp',
      targetId: `phone:${phoneHash}`,
      payload: { channel: 'sms' },
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // User lookup. `users.phone_e164` is the canonical E.164 column
    // (BA's `user.phoneNumber` is a parallel identity we don't depend
    // on here). RLS is bypassed via the pool's SUPERUSER bootstrap role
    // (see 0011 / 0040). `deleted_at IS NULL` filters soft-deleted
    // accounts (the `status` column mirrors it but `deleted_at` is the
    // single source of truth — `status` is updated async by the reaper).
    const user = await this.db.kysely
      .selectFrom('users')
      .select([
        'id',
        'handle',
        'display_name',
        'email',
        'phone_e164',
        'avatar_url',
        'locale',
        'default_city_id',
        'status',
      ])
      .where('phone_e164', '=', input.phoneNumber)
      .executeTakeFirst();

    // 401 (not 422) so attackers can't tell apart "no such phone" from
    // "phone exists but code wrong" — both fail closed. The pre-tenant
    // `phone_verified` audit row already landed; that's fine: it
    // records the OTP match attempt, which is a useful security event
    // regardless of whether the user exists.
    if (!user || user.status === 'deleted') {
      throw new UnauthorizedException({
        error: { code: 'phone_otp.unknown_user', message: 'no account for that phone' },
      });
    }

    // Roles for the JWT role_snapshot and the response shape.
    // user_roles is city-scoped (0011) but the join goes via
    // `roles.code` (global). Filtering by the user's city keeps the
    // lookup scoped to roles that actually grant them permissions in
    // their active city. Suspended users keep their roles — the guard
    // layer is responsible for the suspend check, not the session
    // layer (matches signOut's "suspended == active for audit purposes"
    // stance).
    const roleRows = await this.db.kysely
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.code')
      .where('user_roles.user_id', '=', user.id)
      .execute();
    const roles = roleRows.map((r) => r.code);
    const cityId = user.default_city_id;

    // Mint a fresh session id + absolute expiry. The auth_sessions row
    // is the source of truth for "is this session alive"; JwtAuthGuard
    // reads it on every request. `last_seen_at` is stamped by the guard
    // on each authenticated hit, so we leave it at the default (== created_at)
    // here.
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

    if (cityId) {
      // Happy path — user has a city. runInTenantTx keeps RLS GUCs set
      // for the INSERT + audit, both of which happen in the same tx.
      await this.db.runInTenantTx(this.tenantCtx(cityId, user.id, input.requestId), async (trx) => {
        await trx
          .insertInto('auth_sessions')
          .values({
            id: sessionId,
            user_id: user.id,
            device_fingerprint: input.deviceFingerprint,
            ip: input.ip,
            user_agent: input.userAgent ?? '',
            absolute_expires_at: expiresAt,
          } as never)
          .execute();

        await this.audit.write(trx, {
          tenant: this.tenantCtx(cityId, user.id, input.requestId),
          action: 'session_created',
          targetType: 'session',
          targetId: sessionId,
          payload: {
            via: 'phone_otp',
            device_fingerprint: input.deviceFingerprint,
          },
          ip: input.ip,
          userAgent: input.userAgent,
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
          device_fingerprint: input.deviceFingerprint,
          ip: input.ip,
          user_agent: input.userAgent ?? '',
          absolute_expires_at: expiresAt,
        } as never)
        .execute();

      await this.audit.writeSystem(this.db.kysely, {
        action: 'session_created',
        targetType: 'session',
        targetId: sessionId,
        payload: {
          via: 'phone_otp',
          device_fingerprint: input.deviceFingerprint,
        },
        requestId: input.requestId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }

    // Sign two distinct JWTs. They share the same `jti` (== sessionId)
    // so JwtAuthGuard sees one session regardless of which the caller
    // presents — but they differ in TTL so a stolen access token can't
    // outlive its short window. Refresh reuse is enforced at the
    // `auth_sessions.absolute_expires_at` level (30d), not in the JWT
    // itself.
    const baseClaims: Omit<JwtClaims, never> = {
      sub: user.id,
      city_id: cityId ?? '',
      scope_type: 'city',
      scope_id: cityId,
      role_snapshot: roles,
      device_fingerprint: input.deviceFingerprint,
    };
    const accessToken = await this.jwt.sign(baseClaims, {
      jti: sessionId,
      ttlSeconds: ACCESS_TTL_SECONDS,
    });
    const refreshToken = await this.jwt.sign(baseClaims, {
      jti: sessionId,
      ttlSeconds: REFRESH_TTL_SECONDS,
    });

    const dto: VerifyOtpSessionUser = {
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
      // (e.g. `req-abc12345`) coerce to NULL so the insert doesn't
      // 22P02. Same regex as audit.service.ts:tryParseUuid.
      requestId: requestId && UUID_RE.test(requestId) ? requestId : '',
    };
  }
}

/**
 * Strip Fastify request metadata for the service boundary. Keeps the
 * service test-friendly (plain object, not Fastify-coupled) and pins
 * the exact fields the service reads so a future req refactor doesn't
 * accidentally leak UA/IP bypass.
 */
export function extractVerifyContext(
  req: { id?: string | number; raw?: { id?: string | number }; ip?: string; headers?: Record<string, string | string[] | undefined> } | undefined,
): VerifyInput {
  const raw = req?.raw?.id ?? req?.id ?? null;
  const requestId = raw !== null ? String(raw) : null;
  const uaHeader = req?.headers?.['user-agent'];
  const userAgent = typeof uaHeader === 'string' ? uaHeader : Array.isArray(uaHeader) ? uaHeader[0] ?? null : null;
  const fpHeader = req?.headers?.['x-device-fingerprint'];
  const deviceFingerprint =
    typeof fpHeader === 'string' && fpHeader.length > 0
      ? fpHeader
      : Array.isArray(fpHeader) && fpHeader[0]
        ? fpHeader[0]
        : null;
  return {
    phoneNumber: '',
    code: '',
    requestId,
    ip: req?.ip ?? null,
    userAgent: userAgent ?? null,
    deviceFingerprint,
  };
}