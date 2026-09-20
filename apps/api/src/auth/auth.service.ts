import { Injectable } from '@nestjs/common';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { phoneNumber } from 'better-auth/plugins';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import { kyselyAdapter } from './auth.adapter.js';
import { baDatabaseHooks, baSignOutAuditPlugin } from './ba-audit.hook.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SessionService } from './session.service.js';

/**
 * Wraps a configured Better Auth instance. The Kysely adapter talks to the
 * BA core schema (`user` / `session` / `account` / `verification`) created
 * by migration 0025. Tenant scoping is intentionally not wired here: BA
 * owns sign-in / session issuance; city scope flows through runInTenantTx
 * once the JWT arrives at a downstream endpoint.
 *
 * GH #34: BA's `databaseHooks.session.create.after` fires after every
 * successful BA session row creation (social + BA email). We splice in
 * `baSessionCreateHook` so the §3.8 HMAC chain gets a `session_created`
 * row via the shared `SessionService.createSession` helper. BA's
 * `/sign-out` is covered by `baSignOutAuditPlugin` (BA 1.0.20 has no
 * session-delete databaseHook). See `ba-audit.hook.ts` for the full
 * discriminator table.
 */
@Injectable()
export class AuthService {
  readonly instance: ReturnType<typeof betterAuth>;

  constructor(
    config: ConfigService,
    dbService: DbService,
    sessionService: SessionService,
    auditService: AuditService,
  ) {
    const options: BetterAuthOptions = {
      secret: config.env.BETTER_AUTH_SECRET,
      baseURL: config.env.BETTER_AUTH_URL,
      database: kyselyAdapter(dbService.kysely),
      emailAndPassword: { enabled: true },
      socialProviders: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID ?? '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        },
        apple: {
          clientId: process.env.APPLE_CLIENT_ID ?? '',
          clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
        },
      },
      plugins: [phoneNumber(), baSignOutAuditPlugin({ audit: auditService, db: dbService })],
      databaseHooks: baDatabaseHooks({ db: dbService, sessions: sessionService }),
    };
    this.instance = betterAuth(options);
  }
}