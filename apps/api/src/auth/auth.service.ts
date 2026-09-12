import { Injectable } from '@nestjs/common';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { phoneNumber } from 'better-auth/plugins';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import { kyselyAdapter } from './auth.adapter.js';

/**
 * Wraps a configured Better Auth instance. The Kysely adapter talks to the
 * BA core schema (`user` / `session` / `account` / `verification`) created
 * by migration 0025. Tenant scoping is intentionally not wired here: BA
 * owns sign-in / session issuance; city scope flows through runInTenantTx
 * once the JWT arrives at a downstream endpoint.
 */
@Injectable()
export class AuthService {
  readonly instance: ReturnType<typeof betterAuth>;

  constructor(config: ConfigService, dbService: DbService) {
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
      plugins: [phoneNumber()],
    };
    this.instance = betterAuth(options);
  }
}