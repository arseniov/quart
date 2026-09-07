-- 0013_canonical_json_hmac.down.sql
SET search_path = public, quart_security;

DROP FUNCTION IF EXISTS quart_security.compute_audit_row_hash(text, text, bytea);
