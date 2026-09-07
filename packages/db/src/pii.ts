import type { Kysely } from 'kysely';

import type { DB } from './types.js';

export async function encryptPii(
  db: Kysely<DB>,
  args: { city_id: string; table: string; column: string; plaintext: string },
): Promise<string> {
  const { city_id, table, column, plaintext } = args;
  const rows = await db
    .selectFrom('pii_key_versions as kv')
    .innerJoin('pii_columns as pc', 'pc.kek_id', 'kv.kek_id')
    .where('kv.city_id', '=', city_id)
    .where('kv.status', '=', 'active')
    .where('pc.table_name', '=', table)
    .where('pc.column_name', '=', column)
    .select((eb) =>
      eb.fn('pgp_sym_encrypt', [eb.val(plaintext), eb.ref('kv.dek_encrypted')]).as('cipher'),
    )
    .executeTakeFirstOrThrow();
  return String((rows as unknown as { cipher: string }).cipher);
}
