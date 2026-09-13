import 'reflect-metadata';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ZodValidationPipe } from './common/zod-validation.pipe.js';
import { ConfigService } from './config/config.service.js';
import { initSentry, SentryEnvSchema } from './observability/sentry.js';

async function bootstrap(): Promise<void> {
  // Init Sentry BEFORE NestFactory.create() so bootstrap errors are captured.
  // We parse ONLY the Sentry keys (narrow SentryEnvSchema), so contexts
  // without full app config (workers, scripts) can still log to Sentry.
  // ConfigService re-validates the full EnvSchema when Nest instantiates it.
  initSentry(SentryEnvSchema.parse(process.env));
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  // Global multipart — `attachFieldsToBody: false` keeps body untouched so
  // each route pulls its part via `req.file({ limits })` and decides limits
  // per-route (DoS surface: 10MB enforced mid-stream, not after buffering).
  await app.register(multipart, { attachFieldsToBody: false });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Required for OnApplicationShutdown hooks (e.g. QueueService closes
  // BullMQ queues, AuditAnchorWorkerHost closes the Worker) to fire on
  // SIGTERM/SIGINT. Without this, Nest silently tears down without running
  // any shutdown lifecycle.
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  await app.listen({ port: config.env.PORT, host: '0.0.0.0' });
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
