-- 0040_audit_global_chain.up.sql
-- gh #8 follow-up: 0038 left tenant rows chained per-city while sentinel
-- rows chained globally — the verify controller's id-ASC walk breaks the
-- moment a sentinel row interleaves with tenant rows (each city's chain
-- restarts from GENESIS on its first tenant row). Drop the per-city
-- branch; the chain becomes a single global sequence in id order, which
-- is what the verify controller + AuditService.writeSystem both assumed.
--
-- Why now (and not in 0038): 0038 ships the sentinel row + trigger rewrite
-- together, but the migration's own comment claimed "system events extend
-- the same chain as tenant events in id order" while leaving the tenant
-- branch reading per-city. gh #8's e2e surfaced the contradiction; this
-- migration fixes it without rewriting 0038 (already applied in envs).
--
-- SECURITY DEFINER so the chain-head SELECT inside the trigger runs as the
-- function owner (bootstrap role) and bypasses RLS. Without it, the
-- tenant-context caller can only see its own city's audit rows; the
-- global head read returns NULL and the chain forks at GENESIS for every
-- city's first row — the same break the brief calls out.
--
-- The advisory lock (`pg_advisory_xact_lock`) was already global in 0038,
-- so concurrency semantics survive — only the prev_hash lookup changes.
--
-- RLS-bypass contract: SECURITY DEFINER makes the chain-head SELECT run as
-- the function owner. That owner MUST bypass RLS (BYPASSRLS attribute) for
-- the SELECT to see rows in every city + the sentinel row. The migration
-- bootstrap role `quart` is a Postgres image SUPERUSER (which implicitly
-- bypasses RLS) today, so the trigger works — but if the role is ever
-- downgraded to non-superuser, BYPASSRLS must be granted explicitly:
--     ALTER ROLE quart BYPASSRLS;
-- This dependency is not silent: a missing bypass surfaces as the chain
-- silently forking at GENESIS on the first row of each city.
SET search_path = public, quart_security;

CREATE OR REPLACE FUNCTION quart_security.audit_log_chain_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, quart_security
AS $$
DECLARE
  prev_row_hash char(64);
  active_key_id uuid;
  active_key_bytes bytea;
  computed_row_hash text;
BEGIN
  -- Serialize chain appends. Lock is global (was already in 0038):
  -- tenant + sentinel rows contend so id-order stays correct.
  -- ponytail: same as 0038 — swap for per-city lock + sentinel-global
  -- lock when contention shows up in pgbouncer latency dashboards.
  PERFORM pg_advisory_xact_lock(hashtext('quart.audit_log'));

  -- Unified global chain: every row's prev_hash is the row_hash of the
  -- row with the immediately preceding id. SECURITY DEFINER above makes
  -- this SELECT bypass RLS so a tenant insert sees the sentinel head.
  SELECT row_hash INTO prev_row_hash
  FROM audit_log
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

-- SECURITY DEFINER switches the function's caller to its definer (the
-- migration bootstrap user, which bypasses RLS). Without an explicit
-- grant, only the definer can execute the function; re-grant to quart_app
-- so the trigger can fire for normal app traffic.
GRANT EXECUTE ON FUNCTION quart_security.audit_log_chain_stamp() TO quart_app;
