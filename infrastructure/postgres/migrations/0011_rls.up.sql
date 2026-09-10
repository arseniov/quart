-- 0011_rls.up.sql
-- Enable row-level security on all content tables.
-- Scoping: every domain row carries city_id and is filtered by `app.city_id`.
-- Child rows (issue_photos, etc.) derive city from their parent.
-- Global catalogs (permissions, feature_flags, etc.) are read-all, admin-write.
-- audit_log / audit_anchors are insert-only — no UPDATE/DELETE policies exist.

SET search_path = public, quart_security;

-- ============================================================================
-- Roles
-- ============================================================================

-- App role used by API + worker.
DO $$ BEGIN
  CREATE ROLE quart_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Read-only role for analytics (post-POC; created now for completeness).
DO $$ BEGIN
  CREATE ROLE quart_readonly NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO quart_app, quart_readonly;

-- quart_readonly: SELECT on everything in public, future tables included.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO quart_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO quart_readonly;

-- quart_app: full DML on public, future tables included.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quart_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quart_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quart_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quart_app;

-- ============================================================================
-- cities: catalog (read-all, admin-write)
-- ============================================================================
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cities_read_all    ON cities;
DROP POLICY IF EXISTS cities_admin_write ON cities;
CREATE POLICY cities_read_all ON cities
  FOR SELECT USING (true);  -- catalog: city discovery is global
CREATE POLICY cities_admin_write ON cities
  FOR ALL TO quart_app
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

-- ============================================================================
-- city-scoped tables: filter by app.city_id
-- ============================================================================
DO $$
DECLARE t text; col text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'city_areas','neighborhoods','user_neighborhoods',
    'users',
    'topics','topic_categories','issue_categories','topic_user_subscriptions',
    'issues','ideas','idea_votes','polls','poll_votes','comments',
    'user_roles','user_permissions',
    'pii_key_versions',
    'notifications','push_subscriptions'
  ] LOOP
    col := CASE WHEN t = 'users' THEN 'default_city_id' ELSE 'city_id' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I_scope ON %I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_scope ON %I
        FOR ALL TO quart_app
        USING      (%I::text = current_setting('app.city_id', true))
        WITH CHECK (%I::text = current_setting('app.city_id', true))
    $p$, t, t, col, col);
  END LOOP;
END $$;

-- ============================================================================
-- child tables: city derived from parent
-- ============================================================================

-- issue_photos → issues
ALTER TABLE issue_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_photos        FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issue_photos_scope ON issue_photos;
CREATE POLICY issue_photos_scope ON issue_photos FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = issue_photos.issue_id
      AND issues.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = issue_photos.issue_id
      AND issues.city_id::text = current_setting('app.city_id', true)));

-- issue_events → issues
ALTER TABLE issue_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_events        FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issue_events_scope ON issue_events;
CREATE POLICY issue_events_scope ON issue_events FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = issue_events.issue_id
      AND issues.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM issues
    WHERE issues.id = issue_events.issue_id
      AND issues.city_id::text = current_setting('app.city_id', true)));

-- poll_options → polls
ALTER TABLE poll_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options         FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS poll_options_scope ON poll_options;
CREATE POLICY poll_options_scope ON poll_options FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM polls
    WHERE polls.id = poll_options.poll_id
      AND polls.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM polls
    WHERE polls.id = poll_options.poll_id
      AND polls.city_id::text = current_setting('app.city_id', true)));

-- comment_reactions → comments
ALTER TABLE comment_reactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reactions         FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_reactions_scope ON comment_reactions;
CREATE POLICY comment_reactions_scope ON comment_reactions FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM comments
    WHERE comments.id = comment_reactions.comment_id
      AND comments.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM comments
    WHERE comments.id = comment_reactions.comment_id
      AND comments.city_id::text = current_setting('app.city_id', true)));

-- notification_deliveries → notifications
ALTER TABLE notification_deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries         FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_deliveries_scope ON notification_deliveries;
CREATE POLICY notification_deliveries_scope ON notification_deliveries FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM notifications
    WHERE notifications.id = notification_deliveries.notification_id
      AND notifications.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM notifications
    WHERE notifications.id = notification_deliveries.notification_id
      AND notifications.city_id::text = current_setting('app.city_id', true)));

-- ============================================================================
-- global catalogs: read-all to quart_app, admin-write
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permissions','roles','role_permissions','rbac_policies',
    'pii_columns','feature_flags','app_settings','dsar_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read_all    ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_write ON %I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_read_all ON %I FOR SELECT USING (true)
    $p$, t, t);
    EXECUTE format($p$
      CREATE POLICY %I_admin_write ON %I FOR ALL TO quart_app
        USING      (current_setting('app.is_super_admin', true) = 'true')
        WITH CHECK (current_setting('app.is_super_admin', true) = 'true')
    $p$, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- audit_log: insert-only from app role
-- ============================================================================
REVOKE ALL ON audit_log FROM PUBLIC;
GRANT INSERT, SELECT ON audit_log TO quart_app;
GRANT USAGE  ON SEQUENCE audit_log_id_seq TO quart_app;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_insert_app ON audit_log;
DROP POLICY IF EXISTS audit_log_select_app ON audit_log;
CREATE POLICY audit_log_insert_app ON audit_log FOR INSERT TO quart_app
  WITH CHECK (city_id::text = current_setting('app.city_id', true));
CREATE POLICY audit_log_select_app ON audit_log FOR SELECT TO quart_app
  USING  (city_id::text = current_setting('app.city_id', true));
-- No UPDATE / DELETE policies ⇒ denied by RLS.

-- ============================================================================
-- audit_anchors: insert-only from worker
-- ============================================================================
REVOKE ALL ON audit_anchors FROM PUBLIC;
GRANT INSERT, SELECT ON audit_anchors TO quart_app;
ALTER TABLE audit_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_anchors FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_anchors_insert_app ON audit_anchors;
DROP POLICY IF EXISTS audit_anchors_select_app ON audit_anchors;
CREATE POLICY audit_anchors_insert_app ON audit_anchors FOR INSERT TO quart_app
  WITH CHECK (true);  -- anchors are city-agnostic (TSA Merkle roots)
CREATE POLICY audit_anchors_select_app ON audit_anchors FOR SELECT TO quart_app
  USING  (true);
-- No UPDATE / DELETE policies ⇒ denied by RLS.

-- ============================================================================
-- quart_security schema: app role can use it
-- ============================================================================
REVOKE ALL ON SCHEMA quart_security FROM PUBLIC;
GRANT USAGE  ON SCHEMA quart_security TO quart_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES    IN SCHEMA quart_security TO quart_app;
GRANT EXECUTE                  ON ALL FUNCTIONS IN SCHEMA quart_security TO quart_app;
