-- 0015_super_admin_read_bypass.up.sql
-- Add the super-admin bypass to all city-scoped RLS policies created by 0011.
-- Super-admins can now read/write across cities for platform support.
-- City-scoped policies become:
--   USING      (city_id::text = current_setting('app.city_id', true)
--               OR current_setting('app.is_super_admin', true) = 'true')
--   WITH CHECK (city_id::text = current_setting('app.city_id', true)
--               OR current_setting('app.is_super_admin', true) = 'true')
-- Child-table policies (issue_photos, etc.) get the same OR clause on the
-- inner city_id check.

SET search_path = public, quart_security;

-- ============================================================================
-- City-scoped tables (carry their own city_id column)
-- ============================================================================
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
    EXECUTE format($p$
      CREATE POLICY %I_scope ON %I
        FOR ALL TO quart_app
        USING      (city_id::text = current_setting('app.city_id', true)
                    OR current_setting('app.is_super_admin', true) = 'true')
        WITH CHECK (city_id::text = current_setting('app.city_id', true)
                    OR current_setting('app.is_super_admin', true) = 'true')
    $p$, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- Child tables (city_id derived from parent row)
-- ============================================================================

-- issue_photos → issues
ALTER TABLE issue_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_photos        FORCE  ROW LEVEL SECURITY;
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
ALTER TABLE issue_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_events        FORCE  ROW LEVEL SECURITY;
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
ALTER TABLE poll_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options         FORCE  ROW LEVEL SECURITY;
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
ALTER TABLE comment_reactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reactions         FORCE  ROW LEVEL SECURITY;
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
ALTER TABLE notification_deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries         FORCE  ROW LEVEL SECURITY;
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
