-- 0014_audit_chain_trigger.up.sql
-- BEFORE INSERT trigger on audit_log that tamper-evidentially stamps
-- prev_hash, row_hash, and key_version_id from the active HMAC key.
-- Client-supplied hash values are overridden; RLS already denies UPDATE/DELETE,
-- so the chain becomes genuine tamper-evidence rather than after-the-fact
-- verification.
--
-- Key resolution: single GLOBAL active key from quart_security.audit_key_versions
-- (verified against 0006_audit.up.sql — no per-city keys exist).
--
-- Concurrency: a per-city advisory xact_lock serializes chain appends so two
-- concurrent INSERTs cannot fork the chain.

SET search_path = public, quart_security;

CREATE OR REPLACE FUNCTION quart_security.audit_log_chain_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, quart_security
AS $$
DECLARE
  prev_row_hash char(64);
  active_key_id uuid;
  active_key_bytes bytea;
  computed_row_hash text;
BEGIN
  -- Serialize per-city chain appends; released automatically at txn end.
  -- ponytail: advisory lock, swap for SELECT ... FOR UPDATE on a per-city
  -- chain-head row when lock contention becomes measurable.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.city_id::text));

  -- 1. Most recent row_hash for this city (per-city chain).
  SELECT row_hash INTO prev_row_hash
  FROM audit_log
  WHERE city_id = NEW.city_id
  ORDER BY id DESC
  LIMIT 1;

  -- 2. Genesis prev_hash if this city has no rows yet.
  IF prev_row_hash IS NULL THEN
    prev_row_hash := '0000000000000000000000000000000000000000000000000000000000000000';
  END IF;

  -- 3. Resolve the active HMAC key. Single global active key (no per-city keys).
  SELECT id, hmac_key_encrypted INTO active_key_id, active_key_bytes
  FROM quart_security.audit_key_versions
  WHERE status = 'active'
  LIMIT 1;

  IF active_key_bytes IS NULL THEN
    RAISE EXCEPTION 'no active audit_key_version; cannot stamp audit chain';
  END IF;

  -- 4. Compute row_hash via the existing immutable helper (schema-qualified).
  computed_row_hash := quart_security.compute_audit_row_hash(
    prev_row_hash,
    NEW.payload_canonical_sha256,
    active_key_bytes
  );

  -- 5. Override anything the client tried to set.
  NEW.prev_hash := prev_row_hash;
  NEW.row_hash := computed_row_hash;
  NEW.key_version_id := active_key_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_chain_stamp ON audit_log;
CREATE TRIGGER audit_log_chain_stamp
  BEFORE INSERT ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION quart_security.audit_log_chain_stamp();

-- Reaffirm INSERT-only surface (defensive — already set in 0011_rls.up.sql).
REVOKE ALL ON audit_log FROM PUBLIC;
GRANT INSERT, SELECT ON audit_log TO quart_app;
