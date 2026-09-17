import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the QueueService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueService } from '../queue/queue.service.js';

/**
 * Process-local Prometheus registry. `collectDefaultMetrics()` registers the
 * standard Node.js collectors (event-loop lag, GC, memory, fd count). All
 * custom metrics below register against this same registry, so a single
 * `registry.metrics()` call emits the full scrape payload.
 *
 * We deliberately do NOT share a registry across services — each NestJS
 * process owns one registry so test runs don't double-emit counters.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['route', 'method'],
  // ponytail: buckets cover 5ms..10s. Tight enough for p50/p95 on a NestJS
  // API without exploding cardinality. Switch to [0.001, 0.01, 0.1, ...] if
  // we ever care about sub-5ms tail latency.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Current number of jobs waiting in each BullMQ queue',
  labelNames: ['queue'],
  registers: [registry],
  // collect() runs at scrape time so we don't need a polling timer — fresh
  // numbers every time Prometheus scrapes /metrics. Ponytail note: this
  // does one Redis call per queue per scrape; safe at 15s intervals for ~6
  // queues, add a cached snapshot if scrape rate climbs.
  async collect() {
    const provider = bullmqQueueDepthProvider;
    if (!provider) return;
    try {
      for (const name of ['push', 'email', 'audit-anchor', 'media-scan', 'cleanup', 'webhooks'] as const) {
        const counts = await provider.getDepth(name);
        this.set({ queue: name }, counts.waiting + counts.delayed);
      }
    } catch (err) {
      // Fail-open: never let a Redis blip take down /metrics. The next scrape
      // will retry; logged once so we notice persistent failure.
      console.error('[metrics] bullmq_queue_depth collect failed', err);
    }
  },
});

/** Mutable provider slot — set by `MetricsController` on construction so the
 *  gauge's collect() callback can resolve the live `QueueService`. Stored as
 *  a module-level reference rather than a property on the gauge itself so
 *  the prom-client `Gauge<"queue">` type stays intact. */
let bullmqQueueDepthProvider: QueueService | undefined;

/** Allow tests / DI overrides to inject a stub before the gauge sees a real queue. */
export function setBullmqQueueDepthProvider(provider: QueueService | undefined): void {
  bullmqQueueDepthProvider = provider;
}

@Controller('metrics')
@ApiTags('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(private readonly queues: QueueService) {
    setBullmqQueueDepthProvider(queues);
  }

  @Get()
  @Header('Content-Type', registry.contentType)
  async metrics(): Promise<string> {
    return registry.metrics();
  }
}

/** Standalone helper for tests and the OpenAPI generator. */
export async function metricsController(): Promise<string> {
  return registry.metrics();
}
