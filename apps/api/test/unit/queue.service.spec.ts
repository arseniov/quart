import 'reflect-metadata';

import { describe, it, expect, vi } from 'vitest';

import { QueueService } from '../../src/queue/queue.service.js';

const makeQueue = () => ({ add: vi.fn(async (_name: string, _data: unknown, _opts?: unknown) => ({ id: 'job-1' })) });
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

  it('idempotent retries: a second enqueue with the same jobId does not throw', async () => {
    const { svc, queues } = makeSvc();
    await svc.enqueue('push', { entity_id: 'n1', delivery_channel: 'apns' }, { payload: { x: 1 } });
    // BullMQ returns the existing job for duplicate jobIds — no throw expected.
    await expect(
      svc.enqueue('push', { entity_id: 'n1', delivery_channel: 'apns' }, { payload: { x: 2 } }),
    ).resolves.toBeDefined();
    expect(queues.push.add).toHaveBeenCalledTimes(2);
  });
});