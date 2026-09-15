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
   *
   * Returns void — the token must never live in JS-land beyond the
   * mailer call. The controller only needs to know the request was
   * accepted; the mailer is the only thing that learns the token.
   */
  async issue(email: string): Promise<void> {
    // Lowercase before insert: citext would compare case-insensitively,
    // but a mixed-case value would still be written as-is and leak into
    // the audit chain on first read. The throttle bucket is keyed on
    // the lowercased email so this also keeps the bucket aligned.
    const normalized = email.toLowerCase();
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS);

    await this.db.kysely
      .insertInto('magic_links')
      .values({ email: normalized, token, expires_at: expiresAt } as never)
      .execute();

    const url = `${this.config.env.MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=${token}`;
    // Italian-first per spec. Wire i18n.service.ts when the email
    // template layer lands.
    const subject = 'Il tuo link di accesso a Quart';
    const body = `Ciao,\n\nclicca questo link per accedere a Quart (valido 15 minuti):\n\n${url}\n\nSe non l'hai richiesto tu, ignora questa email.`;
    await this.mailer.send(normalized, subject, body);
  }

  /**
   * Consume a token atomically. Returns the email on success; `null`
   * on every failure mode (missing, consumed, expired) so callers
   * cannot leak which one happened.
   *
   * The UPDATE-WHERE-RETURNING is a single round-trip: Postgres only
   * matches one row under `consumed_at IS NULL`, so two concurrent
   * verify calls can't both win. The OLD row's email is returned by
   * the same statement, so there's no separate SELECT.
   *
   * FIXME: audit chain integration pending — see gh issue #N.
   * `AuditService.write` requires a `TenantContext` (cityId/userId),
   * but a magic-link verify runs before either exists. A "system
   * pathway" audit event (e.g. `actor_user_id IS NULL` + a sentinel
   * `city_id`) is the smallest change; until that lands, successful
   * verifies are not in the HMAC chain. Tracking issue will be opened.
   */
  async consume(token: string): Promise<{ email: string } | null> {
    const row = await this.db.kysely
      .updateTable('magic_links')
      .set({ consumed_at: new Date() } as never)
      .where('token', '=', token)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning('email')
      .executeTakeFirst();
    return row ?? null;
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
