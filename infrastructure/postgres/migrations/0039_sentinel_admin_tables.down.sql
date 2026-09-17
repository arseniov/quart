-- 0039_sentinel_admin_tables.down.sql
DROP POLICY IF EXISTS magic_links_admin_write   ON magic_links;
DROP POLICY IF EXISTS magic_links_admin_read    ON magic_links;
DROP POLICY IF EXISTS magic_links_admin_update  ON magic_links;
DROP POLICY IF EXISTS password_resets_admin_write ON password_resets;
DROP POLICY IF EXISTS password_resets_admin_read  ON password_resets;
DROP POLICY IF EXISTS password_resets_admin_update ON password_resets;
