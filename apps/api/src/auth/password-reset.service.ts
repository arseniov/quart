import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService + ConfigService + DbService
// constructor parameters. Matches the pattern in magic-link.service.ts /
// jwt.service.ts.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

/**
 * Mailer contract — same as magic-link. Duck-typed to keep the auth module
 * free of an SMTP/SES dependency. `MAILER` is a Symbol so we don't share
 * state with magic-link by accident.
 */
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

// Distinct Symbol from magic-link.service.ts — both are imported into
// AuthModule, and DI token identity is `===`, so re-exporting `MAILER`
// from this file would silently re-wire magic-link's mailer to whatever
// is bound here.
export const PASSWORD_RESET_MAILER = Symbol('PASSWORD_RESET_MAILER');

// 60 min — longer than magic-link (15 min) because users are slower with
// email → form → submit than with a one-click link.
const TTL_MS = 60 * 60 * 1000;

// ponytail: same token floor as magic-link — 256-bit CSPRNG minimum.
// Two UUIDs concatenated: 36 + 32 = 68 chars; trim the second UUID's
// dashes so the printable range is pure hex for the URL-fragment.
function generateToken(): string {
  return `${randomUUID()}${randomUUID().replace(/-/g, '')}`;
}

interface PasswordResetRow {
  id: string;
  user_id: string;
}

/**
 * Single-use password reset tokens.
 *
 * Admin-managed (no tenant RLS — see 0034_password_resets.up.sql). Reads
 * use `db.kysely` directly to sidestep runInTenantTx: the request flow
 * runs before the user has any tenant context, and verify surfaces only
 * `{ ok: false }` on failure.
 *
 * Password hashing is delegated to Better Auth's `hashPassword`
 * (scrypt, salt:hash hex). Sharing the verifier with AuthService means
 * a reset-hash and a sign-up-hash are byte-comparable — see the
 * `verifyPassword` import in auth.service.ts and the format at
 * better-auth/dist/crypto.js. Don't roll your own primitive here.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(PASSWORD_RESET_MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Issue a fresh token tied to the user with the given email and email
   * the reset URL. If the email is unknown, return without sending
   * anything — the controller always returns `{ sent: true }`, so an
   * attacker can't tell if they guessed a real address.
   *
   * Multiple concurrent requests for the same email insert multiple rows;
   * the prior tokens remain valid until consumed or expired. This matches
   * the magic-link UX (no invalidation on re-request).
   *
   * Returns `void` — the token must never live outside the mailer call.
   *
   * Audit (gh issue #4): the `forgot` event lands in the chain on
   * success and on the no-send branch (`skip: true` for unknown
   * emails — no state change, no chain pollution). The auth flow runs
   * before any tenant exists, so we use the `__system` sentinel via
   * AuditService.writeSystem.
   */
  async issue(email: string): Promise<void> {
    // Lowercase before lookup + insert: citext would compare
    // case-insensitively, but a mixed-case value would still be written
    // as-is and the throttle bucket is keyed off the lowercased value.
    const normalized = email.toLowerCase();

    const user = await this.db.kysely
      .selectFrom('users')
      .select('id')
      .where('email', '=', normalized)
      // No `.where('status', '=', 'active')` — let the reset succeed for
      // suspended accounts (admin can re-activate and the user can sign
      // back in). Soft-deleted accounts have NULL email, so the lookup
      // already misses them.
      .executeTakeFirst();

    if (!user) {
      // No enumeration leak. Log at debug to leave an audit trace.
      this.logger.debug(`forgot: no user for ${normalized}; skipping email`);
      // Audit the request attempt regardless — operators need to see
      // failed lookups as part of the chain. User id is unknown here,
      // so targetId falls back to the email (citext-typed in users;
      // this is the email AS-PRESENTED, normalized lowercase).
      await this.audit.writeSystem(this.db.kysely, {
        action: 'auth.password_reset_request',
        targetType: 'user',
        targetId: normalized,
        payload: { found: false },
      });
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS);

    // Audit + insert live in the same writeSystem transaction so the
    // reset row and its chain entry are atomic.
    await this.audit.writeSystem(
      this.db.kysely,
      {
        action: 'auth.password_reset_request',
        targetType: 'user',
        targetId: user.id,
        payload: { found: true },
      },
      async (trx) => {
        const row = (await trx
          .insertInto('password_resets')
          .values({ user_id: user.id, token, expires_at: expiresAt } as never)
          .returning('id')
          .executeTakeFirst()) as { id: string } | undefined;
        return row ? { targetId: row.id } : undefined;
      },
    );

    const url = `${this.config.env.MAGIC_LINK_BASE_URL}/auth/password/reset?token=${token}`;
    const subject = 'Reset your Quart password';
    const body =
      `Ciao,\n\n` +
      `abbiamo ricevuto una richiesta di reset della password per il tuo account. ` +
      `Clicca il link qui sotto per impostare una nuova password (valido 60 minuti):\n\n` +
      `${url}\n\n` +
      `Se non l'hai richiesto tu, ignora questa email — la tua password non cambia.`;
    await this.mailer.send(normalized, subject, body);
  }

  /**
   * Consume a token atomically and rotate the user's password hash.
   *
   * Two statements: (1) atomic UPDATE-WHERE-RETURNING on
   * `password_resets` (single-use, expiry-checked); (2) UPDATE on
   * `users.password_hash`. Both happen in succession because the token
   * table has no FK to the user table's hash column — the service is
   * the join point.
   *
   * Returns `{ ok: true }` on success and `{ ok: false }` on any failure
   * mode (missing, consumed, expired, hash failure) so callers cannot
   * leak which step failed.
   *
   * Audit (gh issue #4): on success, writeSystem records
   * `auth.password_reset` in the chain with the row id as the
   * targetId. On failure (`skip: true`) the audit row is suppressed —
   * no state change, no chain pollution.
   */
  async reset(token: string, newPassword: string): Promise<{ ok: true } | { ok: false }> {
    let consumedUserId: string | undefined;
    let ok = false;
    try {
      await this.audit.writeSystem(
        this.db.kysely,
        {
          action: 'auth.password_reset',
          targetType: 'password_reset',
          targetId: token,
          payload: { tokenLength: token.length },
        },
        async (trx) => {
          const row = (await trx
            .updateTable('password_resets')
            .set({ consumed_at: new Date() } as never)
            .where('token', '=', token)
            .where('consumed_at', 'is', null)
            .where('expires_at', '>', new Date())
            .returning(['id', 'user_id'])
            .executeTakeFirst()) as PasswordResetRow | undefined;
          if (!row) return { skip: true };
          consumedUserId = row.user_id;

          let hash: string;
          try {
            hash = await hashPassword(newPassword);
          } catch (err) {
            // Better Auth's hashPassword (scrypt) can throw on malformed
            // input (extremely long passwords, NFKC overflow). The token
            // is already consumed — fail closed rather than re-opening
            // the row by suppressing the audit. Returning skip: true
            // means "no audit row"; throwing bubbles up.
            this.logger.error(
              { err: String(err), user_id: row.user_id },
              'hashPassword failed during password reset',
            );
            // Bail without writing the audit row — the row is consumed
            // but the password is not. Surface as ok:false to caller.
            return { skip: true };
          }

          await trx
            .updateTable('users')
            .set({ password_hash: hash } as never)
            .where('id', '=', row.user_id)
            .execute();

          ok = true;
          return { targetId: row.id };
        },
      );
    } catch (err) {
      this.logger.error({ err: String(err) }, 'password reset transaction failed');
      return { ok: false };
    }

    if (!ok || !consumedUserId) return { ok: false };
    return { ok: true };
  }
}

/**
 * Default mailer — Pino-logged. Production swaps in a real SMTP/SES
 * client by overriding the MAILER provider in AuthModule.
 */
export const logMailer: Mailer = {
  async send(to, subject, body) {
    new Logger('Mailer').log(`(stub) to=${to} subject="${subject}" bodyLen=${body.length}`);
  },
};
