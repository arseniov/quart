-- 0038_audit_system_chain.up.sql
-- Add a sentinel city for pre-tenant audit events (magic-link consume,
-- password reset, etc.) so a TenantContext-free auth flow can still
-- write tamper-evident rows. audit_log.city_id is NOT NULL FK to
-- cities(id) and the stamp_audit_city_id trigger needs *some* city; the
-- chain trigger (0014) is per-city by default, so without this
-- migration a sentinel row would chain only to itself (every other
-- audit row lives in a real tenant city) and break the verify walk.
--
-- Chain integration: replace the trigger body so the sentinel uses the
-- GLOBAL last-id row's row_hash, not the per-city head. That way system
-- events extend the same chain as tenant events in id order — a verify
-- walk that interleaves them still validates. Per-city chains for real
-- tenant rows are unchanged.

SET search_path = public, quart_security;

-- 1. Sentinel city. status='inactive' so it never surfaces in user
-- flows. bounds=NULL because there's no polygon to draw. The fixed id
-- is referenced from writeSystem (audit.service.ts) — keep it in sync.
INSERT INTO cities (id, slug, name, country_code, locale_default, timezone, status, bounds)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  '__system',
  '__system (admin-managed; never user-facing)',
  'IT', 'it', 'UTC', 'inactive',
  NULL
) ON CONFLICT (id) DO NOTHING;

-- 2. Chain trigger: when NEW.city_id is the sentinel, derive prev_hash
-- from the global chain head instead of the per-city head. Locking
-- still serializes (one global lock for the sentinel, per-city for
-- everything else).
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
  sentinel_id uuid := '00000000-0000-0000-0000-000000000099';
BEGIN
  -- Serialize chain appends. Same lock for sentinel and tenant rows;
  -- the sentinel never contends with itself across cities (its chain
  -- is global), so a coarser global lock is fine.
  -- ponytail: a single xact_lock serializes every audit append. Swap
  -- for a per-city lock + a sentinel-global lock when contention shows
  -- up in pgbouncer latency dashboards.
  PERFORM pg_advisory_xact_lock(hashtext('quart.audit_log'));

  -- Most recent row_hash. Sentinel reads from the global chain head;
  -- tenant rows read from their per-city head (chain branches by city).
  IF NEW.city_id = sentinel_id THEN
    SELECT row_hash INTO prev_row_hash
    FROM audit_log
    ORDER BY id DESC
    LIMIT 1;
  ELSE
    SELECT row_hash INTO prev_row_hash
    FROM audit_log
    WHERE city_id = NEW.city_id
    ORDER BY id DESC
    LIMIT 1;
  END IF;

  IF prev_row_hash IS NULL THEN
    prev_row_hash := '0000000000000000000000000000000000000000000000000000000000000000';
  END IF;

  -- Resolve active HMAC key. Unchanged from 0014.
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

-- audit_log RLS:
--   * audit_log_insert_app — `city_id::text = app.city_id`. Adding the
--     super-admin bypass so audit writers can land sentinel rows when
--     they set app.is_super_admin=true (writeSystem does exactly this).
--   * audit_log_select_app — same `city_id::text = app.city_id` filter.
--     writeSystem needs to read the GLOBAL chain head (latest id's
--     row_hash across all cities) when computing the next prev_hash.
--     Without the bypass, the sentinel setting restricts reads to
--     sentinel rows only and the global chain walk breaks.
--
-- Both policies gain the super-admin OR branch (mirrors 0015's
-- pattern for tenant-scoped tables). SELECT bypass is needed by
-- writeSystem only; INSERT bypass is needed by both writeSystem and
-- any future admin tooling that walks audit_log cross-city.
DROP POLICY IF EXISTS audit_log_insert_app ON audit_log;
CREATE POLICY audit_log_insert_app ON audit_log FOR INSERT TO quart_app
  WITH CHECK (
    city_id::text = current_setting('app.city_id', true)
    OR current_setting('app.is_super_admin', true) = 'true'
  );

DROP POLICY IF EXISTS audit_log_select_app ON audit_log;
CREATE POLICY audit_log_select_app ON audit_log FOR SELECT TO quart_app
  USING (
    city_id::text = current_setting('app.city_id', true)
    OR current_setting('app.is_super_admin', true) = 'true'
  );
