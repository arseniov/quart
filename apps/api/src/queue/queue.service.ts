import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
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
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
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

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }

  /** enqueue() uses `jobId = entity_id:delivery_channel`. BullMQ deduplicates by
   *  jobId and returns the existing job without erroring — callers MUST treat
   *  the `data` argument as a snapshot: if a job already exists for this id,
   *  the new payload is silently DROPPED. Generate idempotent payloads upstream,
   *  or use a fresh jobId per distinct job body. */
  async enqueue(name: QueueName, ids: { entity_id: string; delivery_channel: string }, data: unknown) {
    const job = (await this.queues[name].add(JOB_NAME[name], data, {
      jobId: `${ids.entity_id}:${ids.delivery_channel}`,
    })) as { data?: unknown } | undefined;
    // If `add()` returned the persisted existing job (not a new one), its stored
    // payload may differ from the supplied `data` — that's a silent drop, warn loudly.
    if (job && !deepEqual(job.data, data)) {
      this.logger.warn(
        `Duplicate jobId ${ids.entity_id}:${ids.delivery_channel} on queue ${name} — supplied data dropped, persisted payload kept.`,
      );
    }
    return job;
  }
}

/** Structural equality for plain JSON-ish payloads (no Date/Map/Set gymnastics). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
