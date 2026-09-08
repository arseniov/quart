import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { ConfigService } from '../config/config.service.js';

import { buildLoggerOptions } from './pino.config.js';

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
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
