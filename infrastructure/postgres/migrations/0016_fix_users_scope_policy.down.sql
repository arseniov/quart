-- 0016_fix_users_scope_policy.down.sql
-- Re-apply 0011's pre-super-admin policies (broken on users; not safe to roll
-- back to unless 0011 is also being rolled back). Keeps DROP IF EXISTS so the
-- down is idempotent.
SET search_path = public, quart_security;

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
  END LOOP;
END $$;
