import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { pino, type Logger } from 'pino';

import { ConfigService } from '../config/config.service.js';

import { buildLoggerOptions } from './pino.config.js';

/**
 * DI token for the slow-query pino instance. Built from the same
 * `buildLoggerOptions` factory as the request logger so the redact list,
 * level, and base metadata stay in sync. The slow-query logger writes
 * directly to stdout (no request context) — Postgres slow queries have
 * no inherent correlation to an HTTP request, so a singleton sink keeps
 * the emit path off the request hot loop.
 *
 * ponytail: one shared pino logger per process is cheaper than per-call
 * child loggers, and the redact list is module-scope so re-evaluation
 * per emit is already avoided by pino's internal serialiser cache.
 */
export const SLOW_QUERY_LOGGER = Symbol.for('quart.SlowQueryLogger');

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          ...buildLoggerOptions(config),
          customLogLevel: (_req: unknown, res: { statusCode: number }, err: unknown) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          serializers: {
            req(req: { method: string; url: string; id?: string }) {
              return { method: req.method, url: req.url, id: req.id };
            },
          },
        },
      }),
    }),
  ],
  providers: [
    {
      provide: SLOW_QUERY_LOGGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Logger =>
        pino({ ...buildLoggerOptions(config), name: 'quart-api.slow-query' }),
    },
  ],
  exports: [PinoLoggerModule, SLOW_QUERY_LOGGER],
})
export class LoggerModule {}
