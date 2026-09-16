-- 0037_notification_deliveries_sweep_counter.up.sql
-- Dead-letter bound for the notification_deliveries sweeper (gh issue #1).
-- Without these columns, a row that the sweeper can never deliver (FK target
-- gone, no recipient, etc.) would be re-fetched on every 5-min tick forever
-- (self-DoS — the read itself is cheap, but the row blocks operators from
-- spotting the real backlog and pollutes logs).
--
-- `sweep_attempts` increments on each skip (atomic UPDATE with `WHERE
-- status = 'pending'`). Once it reaches MAX_SWEEP_ATTEMPTS (defined in
-- apps/api/src/notifications/notification-deliveries.sweeper.ts), the sweeper
-- flips the row to `failed` and writes `error_code = 'sweep_dead_letter'`
-- so T57's DLQ viewer surfaces it. `last_swept_at` is the audit trail.
SET search_path = public;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS sweep_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS last_swept_at TIMESTAMPTZ;

-- Hot path: "pending rows older than 5 min, oldest first, sweep_attempts
-- below the cap". The partial WHERE on status is reused from 0036.
-- ponytail: status + created_at are the only filters the sweeper uses;
-- a second index isn't justified until we see it in pg_stat_statements.
