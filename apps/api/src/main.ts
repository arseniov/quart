import 'reflect-metadata';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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
import { buildCorsOptions } from './security/cors.js';
import { buildHelmetOptions } from './security/helmet.js';
import { SecurityEnvSchema } from './security/security-env.js';

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
  // Narrow security schema — parsed independently so CORS / HSTS / body
  // limits can be reasoned about without the full app env (DB / Valkey / MinIO).
  const secEnv = SecurityEnvSchema.parse(process.env);
  // trustProxy: false by default; production behind Cloudflare Tunnel MUST
  // set TRUST_PROXY=true so req.ip returns the real client IP from
  // X-Forwarded-For (not the tunnel egress IP). Leaving it false by default
  // means a direct exposure won't trust spoofed XFF from a malicious client.
  const adapter = new FastifyAdapter({
    trustProxy: secEnv.TRUST_PROXY,
    logger: false,
    // JSON / form body cap. Multipart has its own global 10MB cap below.
    bodyLimit: secEnv.MAX_REQUEST_BODY_BYTES,
  });
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
  // Security plugin order matters: helmet (headers) → cors (response headers)
  // → cookie (signed cookies) → multipart (request body). Helmet must run
  // before cors because cors can short-circuit OPTIONS preflight before
  // helmet sees it.
  await app.register(helmet, buildHelmetOptions({ env: secEnv }));
  await app.register(cors, buildCorsOptions({ env: secEnv }));
  await app.register(cookie, { secret: secEnv.COOKIE_SECRET });
  // Global multipart — `attachFieldsToBody: false` keeps body untouched so
  // each route pulls its part via `req.file({ limits })` and decides limits
  // per-route. The 10MB `fileSize` cap here is the *global* ceiling —
  // defense-in-depth so a forgotten per-route limit can't stream a 10GB
  // upload straight into RAM.
  await app.register(multipart, {
    attachFieldsToBody: false,
    limits: { fileSize: 10 * 1024 * 1024 },
  });
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
