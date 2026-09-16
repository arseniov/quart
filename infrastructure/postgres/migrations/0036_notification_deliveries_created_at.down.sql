-- 0036_notification_deliveries_created_at.down.sql
SET search_path = public;

DROP INDEX IF EXISTS notification_deliveries_pending_created_at_idx;

ALTER TABLE notification_deliveries
  DROP COLUMN IF EXISTS created_at;