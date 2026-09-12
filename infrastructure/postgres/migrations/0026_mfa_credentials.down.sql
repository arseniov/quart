-- 0026_mfa_credentials.down.sql
SET search_path = public, quart_security;

DROP POLICY IF EXISTS mfa_credentials_scope ON mfa_credentials;
DROP TABLE IF EXISTS mfa_credentials;