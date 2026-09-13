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
import { OtelShutdownHook, startOtel } from './observability/otel.js';
import { initSentry, SentryEnvSchema } from './observability/sentry.js';

async function bootstrap(): Promise<void> {
  // Init OTel BEFORE Sentry and BEFORE NestFactory.create() so the SDK
  // catches bootstrap-time spans and the Prometheus exporter is up while
  // the API is still coming up. No-op when OTEL_ENABLED=false.
  const otelHandle = startOtel();
  // Init Sentry BEFORE NestFactory.create() so bootstrap errors are captured.
  // We parse ONLY the Sentry keys (narrow SentryEnvSchema), so contexts
  // without full app config (workers, scripts) can still log to Sentry.
  // ConfigService re-validates the full EnvSchema when Nest instantiates it.
  initSentry(SentryEnvSchema.parse(process.env));
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  // Required for OnApplicationShutdown hooks (e.g. QueueService closes
  // BullMQ queues, AuditAnchorWorkerHost closes the Worker) to fire on
  // SIGTERM/SIGINT. Without this, Nest silently tears down without running
  // any shutdown lifecycle. Must be set BEFORE the SIGTERM listener below
  // so the lifecycle ordering is correct on shutdown.
  app.enableShutdownHooks();
  // Hand the OTel lifecycle to Nest's shutdown chain. Belt-and-suspenders
  // SIGTERM so a hard-stop still flushes spans + metrics. Guard with a
  // module-level flag — `startOtel()` may return the no-op handle when
  // OTEL_ENABLED=false or the Prometheus exporter fails to bind, but the
  // outer `if (!sigtermWired)` check keeps us from stacking duplicate
  // listeners if bootstrap is ever invoked more than once (test rigs).
  app.get(OtelShutdownHook).setHandle(otelHandle);
  if (!sigtermWired) {
    sigtermWired = true;
    process.on('SIGTERM', () => {
      void otelHandle.shutdown();
    });
  }
  // Global multipart — `attachFieldsToBody: false` keeps body untouched so
  // each route pulls its part via `req.file({ limits })` and decides limits
  // per-route (DoS surface: 10MB enforced mid-stream, not after buffering).
  await app.register(multipart, { attachFieldsToBody: false });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  const config = app.get(ConfigService);
  await app.listen({ port: config.env.PORT, host: '0.0.0.0' });
}

/** Guard against double-wiring the SIGTERM listener (bootstrap re-entry, e.g. test rigs). */
let sigtermWired = false;

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
