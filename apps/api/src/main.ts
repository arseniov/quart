import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ZodValidationPipe } from './common/zod-validation.pipe.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  const config = app.get(ConfigService);
  await app.listen({ port: config.env.PORT, host: '0.0.0.0' });
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});