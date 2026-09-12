import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

/**
 * Thin wrapper around the Valkey (Redis-compatible) client. Used by the JWT
 * auth guard to cache per-session state so the hot path doesn't hit Postgres
 * on every authenticated request.
 *
 * Failure semantics: methods throw on Valkey errors. The caller decides
 * fail-open vs fail-closed — the JWT guard fails CLOSED (denies) on Valkey
 * errors per the T16 plan.
 */
@Injectable()
export class ValkeyService implements OnModuleDestroy {
  private readonly logger = new Logger(ValkeyService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.env.VALKEY_URL, { lazyConnect: false });
    this.client.on('error', (err: Error) => this.logger.warn({ err: String(err) }, 'valkey client error'));
  }

  async getSession(jti: string): Promise<unknown> {
    return await this.client.get(`sess:${jti}`);
  }

  async setSession(jti: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`sess:${jti}`, value, 'EX', ttlSeconds);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}