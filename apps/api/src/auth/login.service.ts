// apps/api/src/auth/login.service.ts
// GH #33: email + password sign-in for the mobile app. Mirrors phone-otp's
// `verifyAndIssueSession` shape (issue-session-after-credential-verify,
// same audit chain), but delegates the credential check to Better Auth's
// `signInEmail` so password hashing stays single-sourced (BA's scrypt
// format, configured in AuthService). On success we translate BA's
// `{ user, redirect, url }` into a Quart `SessionUserRow`, look up the
// canonical users row by email, and hand off to SessionService.createSession
// with `auditPayload: { via: 'email_login' }` so the §3.8 chain can
// distinguish email-login from phone-otp.
//
// On failure (wrong password, unknown email, no credential account, etc.)
// BA throws a `better-call` APIError; we surface a uniform 401 + write
// `auth.email_login_failed` under the sentinel city so brute-force
// attempts are visible in the chain even before a userId exists.

import { createHash } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';
import type { LoginResponse } from './login.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SessionService } from './session.service.js';

export interface LoginContext {
  email: string;
  password: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
}

/**
 * Email + password sign-in.
 *
 * Two-phase audit chain (mirrors phone-otp):
 *   1. `auth.email_login_failed` (sentinel city) — only on failure paths.
 *      Operators need brute-force attempts visible in the chain even when
 *      no userId resolves yet.
 *   2. `session_created` (user's city, or sentinel fallback) — written by
 *      SessionService.createSession with `auditPayload: { via: 'email_login' }`.
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async signInAndIssueSession(ctx: LoginContext): Promise<LoginResponse> {
    const normalizedEmail = ctx.email.trim().toLowerCase();

    try {
      // BA's signInEmail throws APIError on every failure mode (UNKNOWN_USER,
      // INVALID_EMAIL_OR_PASSWORD, EMAIL_NOT_VERIFIED). Don't try to
      // distinguish them — the mobile client gets a single 401.
      await this.auth.instance.api.signInEmail({
        body: { email: normalizedEmail, password: ctx.password },
      });
    } catch (err) {
      await this.recordFailedAttempt(normalizedEmail, ctx, err);
      throw new UnauthorizedException({
        error: { code: 'auth.login_invalid_credentials', message: 'Invalid email or password.' },
      });
    }

    // Translate BA's user record into a Quart SessionUserRow. BA's `user.id`
    // is a text UUID and the Quart `users` row may have a different id
    // (the linkage runs through `user_identities` / `users.email`), so we
    // look up by email — same approach password-reset uses.
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
      .where('email', '=', normalizedEmail)
      .executeTakeFirst();

    if (!user || user.status !== 'active') {
      // BA accepted the credential but the Quart projection is gone or
      // soft-deleted — treat as a failure so the chain reflects the truth.
      await this.recordFailedAttempt(normalizedEmail, ctx, new Error('quart_user_missing'));
      throw new UnauthorizedException({
        error: { code: 'auth.login_invalid_credentials', message: 'Invalid email or password.' },
      });
    }

    // Mirror phone-otp: fetch role codes so the JWT carries a role_snapshot.
    const roleRows = await this.db.kysely
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.code')
      .where('user_roles.user_id', '=', user.id)
      .execute();
    const roles = roleRows.map((r) => r.code);

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
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      deviceFingerprint: ctx.deviceFingerprint,
      requestId: ctx.requestId,
      auditPayload: { via: 'email_login' },
    });
  }

  /**
   * Write `auth.email_login_failed` under the sentinel city. We don't know
   * the userId yet, so targetId falls back to a hash prefix of the email
   * (audit_log.target_id is varchar(64); raw emails run up to 254 chars).
   * The raw email stays in payload (jsonb is unbounded).
   */
  private async recordFailedAttempt(email: string, ctx: LoginContext, err: unknown): Promise<void> {
    const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 40);
    // ponytail: BA's APIError has a `body.code` we could surface in payload,
    // but logging it would split the chain across multiple rows by error
    // class. Operators care about the count and the IP, not the cause.
    void err;
    try {
      await this.audit.writeSystem(this.db.kysely, {
        action: 'auth.email_login_failed',
        targetType: 'user',
        targetId: `email:${emailHash}`,
        payload: { email, ip: ctx.ip },
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (writeErr) {
      // Don't let the audit failure mask the real auth error.
      this.logger.warn({ err: String(writeErr) }, '[login] failed-attempt audit write failed');
    }
  }
}

/**
 * Strip Fastify request metadata for the service boundary. Mirrors
 * phone-otp's `extractVerifyContext` (kept inline here because login has
 * its own header set — no `phoneNumber`, no `code`).
 */
export function extractLoginContext(
  req: { id?: string | number; raw?: { id?: string | number }; ip?: string; headers?: Record<string, string | string[] | undefined> } | undefined,
): Omit<LoginContext, 'email' | 'password'> {
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
    requestId,
    ip: req?.ip ?? null,
    userAgent,
    deviceFingerprint,
  };
}
