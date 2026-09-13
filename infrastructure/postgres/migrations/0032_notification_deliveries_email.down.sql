-- 0032_notification_deliveries_email.down.sql
SET search_path = public;

DROP INDEX IF EXISTS notification_deliveries_notification_channel_idx;

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_recipient_chk,
  ALTER COLUMN push_subscription_id SET NOT NULL,
  DROP COLUMN IF EXISTS recipient_email,
  DROP COLUMN IF EXISTS channel;
