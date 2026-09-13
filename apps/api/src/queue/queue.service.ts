import { Injectable } from '@nestjs/common';
import { Queue, type RedisOptions } from 'bullmq';

export type QueueName = 'push' | 'email' | 'audit-anchor' | 'media-scan' | 'cleanup' | 'webhooks';

/** Stable job-name per queue so worker registration isn't coupled to internal ids. */
const JOB_NAME: Record<QueueName, string> = {
  push: 'send_push',
  email: 'send_email',
  'audit-anchor': 'anchor_audit',
  'media-scan': 'scan_media',
  cleanup: 'cleanup',
  webhooks: 'deliver_webhook',
};

@Injectable()
export class QueueService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    private readonly connection: RedisOptions,
    queues?: Partial<Record<QueueName, Queue>>,
  ) {
    const ctor = (name: QueueName): Queue => queues?.[name] ?? new Queue(name, { connection });
    this.queues = {
      push: ctor('push'),
      email: ctor('email'),
      'audit-anchor': ctor('audit-anchor'),
      'media-scan': ctor('media-scan'),
      cleanup: ctor('cleanup'),
      webhooks: ctor('webhooks'),
    };
  }

  /** JobId is `{entity_id}:{delivery_channel}` — retries with the same pair reuse
   *  the existing job in BullMQ (it returns it instead of erroring), so retries
   *  are naturally idempotent. */
  async enqueue(name: QueueName, ids: { entity_id: string; delivery_channel: string }, data: unknown) {
    return this.queues[name].add(JOB_NAME[name], data, { jobId: `${ids.entity_id}:${ids.delivery_channel}` });
  }
}