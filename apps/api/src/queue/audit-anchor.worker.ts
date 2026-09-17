import { createHash } from 'node:crypto';

import { Worker, type Job } from 'bullmq';

import type { ConfigService } from '../config/config.service.js';
import type { DbService } from '../db/db.service.js';

import { parseValkeyUrl } from './connection.js';

// ponytail: latest 10k audit_log rows is fine until the chain exceeds ~25 MB of
// row_hash strings per day (~1k rows/s). At higher throughput split by city or
// shard by hour, then move to a real Merkle tree.
const ANCHOR_LOOKBACK_ROWS = 10_000;
// ponytail: 10s default for free TSAs (usually slow). Read from config when a
// paid TSA starts timing out and we need to tune the budget.
const TSA_TIMEOUT_MS = 10_000;

export interface AnchorRange {
  start: bigint;
  end: bigint;
  // SHA-256 concatenation hash of the latest audit_log row_hash sequence.
  // Renamed from `merkleRoot` (T35 deviation #1) — it isn't a Merkle tree root.
  anchorHash: string;
}

/** Read the latest audit_log row_hash sequence and return an AnchorRange.
 *  Returns null when the table is empty so the handler can no-op cleanly. */
export async function computeAnchorRange(db: DbService): Promise<AnchorRange | null> {
  const rows = await db.kysely
    .selectFrom('audit_log')
    .select(['id', 'row_hash'])
    .orderBy('id', 'desc')
    .limit(ANCHOR_LOOKBACK_ROWS)
    .execute();
  if (rows.length === 0) return null;

  const anchorHash = createHash('sha256')
    .update(rows.map((r) => r.row_hash).join(''))
    .digest('hex');

  // pg returns int8 as a JS string; coerce to bigint so the BullMQ payload
  // round-trips without precision loss for any plausible row id.
  const start = BigInt(String(rows[rows.length - 1]!.id));
  const end = BigInt(String(rows[0]!.id));

  return { start, end, anchorHash };
}

/** BullMQ job handler: recompute the AnchorRange from live `audit_log` state
 *  (the repeatable's payload is just a trigger; the data always comes from the
 *  DB so retries are safe even if the schedule drifted) and submit it. */
export async function auditAnchorHandler(opts: { config: ConfigService; db: DbService; fetch?: typeof fetch }) {
  const range = await computeAnchorRange(opts.db);
  if (range === null) return;
  return runAuditAnchor({ ...opts, range });
}

export interface RunAuditAnchorOpts {
  config: ConfigService;
  db: DbService;
  /** Injected for tests; defaults to the global `fetch` in production. */
  fetch?: typeof fetch;
  range: AnchorRange;
}

/** Submit the daily anchor hash to the configured TSA (RFC 3161) and persist
 *  the signed response. Refuses to run unless `QUART_ALLOW_FREE_TSA=true`
 *  because free TSAs (e.g. freetsa.org) are for dev only — production must
 *  anchor through a paid, audited TSA provider. */
export async function runAuditAnchor(opts: RunAuditAnchorOpts): Promise<{ ok: true; certSha: string }> {
  if (!opts.config.env.QUART_ALLOW_FREE_TSA) {
    throw new Error('refusing to anchor: QUART_ALLOW_FREE_TSA is false (free TSA disabled in this env)');
  }
  const body = Buffer.from(opts.range.anchorHash, 'hex');
  const r = await (opts.fetch ?? fetch)(opts.config.env.TSA_URL, {
    method: 'POST',
    body,
    // Cap TSA RTT so a hung free TSA doesn't pin BullMQ worker capacity.
    signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`TSA ${r.status}`);
  const tsaBytes = Buffer.from(await r.arrayBuffer());
  const certSha = createHash('sha256').update(tsaBytes).digest('hex');

  // pg returns int8 (bigint) as a JS string at runtime; the Kysely column is
  // typed `string` (see AuditAnchorsTable in packages/db/src/types.ts).
  await opts.db.kysely
    .insertInto('audit_anchors')
    .values({
      anchor_hash: opts.range.anchorHash,
      row_range_start: opts.range.start.toString(),
      row_range_end: opts.range.end.toString(),
      tsa_response: tsaBytes,
      tsa_url: opts.config.env.TSA_URL,
      tsa_cert_sha256: certSha,
      anchored_at: new Date(),
    })
    // BullMQ retries can re-run the same handler after a partial TSA success.
    // UNIQUE(anchor_hash) keeps the row idempotent; doNothing makes the retry
    // a no-op instead of throwing an `ON CONFLICT DO UPDATE` shape we don't want.
    .onConflict((oc) => oc.column('anchor_hash').doNothing())
    .execute();
  return { ok: true, certSha };
}

export function startAuditAnchorWorker(opts: { config: ConfigService; db: DbService }): Worker {
  return new Worker('audit-anchor', async (_job: Job) => auditAnchorHandler(opts), {
    connection: parseValkeyUrl(opts.config.env.VALKEY_URL),
  });
}
