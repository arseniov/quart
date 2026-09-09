import type { TenantContext } from '@quart/shared-types';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

export type { TenantContext };

/**
 * Runs `fn` inside a Postgres transaction with per-request RLS settings
 * bound via SET LOCAL (transaction-scoped, NOT session-scoped).
 *
 * Kysely handles BEGIN / COMMIT / ROLLBACK via the driver; we only emit the
 * RLS GUCs and `SET LOCAL ROLE quart_app` inside the open transaction.
 */
export async function runInTenantTx<DB, T>(
  db: Kysely<DB>,
  ctx: TenantContext,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE quart_app`.execute(trx);
    await sql`SET LOCAL app.city_id = ${ctx.cityId}`.execute(trx);
    await sql`SET LOCAL app.user_id = ${ctx.userId ?? ''}`.execute(trx);
    await sql`SET LOCAL app.is_super_admin = ${ctx.isSuperAdmin ? 'true' : 'false'}`.execute(
      trx,
    );
    await sql`SET LOCAL app.request_id = ${ctx.requestId}`.execute(trx);
    return fn(trx);
  });
}
