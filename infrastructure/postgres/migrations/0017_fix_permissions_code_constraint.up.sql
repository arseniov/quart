-- 0017_fix_permissions_code_constraint.up.sql
-- GH #56: 0003_rbac declared `permissions.code` with a regex of exactly
-- one dot (`^[a-z_]+\.[a-z_]+$`), but the seed in
-- 0021_seed_roles_permissions inserts namespaced codes like
-- `admin.users.role.write` (3 dots), and 0028_i18n_permission inserts
-- `admin.i18n.write` which contains digits (`1`/`8`). The constraint
-- must be loosened BEFORE 0021/0028 run, otherwise the INSERTs fail
-- and a pre-existing fix (0024, since deleted) never gets a chance to
-- run. Now widened to one-or-more dot-separated segments of letters,
-- digits, and underscores — covers 0021, 0027, 0028, 0035.
--
-- Slot chosen at 0017 so it sorts BEFORE 0021 alphabetically (0017 < 0020
-- < 0021).
SET search_path = public;

ALTER TABLE permissions DROP CONSTRAINT permissions_code_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_code_check
  CHECK (code ~ '^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$');
