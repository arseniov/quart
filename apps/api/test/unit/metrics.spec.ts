import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bullmqQueueDepth,
  httpDuration,
  httpRequests,
  metricsController,
  registry,
} from '../../src/observability/metrics.controller.js';

describe('metricsController', () => {
  beforeEach(() => {
    httpRequests.reset();
    httpDuration.reset();
    bullmqQueueDepth.reset();
  });

  afterEach(() => {
    httpRequests.reset();
    httpDuration.reset();
    bullmqQueueDepth.reset();
  });

  it('returns text containing the spec-required counter and histogram names', async () => {
    // Touch the counters so they show up in the scrape output even with
    // zero observations (prom-client omits a Counter until first inc()).
    httpRequests.inc({ route: '/x', method: 'GET', status: '200' });
    httpDuration.observe({ route: '/x', method: 'GET' }, 0.01);

    const r = await metricsController();
    expect(r).toContain('http_requests_total');
    expect(r).toContain('http_request_duration_seconds');
    expect(r).toContain('bullmq_queue_depth');
  });

  it('increments http_requests_total after a labelled inc()', async () => {
    httpRequests.inc({ route: '/users', method: 'GET', status: '200' });
    httpRequests.inc({ route: '/users', method: 'GET', status: '200' });
    httpRequests.inc({ route: '/users', method: 'GET', status: '500' });

    const r = await metricsController();
    // Two 200s, one 500 — assert exact line for the most-common label set.
    // prom-client emits labels in `labelNames` declaration order (route,
    // method, status); "/" is not escaped inside label values.
    expect(r).toMatch(/http_requests_total\{route="\/users",method="GET",status="200"\} 2/);
    expect(r).toMatch(/http_requests_total\{route="\/users",method="GET",status="500"\} 1/);
  });

  it('records http_request_duration_seconds observations on a histogram', async () => {
    httpDuration.observe({ route: '/health', method: 'GET' }, 0.123);
    httpDuration.observe({ route: '/health', method: 'GET' }, 0.456);

    const r = await metricsController();
    // le comes first in bucket output (auto-injected), then labelNames order
    // (route, method).
    expect(r).toMatch(/http_request_duration_seconds_bucket\{le="\+Inf",route="\/health",method="GET"\} 2/);
    expect(r).toMatch(/http_request_duration_seconds_count\{route="\/health",method="GET"\} 2/);
    expect(r).toMatch(/http_request_duration_seconds_sum\{route="\/health",method="GET"\} 0\.579/);
  });

  it('uses the prom-client text content-type', () => {
    expect(registry.contentType).toMatch(/^text\/plain/);
  });

  it('does not throw when no metrics have been recorded yet', async () => {
    const r = await metricsController();
    // Even with zero observations the default Node collectors show up.
    expect(r).toContain('process_cpu_user_seconds_total');
  });
});

describe('bullmqQueueDepth collect()', () => {
  it('is wired to fail-open: a throwing provider logs and yields no rows', async () => {
    const failProvider = {
      getDepth: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    // Re-bind the provider used by the collect() callback.
    const mod = await import('../../src/observability/metrics.controller.js');
    mod.setBullmqQueueDepthProvider(failProvider as never);

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Trigger a scrape — the gauge.collect() runs during this call.
    const r = await mod.metricsController();
    expect(failProvider.getDepth).toHaveBeenCalled();
    expect(consoleErr).toHaveBeenCalled();
    // Scrape must still succeed even when collect throws.
    expect(r).toContain('process_cpu_user_seconds_total');
    consoleErr.mockRestore();
  });
});
