-- 0026_mfa_credentials.down.sql
SET search_path = public, quart_security;

DROP POLICY IF EXISTS mfa_credentials_scope ON mfa_credentials;
DROP INDEX IF EXISTS mfa_credentials_user_id_uniq;
DROP TABLE IF EXISTS mfa_credentials;