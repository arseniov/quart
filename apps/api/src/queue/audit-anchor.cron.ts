import { createHash } from 'node:crypto';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { ConfigService } from '../config/config.service.js';
import type { DbService } from '../db/db.service.js';

import type { QueueService } from './queue.service.js';

// ponytail: latest 10k audit_log rows is fine until the chain exceeds ~25 MB of
// row_hash strings per day (≈1k rows/s). At higher throughput split by city or
// shard by hour, then move to a real Merkle tree.
const ANCHOR_LOOKBACK_ROWS = 10_000;

@Injectable()
export class AuditAnchorCron implements OnModuleInit {
  private readonly logger = new Logger(AuditAnchorCron.name);

  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    private readonly db: DbService,
  ) {}

  async onModuleInit(): Promise<void> {
    // BullMQ repeatable job — cadence lives in Valkey, so it survives restarts
    // and a missed tick is drained when a worker comes back online. setTimeout
    // would lose the schedule on every deploy.
    await this.queues.addRepeatable(
      'audit-anchor',
      'anchor',
      { entity_id: 'audit-anchor-daily', delivery_channel: 'tsa' },
      { repeat: { pattern: '0 2 * * *', tz: 'UTC' }, jobId: 'audit-anchor-daily' },
    );
    this.logger.log('audit-anchor repeatable job registered (daily 02:00 UTC)');
  }

  /** Compute today's concatenation hash over the latest audit_log row_hashes
   *  and enqueue the anchor job. Exposed for tests; production runs via the
   *  BullMQ repeatable schedule above. */
  async tick(): Promise<void> {
    const rows = await this.db.kysely
      .selectFrom('audit_log')
      .select(['id', 'row_hash'])
      .orderBy('id', 'desc')
      .limit(ANCHOR_LOOKBACK_ROWS)
      .execute();
    if (rows.length === 0) return;

    const anchorHash = createHash('sha256')
      .update(rows.map((r) => r.row_hash).join(''))
      .digest('hex');

    // pg returns int8 as a JS string; coerce to bigint so the BullMQ payload
    // round-trips without precision loss for any plausible row id.
    const start = BigInt(String(rows[rows.length - 1]!.id));
    const end = BigInt(String(rows[0]!.id));

    await this.queues.enqueue(
      'audit-anchor',
      { entity_id: 'audit-anchor-daily', delivery_channel: 'tsa' },
      { start, end, anchorHash },
    );
    this.logger.log({ count: rows.length, anchorHash }, 'audit anchor enqueued');
  }
}