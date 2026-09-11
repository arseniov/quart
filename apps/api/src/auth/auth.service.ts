import { Injectable } from '@nestjs/common';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { phoneNumber } from 'better-auth/plugins';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

/**
 * Wraps a configured Better Auth instance. The real Kysely adapter is
 * wired in Task 13 once the auth_* tables exist (foundation plan
 * Task 15). Until then the adapter is a no-op stub that returns empty
 * results — sign-in attempts will fail closed at the adapter boundary.
 */
@Injectable()
export class AuthService {
  readonly instance: ReturnType<typeof betterAuth>;

  constructor(config: ConfigService) {
    const options: BetterAuthOptions = {
      secret: config.env.BETTER_AUTH_SECRET,
      baseURL: config.env.BETTER_AUTH_URL,
      database: this.kyselyAdapter(),
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

  // ponytail: stub returns no rows; replaced by Kysely-backed adapter in T13
  // when auth_* tables land. Shape conforms to BetterAuthOptions['database']
  // when an AdapterInstance factory is required.
  private kyselyAdapter() {
    const stub = {
      id: 'stub',
      create: async () => null,
      findOne: async () => null,
      findMany: async () => [],
      update: async () => null,
      updateMany: async () => 0,
      delete: async () => undefined,
      deleteMany: async () => 0,
    };
    return () => stub;
  }
}
