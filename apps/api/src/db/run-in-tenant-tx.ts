import type { TenantContext } from '@quart/shared-types';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

export type { TenantContext };

/**
 * Quote a string as a Postgres string literal (`'foo'` with embedded `''`
 * escapes). Matches `escape_string_literal` semantics so the resulting
 * literal is safe to embed inside any SQL statement.
 */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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
    // Postgres' SET LOCAL doesn't accept bind parameters in the extended
    // query protocol — `SET LOCAL ROLE $1` is a syntax error. Render the
    // statements as raw SQL and quote the user-supplied values into the
    // string ourselves. Inputs are typed (UUID, opaque request-id,
    // boolean string) so the literal-interpolation surface is tiny and
    // each value passes through a quote-and-escape helper.
    await sql
      .raw(
        `SET LOCAL ROLE quart_app;\n` +
          `SET LOCAL app.city_id = ${quoteLiteral(ctx.cityId)};\n` +
          `SET LOCAL app.user_id = ${quoteLiteral(ctx.userId ?? '')};\n` +
          `SET LOCAL app.is_super_admin = ${ctx.isSuperAdmin ? 'true' : 'false'};\n` +
          `SET LOCAL app.request_id = ${quoteLiteral(ctx.requestId)};`,
      )
      .execute(trx);
    return fn(trx);
  });
}
