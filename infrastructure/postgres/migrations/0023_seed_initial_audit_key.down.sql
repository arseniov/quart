-- 0023_seed_initial_audit_key.down.sql
SET search_path = public;

-- audit_log.key_version_id has ON DELETE RESTRICT: this fails while signed rows exist.
DELETE FROM quart_security.audit_key_versions WHERE version = 1;
DELETE FROM quart_security.kek_versions WHERE version = 1 AND provider = 'local-dev';
