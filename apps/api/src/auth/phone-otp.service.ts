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
//
// Session issuance itself is delegated to `SessionService.createSession`
// (apps/api/src/auth/session.service.ts) so the forthcoming email-login
// controller can reuse the exact same code path without forking the chain.

import { createHash } from 'node:crypto';

import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { VerifyOtpSessionResponse } from './phone-otp.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SessionService } from './session.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TwilioService } from './twilio.service.js';

interface VerifyInput {
  phoneNumber: string;
  code: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
}

/**
 * Phone-OTP verification + session issuance.
 *
 * Two-phase audit chain:
 *  1. `phone_verified` — pre-tenant, lands under the sentinel city so the
 *     chain sees the OTP match even before any user lookup.
 *  2. `session_created` — written by `SessionService.createSession`,
 *     in-tenant when the user has a city, writeSystem otherwise.
 */
@Injectable()
export class PhoneOtpService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly twilio: TwilioService,
  ) {}

  async verifyAndIssueSession(input: VerifyInput): Promise<VerifyOtpSessionResponse> {
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

    // Hand off to the shared session helper. The HMAC chain entry lands
    // in the same order it did when this logic was inlined — every
    // existing test for `phone_verified` → `session_created` order still
    // holds because SessionService preserves the original write sequence.
    return this.sessions.createSession({
      user: {
        id: user.id,
        handle: user.handle,
        display_name: user.display_name,
        email: user.email,
        phone_e164: user.phone_e164,
        avatar_url: user.avatar_url,
        locale: user.locale,
        default_city_id: user.default_city_id,
      },
      roles,
      ip: input.ip,
      userAgent: input.userAgent,
      deviceFingerprint: input.deviceFingerprint,
      requestId: input.requestId,
      auditPayload: { via: 'phone_otp' },
    });
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
