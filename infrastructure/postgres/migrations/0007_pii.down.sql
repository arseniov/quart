-- 0007_pii.down.sql
DROP FUNCTION IF EXISTS quart_security.pgp_sym_decrypt_for_column(bytea, text, text, uuid);
DROP FUNCTION IF EXISTS quart_security.pgp_sym_encrypt_for_column(text, text, text, uuid);
DROP FUNCTION IF EXISTS quart_security.pii_dek(uuid, int);
DROP TABLE IF EXISTS pii_key_versions;
DROP TABLE IF EXISTS pii_columns;
DROP TYPE IF EXISTS quart_security.pii_encryption_mode;
