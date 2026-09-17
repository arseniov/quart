-- 0039_sentinel_admin_tables.up.sql
-- RLS policies for the pre-tenant "admin-managed" tables (magic_links,
-- password_resets) so AuditService.writeSystem's mutate callback can
-- INSERT/UPDATE them in the same transaction that appends the sentinel
-- audit row. Without these, the sentinel pathway surfaced by gh #8 hits
-- "new row violates row-level security policy" at runtime.
--
-- Background: 0033 (magic_links) and 0034 (password_resets) enable RLS
-- on the tables but ship with NO policies — design intent was "admin-
-- managed, bypass via service-layer", which worked when callers wrote
-- as the bootstrap role. gh #4 introduced AuditService.writeSystem,
-- which downgrades the inner tx to `quart_app` + `app.is_super_admin=true`
-- so the audit_log insert lands. The downgrade closed the loophole for
-- pre-tenant tables because quart_app + ENABLE RLS + no policy = DENY.
--
-- Fix mirrors 0038's audit_log policies: open the gate for quart_app
-- when the caller self-declares super-admin. Both tables are still
-- "admin-managed" from the operator's perspective — the policy just
-- expresses that the writeSystem sentinel pathway is the only legit
-- app-level caller. DROP ... IF EXISTS guards against re-apply.
SET search_path = public, quart_security;

DROP POLICY IF EXISTS magic_links_admin_write ON magic_links;
CREATE POLICY magic_links_admin_write ON magic_links
  FOR INSERT TO quart_app
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

DROP POLICY IF EXISTS magic_links_admin_read ON magic_links;
CREATE POLICY magic_links_admin_read ON magic_links
  FOR SELECT TO quart_app
  USING (current_setting('app.is_super_admin', true) = 'true');

DROP POLICY IF EXISTS magic_links_admin_update ON magic_links;
CREATE POLICY magic_links_admin_update ON magic_links
  FOR UPDATE TO quart_app
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

DROP POLICY IF EXISTS password_resets_admin_write ON password_resets;
CREATE POLICY password_resets_admin_write ON password_resets
  FOR INSERT TO quart_app
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

DROP POLICY IF EXISTS password_resets_admin_read ON password_resets;
CREATE POLICY password_resets_admin_read ON password_resets
  FOR SELECT TO quart_app
  USING (current_setting('app.is_super_admin', true) = 'true');

DROP POLICY IF EXISTS password_resets_admin_update ON password_resets;
CREATE POLICY password_resets_admin_update ON password_resets
  FOR UPDATE TO quart_app
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
