-- 0015_super_admin_read_bypass.down.sql
-- Revert to city-only scoping (0011 behavior). Recreates the original
-- predicates without the is_super_admin OR clause.

SET search_path = public, quart_security;

-- ============================================================================
-- City-scoped tables
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
        USING      (city_id::text = current_setting('app.city_id', true))
        WITH CHECK (city_id::text = current_setting('app.city_id', true))
    $p$, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- Child tables
-- ============================================================================

-- issue_photos → issues
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
CREATE POLICY notification_deliveries_scope ON notification_deliveries FOR ALL TO quart_app
  USING (EXISTS (
    SELECT 1 FROM notifications
    WHERE notifications.id = notification_deliveries.notification_id
      AND notifications.city_id::text = current_setting('app.city_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM notifications
    WHERE notifications.id = notification_deliveries.notification_id
      AND notifications.city_id::text = current_setting('app.city_id', true)));
