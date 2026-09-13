import { Worker, type Job } from 'bullmq';

import type { ConfigService } from '../config/config.service.js';

import { parseValkeyUrl } from './connection.js';
import type { PushPayload, PushService } from './push.service.js';

export interface StartPushWorkerOpts {
  config: ConfigService;
  push: PushService;
}

/** BullMQ factory: a worker on the `push` queue that consumes `send_push`
 *  jobs (the only job-name on this queue — see QueueService) and forwards
 *  payloads to {@link PushService.send}.
 *
 *  Retry policy lives on the Queue's `defaultJobOptions` (see
 *  QueueService) — BullMQ does NOT accept `attempts`/`backoff` on the Worker. */
export function startPushWorker(opts: StartPushWorkerOpts): Worker {
  return new Worker('push', async (job: Job) => opts.push.send(job.data as PushPayload), {
    connection: parseValkeyUrl(opts.config.env.VALKEY_URL),
  });
}
