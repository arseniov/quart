-- 0024_fix_permissions_code_constraint.down.sql
SET search_path = public;

-- Restore the original single-dot constraint from 0003_rbac.
-- This will fail if 0021 namespaced rows (e.g. `admin.issues.read`,
-- `admin.users.role.write`) are still present, because they violate
-- the original regex. That is intentional: down-migrating across a
-- data shape change is not reversible without data loss.

ALTER TABLE permissions DROP CONSTRAINT permissions_code_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_code_check
  CHECK (code ~ '^[a-z_]+\.[a-z_]+$');
