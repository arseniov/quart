-- 0012_audit_city_id_trigger.down.sql
SET search_path = public, quart_security;

DROP TRIGGER IF EXISTS user_roles_scope_check ON user_roles;
DROP TRIGGER IF EXISTS audit_log_stamp_city ON audit_log;

DROP FUNCTION IF EXISTS quart_security.check_user_roles_scope();
DROP FUNCTION IF EXISTS quart_security.stamp_audit_city_id();