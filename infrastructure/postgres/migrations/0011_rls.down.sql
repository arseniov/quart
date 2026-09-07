-- 0011_rls.down.sql
-- Reverse Task 24: drop policies, disable RLS, revoke role grants.

SET search_path = public, quart_security;

-- ============================================================================
-- Drop policies + disable RLS on every table enabled in the .up.sql
-- ============================================================================

-- cities
DROP POLICY IF EXISTS cities_read_all    ON cities;
DROP POLICY IF EXISTS cities_admin_write ON cities;
ALTER TABLE cities DISABLE ROW LEVEL SECURITY;

-- city-scoped tables
DO $$
DECLARE t text;
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
    EXECUTE format('DROP POLICY IF EXISTS %I_scope ON %I', t, t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- child tables
DROP POLICY IF EXISTS issue_photos_scope        ON issue_photos;
DROP POLICY IF EXISTS issue_events_scope        ON issue_events;
DROP POLICY IF EXISTS poll_options_scope        ON poll_options;
DROP POLICY IF EXISTS comment_reactions_scope   ON comment_reactions;
DROP POLICY IF EXISTS notification_deliveries_scope ON notification_deliveries;
ALTER TABLE issue_photos         DISABLE ROW LEVEL SECURITY;
ALTER TABLE issue_events         DISABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options         DISABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reactions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries DISABLE ROW LEVEL SECURITY;

-- global catalogs
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permissions','roles','role_permissions','rbac_policies',
    'pii_columns','feature_flags','app_settings','dsar_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read_all    ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_write ON %I', t, t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- audit_log
DROP POLICY IF EXISTS audit_log_insert_app ON audit_log;
DROP POLICY IF EXISTS audit_log_select_app ON audit_log;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit_log FROM quart_app;
REVOKE USAGE ON SEQUENCE audit_log_id_seq FROM quart_app;
GRANT ALL ON audit_log TO PUBLIC;  -- restore default (matches pre-migration state)

-- audit_anchors
DROP POLICY IF EXISTS audit_anchors_insert_app ON audit_anchors;
DROP POLICY IF EXISTS audit_anchors_select_app ON audit_anchors;
ALTER TABLE audit_anchors DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit_anchors FROM quart_app;
GRANT ALL ON audit_anchors TO PUBLIC;

-- ============================================================================
-- quart_security schema
-- ============================================================================
REVOKE ALL ON SCHEMA quart_security FROM quart_app;
GRANT ALL ON SCHEMA quart_security TO PUBLIC;  -- restore default

-- ============================================================================
-- Roles
-- ============================================================================
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM quart_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM quart_app;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM quart_readonly;
DROP ROLE IF EXISTS quart_app;
DROP ROLE IF EXISTS quart_readonly;