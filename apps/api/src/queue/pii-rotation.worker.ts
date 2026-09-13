import { Logger } from '@nestjs/common';
import type { DB } from '@quart/db';
import { Worker, type Job } from 'bullmq';
import type { Transaction } from 'kysely';

import type { ConfigService } from '../config/config.service.js';
import type { DbService } from '../db/db.service.js';
import { encryptDek } from '../pii/envelope.js';

import { parseValkeyUrl } from './connection.js';

const log = new Logger('PiiRotationWorker');

/** Stable BullMQ job-name on the `cleanup` queue. Other handlers on the same
 *  queue should use a different job-name; this one is the platform-initiated
 *  PII key rotation triggered by an admin action (no cron). */
export const ROTATE_PII_KEYS_JOB = 'rotate_pii_keys';

export interface RotatePiiKeysArgs {
  /** DEK plaintext as a hex string (the caller is the KMS, which decrypted the
   *  per-city DEK for re-wrap). Empty/missing throws. */
  dekPlaintext: string;
  /** New monotonically-increasing version number. Existing versions stay
   *  readable (status=`retiring`); only the new row is `active`. */
  version: number;
}

export interface RotatePiiKeysOpts {
  db: DbService;
  /** Base64-encoded 32-byte KEK. The worker does NOT source this from KMS;
   *  the caller (platform admin endpoint or CLI) passes it after KMS unwrap. */
  kekBase64: string;
}

/** Per-city rotation: in one transaction mark the city's active DEK `retiring`
 *  and insert a new active row at `args.version` carrying the KEK-wrapped DEK.
 *  The partial unique index `pii_key_versions_one_active_per_city_idx` makes a
 *  second insert at the same city with status='active' impossible — so retries
 *  that already saw the new row are caught and treated as success. */
export async function rotatePiiKeys(
  opts: RotatePiiKeysOpts,
  args: RotatePiiKeysArgs,
): Promise<{ cities: number }> {
  const dek = Buffer.from(args.dekPlaintext ?? '', 'hex');
  if (dek.length === 0) throw new Error('missing DEK plaintext');

  const kek = Buffer.from(opts.kekBase64 ?? '', 'base64');
  if (kek.length === 0) throw new Error('missing KEK_BASE64');
  const stored = encryptDek(dek, kek);

  // The KEK id stored alongside each DEK row is a foreign key. Resolve the
  // current active KEK once; if there isn't one, the whole rotation aborts.
  const activeKek = await opts.db.kysely
    .selectFrom('kek_versions')
    .select('id')
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!activeKek) throw new Error('no active KEK version');

  const cities = await opts.db.kysely.selectFrom('cities').select('id').execute();
  let rotated = 0;
  for (const c of cities) {
    try {
      await opts.db.kysely.transaction().execute(async (trx) => {
        await rotateOneCity(trx, c.id, args.version, stored, activeKek.id);
      });
      rotated += 1;
    } catch (err) {
      // UNIQUE (city_id) WHERE status='active' => a previous run already
      // produced the (city, active) pair we're trying to write. Swallow and
      // continue — the city is already rotated, which is what the caller wants.
      if (isUniqueViolation(err)) return { cities: rotated };
      throw err;
    }
  }
  return { cities: rotated };
}

async function rotateOneCity(
  trx: Transaction<DB>,
  cityId: string,
  version: number,
  dekEncrypted: Buffer,
  kekId: string,
): Promise<void> {
  // The Kysely TS types say `status: 'rotating'|'pending'` but the actual
  // `quart_security.key_status` enum is `'active'|'retiring'|'retired'`.
  // Cast at the call site rather than widening the shared DB types — only this
  // worker writes 'retiring'.
  await trx
    .updateTable('pii_key_versions')
    .set({ status: 'retiring' as never })
    .where('city_id', '=', cityId)
    .where('status', '=', 'active')
    .execute();
  await trx
    .insertInto('pii_key_versions')
    .values({
      city_id: cityId,
      version,
      status: 'active' as never,
      dek_encrypted: dekEncrypted,
      kek_id: kekId,
      activated_at: new Date(),
    })
    .execute();
}

/** Postgres unique_violation SQLSTATE — see `pg/lib/error codes`. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

export interface StartPiiRotationWorkerOpts {
  config: ConfigService;
  db: DbService;
}

/** BullMQ factory: a worker on the `cleanup` queue that consumes
 *  `rotate_pii_keys` jobs and dispatches them to {@link rotatePiiKeys}. Other
 *  job-names are ignored — multiple handlers share the queue. */
export function startPiiRotationWorker(opts: StartPiiRotationWorkerOpts): Worker {
  return new Worker(
    'cleanup',
    async (job: Job) => {
      if (job.name !== ROTATE_PII_KEYS_JOB) return;
      log.log(`rotate_pii_keys job ${job.id} starting`);
      await rotatePiiKeys(
        { db: opts.db, kekBase64: opts.config.env.KEK_BASE64 },
        job.data as RotatePiiKeysArgs,
      );
      log.log(`rotate_pii_keys job ${job.id} done`);
    },
    { connection: parseValkeyUrl(opts.config.env.VALKEY_URL) },
  );
}
