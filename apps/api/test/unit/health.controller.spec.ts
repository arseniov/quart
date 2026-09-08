import { describe, it, expect } from 'vitest';

import { HealthController } from '../../src/health/health.controller.js';
import type { HealthService } from '../../src/health/health.service.js';

describe('HealthController', () => {
  it('returns ok when all probes pass', async () => {
    const svc = {
      probe: async () => ({ postgres: 'ok', valkey: 'ok', minio: 'ok' }),
    } as unknown as HealthService;
    const c = new HealthController(svc);
    const r = await c.check();
    expect(r.status).toBe('ok');
    expect(r.checks).toEqual({ postgres: 'ok', valkey: 'ok', minio: 'ok' });
  });

  it('returns degraded when a probe fails', async () => {
    const svc = {
      probe: async () => ({ postgres: 'ok', valkey: 'down', minio: 'ok' }),
    } as unknown as HealthService;
    const c = new HealthController(svc);
    const r = await c.check();
    expect(r.status).toBe('degraded');
  });
});
