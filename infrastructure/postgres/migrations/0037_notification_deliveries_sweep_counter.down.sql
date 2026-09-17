-- 0037_notification_deliveries_sweep_counter.down.sql
SET search_path = public;

ALTER TABLE notification_deliveries
  DROP COLUMN IF EXISTS last_swept_at;

ALTER TABLE notification_deliveries
  DROP COLUMN IF EXISTS sweep_attempts;
