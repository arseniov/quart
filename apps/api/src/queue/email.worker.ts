import { Worker, type Job } from 'bullmq';

import type { ConfigService } from '../config/config.service.js';

import { parseValkeyUrl } from './connection.js';
import type { EmailPayload, EmailService } from './email.service.js';

export interface StartEmailWorkerOpts {
  config: ConfigService;
  email: EmailService;
}

/** BullMQ factory: a worker on the `email` queue that drains `send_email`
 *  jobs (the only job-name on this queue — see QueueService) and forwards
 *  payloads to {@link EmailService.send}.
 *
 *  Idempotency: each fan-out enqueues with jobId = `${notificationId}:${channel}:${deliveryId}`,
 *  so duplicate enqueues collapse to one delivery and the worker can be
 *  retried safely. */
export function startEmailWorker(opts: StartEmailWorkerOpts): Worker {
  return new Worker('email', async (job: Job) => opts.email.send(job.data as EmailPayload), {
    connection: parseValkeyUrl(opts.config.env.VALKEY_URL),
  });
}
