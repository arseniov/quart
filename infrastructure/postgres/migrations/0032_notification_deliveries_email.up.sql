-- 0032_notification_deliveries_email.up.sql
-- Per-channel fan-out (T38). Existing rows are push (push_subscription_id NOT
-- NULL); the new `channel` column defaults to 'push' so the migration is a
-- pure schema addition for the existing data. `push_subscription_id` becomes
-- nullable so email rows can leave it NULL. `recipient_email` carries the
-- captured email for the email channel so the worker doesn't need to re-look
-- up the user (also keeps a delivery record even if the user later changes
-- their email).
SET search_path = public;

ALTER TABLE notification_deliveries
  ADD COLUMN channel text NOT NULL DEFAULT 'push'
    CHECK (channel IN ('push','email')),
  ADD COLUMN recipient_email citext NULL,
  ALTER COLUMN push_subscription_id DROP NOT NULL;

-- ponytail: covering index for "show me every email delivery for this
-- notification" — small per-notification scans, no need for a wider index.
CREATE INDEX IF NOT EXISTS notification_deliveries_notification_channel_idx
  ON notification_deliveries (notification_id, channel);
