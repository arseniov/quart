-- 0006_audit.down.sql
DROP TABLE IF EXISTS audit_anchors;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS quart_security.audit_key_versions;
DROP TABLE IF EXISTS quart_security.kek_versions;
DROP TYPE IF EXISTS quart_security.key_status;
-- Schema left in place: later migrations own the GRANTs / REVOKEs and may add objects.