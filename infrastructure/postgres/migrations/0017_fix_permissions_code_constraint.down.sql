-- 0017_fix_permissions_code_constraint.down.sql
-- Restore a constraint compatible with the post-GH-#56 data shape (same
-- wider pattern as 0017.up.sql). Down-migrating to 0003's original
-- single-dot regex is irreversible now: 0021/0027/0028/0035 all have
-- namespaced codes (some with digits) that violate it. This down only
-- re-applies the same wide constraint — it does NOT restore the old one.
SET search_path = public;

ALTER TABLE permissions DROP CONSTRAINT permissions_code_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_code_check
  CHECK (code ~ '^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$');
