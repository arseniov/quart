-- 0014_audit_chain_trigger.down.sql
DROP TRIGGER IF EXISTS audit_log_stamp_z_chain ON audit_log;
DROP FUNCTION IF EXISTS quart_security.audit_log_chain_stamp();
