-- 0013_canonical_json_hmac.up.sql
-- SQL mirror of computeRowHash() in packages/db/src/audit.ts so a chain walk can
-- verify audit_log rows from either side (app or DB) as the reference.
-- Key is the plaintext HMAC key of the active audit key_version, unwrapped by the
-- caller and passed in as bytea — this function never touches the KEK.
SET search_path = public, quart_security;

-- Compute HMAC-SHA256 of (prev_hash || payload_canonical_sha256).
CREATE OR REPLACE FUNCTION quart_security.compute_audit_row_hash(
  prev_hash text,
  payload_canonical_sha256 text,
  hmac_key_bytes bytea
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    hmac(convert_to(prev_hash || payload_canonical_sha256, 'UTF8'), hmac_key_bytes, 'sha256'),
    'hex'
  );
$$;
