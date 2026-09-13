-- 0031_push_subscriptions_status.down.sql
SET search_path = public;

DROP INDEX CONCURRENTLY IF EXISTS push_subscriptions_city_status_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS push_subscriptions_city_active_idx
  ON push_subscriptions (city_id, revoked_at);

ALTER TABLE push_subscriptions
  DROP COLUMN IF EXISTS invalidated_at,
  DROP COLUMN IF EXISTS status;
