import type { Kysely, RawBuilder } from 'kysely';
import { sql } from 'kysely';

import type { DB } from './types.js';

/**
 * Encrypt `plaintext` using the per-city DEK resolved by the
 * `pgp_sym_encrypt_for_column` SQL helper. The caller MUST have
 * `app.kek_material` SET on the connection (so `pii_dek` can unwrap the DEK).
 *
 * Returns the ciphertext hex-encoded — the bytea raw shape is a footgun to
 * pass back through pg parameters, and the test surface wants a stable
 * printable string anyway.
 */
export async function encryptPii(
  db: Kysely<DB>,
  args: { city_id: string; table: string; column: string; plaintext: string },
): Promise<string> {
  const { city_id, table, column, plaintext } = args;
  // ponytail: delegate to the registered SQL helper rather than inlining
  // `pgp_sym_encrypt` directly — the helper does the column-registry lookup
  // AND the KEK→DEK unwrap via `app.kek_material`, so encrypt and decrypt
  // end up using the same plaintext DEK bytes as the passphrase. Wrap the
  // bytea result in `encode(..., 'hex')` so the JS side gets a printable
  // shape it can round-trip back through `decode(..., 'hex')` later.
  const result = (await sql<{ c: string }>`
    SELECT encode(
      quart_security.pgp_sym_encrypt_for_column(${plaintext}, ${table}, ${column}, ${city_id}::uuid),
      'hex'
    ) AS c
  `.execute(db)) as { rows: { c: string }[] };
  const cipher = result.rows[0]?.c;
  if (!cipher) throw new Error('pgp_sym_encrypt_for_column returned no row');
  return cipher;
}
