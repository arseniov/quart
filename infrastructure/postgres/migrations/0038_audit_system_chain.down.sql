-- 0038_audit_system_chain.down.sql
-- Restore the pre-0014/0015 chain trigger body (per-city only, no
-- super-admin bypass on audit_log insert). Removing the city row
-- cascades to nothing (cities is referenced by audit_log with
-- ON DELETE RESTRICT, so delete would fail while system rows exist —
-- leave the sentinel in place; that's harmless without writers).

SET search_path = public, quart_security;

DROP POLICY IF EXISTS audit_log_insert_app ON audit_log;
CREATE POLICY audit_log_insert_app ON audit_log FOR INSERT TO quart_app
  WITH CHECK (city_id::text = current_setting('app.city_id', true));

DROP POLICY IF EXISTS audit_log_select_app ON audit_log;
CREATE POLICY audit_log_select_app ON audit_log FOR SELECT TO quart_app
  USING (city_id::text = current_setting('app.city_id', true));

-- Re-create the original (pre-sentinel) chain trigger. Note: any
-- system sentinel rows written under 0038 will continue to chain-link,
-- but tenant→sentinel transitions will look "broken" in the verify
-- walk until forward-fixed.
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
  PERFORM pg_advisory_xact_lock(hashtext(NEW.city_id::text));

  SELECT row_hash INTO prev_row_hash
  FROM audit_log
  WHERE city_id = NEW.city_id
  ORDER BY id DESC
  LIMIT 1;

  IF prev_row_hash IS NULL THEN
    prev_row_hash := '0000000000000000000000000000000000000000000000000000000000000000';
  END IF;

  SELECT id, hmac_key_encrypted INTO active_key_id, active_key_bytes
  FROM quart_security.audit_key_versions
  WHERE status = 'active'
  ORDER BY version DESC
  LIMIT 1;

  IF active_key_bytes IS NULL THEN
    RAISE EXCEPTION 'no active audit_key_version; cannot stamp audit chain';
  END IF;

  computed_row_hash := quart_security.compute_audit_row_hash(
    prev_row_hash,
    NEW.payload_canonical_sha256,
    active_key_bytes
  );

  NEW.prev_hash := prev_row_hash;
  NEW.row_hash := computed_row_hash;
  NEW.key_version_id := active_key_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_stamp_z_chain ON audit_log;
CREATE TRIGGER audit_log_stamp_z_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION quart_security.audit_log_chain_stamp();
