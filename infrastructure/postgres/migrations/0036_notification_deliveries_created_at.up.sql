-- 0036_notification_deliveries_created_at.up.sql
-- Background sweeper for pending notification_deliveries (gh issue #1).
-- The sweeper needs an age filter so it doesn't fight the original fan-out
-- enqueue — `created_at` is the natural source. The fan-out insert already
-- relies on Postgres `DEFAULT now()`, so we don't change the application
-- code path; new rows get `now()` automatically, and existing rows back-fill
-- to migration time (acceptable: those rows are already in 'delivered' or
-- 'failed' and won't be touched).
SET search_path = public;

ALTER TABLE notification_deliveries
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Sweeper's hot path: "pending rows older than 5 min, oldest first".
CREATE INDEX IF NOT EXISTS notification_deliveries_pending_created_at_idx
  ON notification_deliveries (created_at)
  WHERE status = 'pending';