import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the ConfigService + DbService constructor
// parameters. Matches the pattern in magic-link.service.ts / jwt.service.ts.
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
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS);

    await this.db.kysely
      .insertInto('password_resets')
      .values({ user_id: user.id, token, expires_at: expiresAt } as never)
      .execute();

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
   * FIXME: audit chain integration pending — see gh issue #4. A
   * successful reset changes `password_hash`, which is exactly the kind
   * of event the chain exists to attest; until the "system pathway"
   * audit event lands, successful resets are not in the HMAC chain.
   */
  async reset(token: string, newPassword: string): Promise<{ ok: true } | { ok: false }> {
    const row = await this.db.kysely
      .updateTable('password_resets')
      .set({ consumed_at: new Date() } as never)
      .where('token', '=', token)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning('user_id')
      .executeTakeFirst();

    if (!row) return { ok: false };

    let hash: string;
    try {
      hash = await hashPassword(newPassword);
    } catch (err) {
      // Better Auth's hashPassword (scrypt) can throw on malformed input
      // (extremely long passwords, NFKC overflow). The token is already
      // consumed — fail closed rather than re-opening the row.
      this.logger.error(
        { err: String(err), user_id: (row as { user_id: string }).user_id },
        'hashPassword failed during password reset',
      );
      return { ok: false };
    }

    await this.db.kysely
      .updateTable('users')
      .set({ password_hash: hash } as never)
      .where('id', '=', (row as { user_id: string }).user_id)
      .execute();

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
