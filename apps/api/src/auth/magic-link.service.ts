import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the ConfigService + DbService constructor
// parameters. Matches the pattern in jwt.service.ts / valkey.service.ts /
// db.service.ts — without it the Nest DI runtime sees `Object` and can't
// match the test's `.overrideProvider(ConfigService).useValue(stub)`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

/**
 * Mailer contract — duck-typed so we don't pull a real SMTP/SES
 * dependency into the auth module. `email.service.ts` (queue) is used
 * for transactional fan-out; this is for the synchronous request flow
 * only (mocked in tests, Pino-logged in dev).
 */
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

export const MAILER = Symbol('MAILER');

// 15 minutes from issuance (spec).
const TTL_MS = 15 * 60 * 1000;

// ponytail: 64 hex chars of CSPRNG + a UUID prefix gives ~70 chars per
// token. randomUUID is 16 random bytes → 122 bits; the second uuid adds
// 32 hex chars (128 bits) for a 256-bit floor. Plenty for brute-force
// resistance within the 15-minute TTL.
function generateToken(): string {
  return `${randomUUID()}${randomUUID().replace(/-/g, '')}`;
}

/**
 * Single-use email sign-in links. Admin-managed (no tenant RLS — see
 * 0033_magic_links.up.sql comment). Reads use `db.kysely` directly to
 * sidestep runInTenantTx: the request flow runs before the user has any
 * tenant context, and verify surfaces only `{ ok: false }` on failure,
 * so leaks across city boundaries aren't a concern.
 */
@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Issue a fresh token, persist it, and email it. The token is the
   * one-time URL fragment the user clicks; we email the full URL via
   * `${MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=...`.
   */
  async issue(email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS);

    await this.db.kysely
      .insertInto('magic_links')
      .values({ email, token, expires_at: expiresAt } as never)
      .execute();

    const url = `${this.config.env.MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=${token}`;
    // Italian-first per spec. Wire i18n.service.ts when the email
    // template layer lands.
    const subject = 'Il tuo link di accesso a Quart';
    const body = `Ciao,\n\nclicca questo link per accedere a Quart (valido 15 minuti):\n\n${url}\n\nSe non l'hai richiesto tu, ignora questa email.`;
    await this.mailer.send(email, subject, body);

    return { token, expiresAt };
  }

  /**
   * Consume a token. Returns the email on success; `null` on every
   * failure mode (missing, consumed, expired) so callers cannot leak
   * which one happened.
   */
  async consume(token: string): Promise<{ email: string } | null> {
    const row = await this.db.kysely
      .selectFrom('magic_links')
      .select(['email', 'expires_at', 'consumed_at'])
      .where('token', '=', token)
      .executeTakeFirst();

    if (!row) return null;
    if (row.consumed_at !== null) return null;
    if (row.expires_at.getTime() < Date.now()) return null;

    await this.db.kysely
      .updateTable('magic_links')
      .set({ consumed_at: new Date() } as never)
      .where('token', '=', token)
      .execute();

    return { email: row.email };
  }
}

/**
 * Default mailer — Pino-logged. Production swaps in a real SMTP/SES
 * client by overriding the MAILER provider in AuthModule.
 *
 * ponytail: real SES wiring landed in T38 (`email.service.ts`) for
 * notifications. Magic-link mail is intentionally separate so the
 * synchronous request path doesn't couple to BullMQ.
 */
export const logMailer: Mailer = {
  async send(to, subject, body) {
    new Logger('Mailer').log(`(stub) to=${to} subject="${subject}" bodyLen=${body.length}`);
  },
};
