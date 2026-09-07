-- 0012_audit_city_id_trigger.up.sql
-- audit_log.city_id is stamped by a trigger — the API cannot lie about it.
-- user_roles area/neighborhood scopes must belong to the declared city_id.
SET search_path = public, quart_security;

CREATE OR REPLACE FUNCTION quart_security.stamp_audit_city_id()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.city_id IS NULL THEN
    NEW.city_id := current_setting('app.city_id', true)::uuid;
  END IF;
  IF NEW.city_id IS NULL THEN
    RAISE EXCEPTION 'audit_log row missing city_id (no app.city_id setting)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_log_stamp_city ON audit_log;
CREATE TRIGGER audit_log_stamp_city
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION quart_security.stamp_audit_city_id();

CREATE OR REPLACE FUNCTION quart_security.check_user_roles_scope()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.area_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM city_areas WHERE id = NEW.area_id AND city_id = NEW.city_id
    ) THEN
      RAISE EXCEPTION 'user_roles.area_id (%) does not belong to city_id (%)', NEW.area_id, NEW.city_id;
    END IF;
  END IF;
  IF NEW.neighborhood_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM neighborhoods WHERE id = NEW.neighborhood_id AND city_id = NEW.city_id
    ) THEN
      RAISE EXCEPTION 'user_roles.neighborhood_id (%) does not belong to city_id (%)', NEW.neighborhood_id, NEW.city_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_roles_scope_check ON user_roles;
CREATE TRIGGER user_roles_scope_check
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION quart_security.check_user_roles_scope();