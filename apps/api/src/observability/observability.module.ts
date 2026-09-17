import { Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module.js';

import { MetricsController } from './metrics.controller.js';
import { OtelShutdownHook } from './otel.js';
import { SlowQueryMiddleware } from './slow-query.middleware.js';

/**
 * Observability surface: `/metrics` endpoint + the OTel shutdown hook so
 * `OnApplicationShutdown` flushes spans on Nest teardown. The hook is also
 * registered on `main.ts` for the SIGTERM hard-stop path, but exporting it
 * here means every consumer (workers, scripts) gets the same wiring just by
 * importing `ObservabilityModule`.
 *
 * `SlowQueryMiddleware` is registered as a provider + exported so
 * `AppModule.configure(consumer)` can reference it after `RequestIdMiddleware`
 * (Nest resolves middleware classes via DI from the calling module).
 */
@Module({
  imports: [QueueModule],
  controllers: [MetricsController],
  providers: [OtelShutdownHook, SlowQueryMiddleware],
  exports: [OtelShutdownHook, SlowQueryMiddleware],
})
export class ObservabilityModule {}
