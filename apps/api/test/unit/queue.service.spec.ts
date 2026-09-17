import 'reflect-metadata';

import { describe, it, expect, vi } from 'vitest';

import { QueueService } from '../../src/queue/queue.service.js';

const makeQueue = () => {
  let persistedData: unknown;
  return {
    add: vi.fn(async (_name: string, data: unknown, _opts?: unknown) => {
      // First add stores the payload; subsequent adds with the same jobId return
      // the persisted payload (mirroring BullMQ's duplicate-jobId behaviour).
      if (persistedData === undefined) persistedData = data;
      return { id: 'job-1', data: persistedData };
    }),
    close: vi.fn(async () => undefined),
  };
};

const makeSvc = () => {
  const queues = {
    push: makeQueue(),
    email: makeQueue(),
    'audit-anchor': makeQueue(),
    'media-scan': makeQueue(),
    cleanup: makeQueue(),
    webhooks: makeQueue(),
  };
  const svc = new QueueService({} as never, queues as never);
  return { svc, queues };
};

describe('QueueService', () => {
  it('enqueue uses the stable job-name for the queue', async () => {
    const { svc, queues } = makeSvc();
    await svc.enqueue('push', { entity_id: 'n1', delivery_channel: 'apns' }, { payload: { x: 1 } });
    expect(queues.push.add).toHaveBeenCalledWith('send_push', { payload: { x: 1 } }, { jobId: 'n1:apns' });
  });

  it('enqueue passes a different stable job-name per queue', async () => {
    const { svc, queues } = makeSvc();
    await svc.enqueue('email', { entity_id: 'u1', delivery_channel: 'smtp' }, { payload: { y: 2 } });
    expect(queues.email.add).toHaveBeenCalledWith('send_email', { payload: { y: 2 } }, { jobId: 'u1:smtp' });
    expect(queues['audit-anchor'].add).not.toHaveBeenCalled();
  });

  it('idempotent retries: a second enqueue with the same jobId returns the persisted payload', async () => {
    const { svc } = makeSvc();
    const firstPayload = { payload: { x: 1 } };
    await svc.enqueue('push', { entity_id: 'n1', delivery_channel: 'apns' }, firstPayload);
    // BullMQ returns the existing job for duplicate jobIds — the test verifies the
    // *persisted* payload (from the first add) survives, not the newly supplied one.
    const second = await svc.enqueue('push', { entity_id: 'n1', delivery_channel: 'apns' }, { payload: { x: 2 } });
    expect(second).toBeDefined();
    expect(second?.data).toEqual(firstPayload);
    expect(second?.data).not.toEqual({ payload: { x: 2 } });
  });

  it('onApplicationShutdown closes every queue', async () => {
    const { svc, queues } = makeSvc();
    await svc.onApplicationShutdown();
    for (const q of Object.values(queues)) {
      expect(q.close).toHaveBeenCalledTimes(1);
    }
  });
});
