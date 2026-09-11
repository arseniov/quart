-- 0024_fix_permissions_code_constraint.up.sql
SET search_path = public;

-- The original constraint from 0003_rbac only allowed exactly one dot.
-- 0021_seed_roles_permissions inserts namespaced codes like
-- `admin.issues.read` (2 dots) and `admin.users.role.write` (3 dots),
-- which violate that pattern. Widen the constraint to one-or-more
-- dot-separated segments of [a-z_].

ALTER TABLE permissions DROP CONSTRAINT permissions_code_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_code_check
  CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$');

-- Sanity check: every code currently in the table must match the new
-- pattern. If 0021 has not been applied yet, this is a no-op (the only
-- rows would have been the seed that just ran). If anything was inserted
-- with a malformed code, fail loudly rather than silently letting the
-- migration appear successful.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM permissions
    WHERE code !~ '^[a-z_]+(\.[a-z_]+)+$'
  ) THEN
    RAISE EXCEPTION 'permissions_code_check: existing rows violate new pattern';
  END IF;
END
$$;
