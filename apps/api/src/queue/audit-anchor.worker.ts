import { createHash } from 'node:crypto';

import { Worker, type Job } from 'bullmq';

import type { ConfigService } from '../config/config.service.js';
import type { DbService } from '../db/db.service.js';

import { parseValkeyUrl } from './connection.js';

export interface AnchorRange {
  start: bigint;
  end: bigint;
  // SHA-256 concatenation hash of the latest audit_log row_hash sequence.
  // Renamed from `merkleRoot` (T35 deviation #1) — it isn't a Merkle tree root.
  anchorHash: string;
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
  const r = await (opts.fetch ?? fetch)(opts.config.env.TSA_URL, { method: 'POST', body });
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
    .execute();
  return { ok: true, certSha };
}

export function startAuditAnchorWorker(opts: { config: ConfigService; db: DbService }): Worker {
  return new Worker(
    'audit-anchor',
    async (job: Job) => runAuditAnchor({ ...opts, range: job.data as AnchorRange }),
    { connection: parseValkeyUrl(opts.config.env.VALKEY_URL) },
  );
}