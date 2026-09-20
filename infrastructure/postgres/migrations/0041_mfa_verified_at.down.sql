-- 0041_mfa_verified_at.down.sql
SET search_path = public, quart_security;

ALTER TABLE mfa_credentials
  DROP COLUMN IF EXISTS verified_at;
