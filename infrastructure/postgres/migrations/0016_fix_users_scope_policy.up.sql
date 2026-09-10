-- 0016_fix_users_scope_policy.up.sql
-- 0011 declared users_scope using users.city_id, but the column is default_city_id.
-- Applying 0011 (and 0015's super-admin bypass loop) to a fresh DB fails at the
-- 'users' row of the city-scoped DO block; the entire DO transaction rolls back,
-- so RLS never gets enabled on the other 18 city-scoped tables either. 0015 has
-- the same users bug, plus its child-table CREATE POLICYs don't DROP IF EXISTS
-- first, so they also error on a fresh DB.
--
-- 0016 re-applies 0011 + 0015 with the correct column for users. Every DROP and
-- CREATE is idempotent so re-running 0016 is safe. Cities/global/audit policies
-- that 0011 did commit get the super-admin bypass here too (0015 never gets a
-- chance on a fresh DB).
SET search_path = public, quart_security;

-- ============================================================================
-- City-scoped tables: app.city_id filter + super-admin bypass.
-- ============================================================================
DO $$
DECLARE t text;
  col text;
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
        USING      (%I::text = current_setting('app.city_id', true)
                    OR current_setting('app.is_super_admin', true) = 'true')
        WITH CHECK (%I::text = current_setting('app.city_id', true)
                    OR current_setting('app.is_super_admin', true) = 'true')
    $p$, t, t, col, col);
  END LOOP;
END $$;

-- ============================================================================
-- Child tables: city derived from parent + super-admin bypass.
-- ============================================================================
DO $$
BEGIN
  -- issue_photos → issues
  ALTER TABLE issue_photos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE issue_photos FORCE  ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS issue_photos_scope ON issue_photos;
  CREATE POLICY issue_photos_scope ON issue_photos FOR ALL TO quart_app
    USING (current_setting('app.is_super_admin', true) = 'true'
           OR EXISTS (
             SELECT 1 FROM issues
             WHERE issues.id = issue_photos.issue_id
               AND issues.city_id::text = current_setting('app.city_id', true)))
    WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                OR EXISTS (
                  SELECT 1 FROM issues
                  WHERE issues.id = issue_photos.issue_id
                    AND issues.city_id::text = current_setting('app.city_id', true)));

  -- issue_events → issues
  ALTER TABLE issue_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE issue_events FORCE  ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS issue_events_scope ON issue_events;
  CREATE POLICY issue_events_scope ON issue_events FOR ALL TO quart_app
    USING (current_setting('app.is_super_admin', true) = 'true'
           OR EXISTS (
             SELECT 1 FROM issues
             WHERE issues.id = issue_events.issue_id
               AND issues.city_id::text = current_setting('app.city_id', true)))
    WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                OR EXISTS (
                  SELECT 1 FROM issues
                  WHERE issues.id = issue_events.issue_id
                    AND issues.city_id::text = current_setting('app.city_id', true)));

  -- poll_options → polls
  ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
  ALTER TABLE poll_options FORCE  ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS poll_options_scope ON poll_options;
  CREATE POLICY poll_options_scope ON poll_options FOR ALL TO quart_app
    USING (current_setting('app.is_super_admin', true) = 'true'
           OR EXISTS (
             SELECT 1 FROM polls
             WHERE polls.id = poll_options.poll_id
               AND polls.city_id::text = current_setting('app.city_id', true)))
    WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                OR EXISTS (
                  SELECT 1 FROM polls
                  WHERE polls.id = poll_options.poll_id
                    AND polls.city_id::text = current_setting('app.city_id', true)));

  -- comment_reactions → comments
  ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE comment_reactions FORCE  ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS comment_reactions_scope ON comment_reactions;
  CREATE POLICY comment_reactions_scope ON comment_reactions FOR ALL TO quart_app
    USING (current_setting('app.is_super_admin', true) = 'true'
           OR EXISTS (
             SELECT 1 FROM comments
             WHERE comments.id = comment_reactions.comment_id
               AND comments.city_id::text = current_setting('app.city_id', true)))
    WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                OR EXISTS (
                  SELECT 1 FROM comments
                  WHERE comments.id = comment_reactions.comment_id
                    AND comments.city_id::text = current_setting('app.city_id', true)));

  -- notification_deliveries → notifications
  ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE notification_deliveries FORCE  ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS notification_deliveries_scope ON notification_deliveries;
  CREATE POLICY notification_deliveries_scope ON notification_deliveries FOR ALL TO quart_app
    USING (current_setting('app.is_super_admin', true) = 'true'
           OR EXISTS (
             SELECT 1 FROM notifications
             WHERE notifications.id = notification_deliveries.notification_id
               AND notifications.city_id::text = current_setting('app.city_id', true)))
    WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                OR EXISTS (
                  SELECT 1 FROM notifications
                  WHERE notifications.id = notification_deliveries.notification_id
                    AND notifications.city_id::text = current_setting('app.city_id', true)));
END $$;

-- ============================================================================
-- Global catalogs: read-all, admin-write with super-admin bypass.
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
-- audit_log: insert + select with super-admin bypass on read.
-- (insert is the city being written about, so no bypass there.)
-- ============================================================================
DROP POLICY IF EXISTS audit_log_select_app ON audit_log;
CREATE POLICY audit_log_select_app ON audit_log FOR SELECT TO quart_app
  USING  (city_id::text = current_setting('app.city_id', true)
          OR current_setting('app.is_super_admin', true) = 'true');
