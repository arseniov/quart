-- 0031_push_subscriptions_status.up.sql
-- Expo-side invalidation tracking. `revoked_at` already covers user-initiated
-- revocation; this migration adds a separate `status` column so the push worker
-- can mark tokens Expo rejects (`DeviceNotRegistered` / `InvalidCredentials`)
-- without conflating the two reasons. `invalidated_at` records when Expo
-- last told us the token is dead.
SET search_path = public;

ALTER TABLE push_subscriptions
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invalid')),
  ADD COLUMN invalidated_at timestamptz;

-- ponytail: (status='invalid') is the new "filter active subs" predicate;
-- drop the (city_id, revoked_at) index since (city_id, status) covers both
-- "active subs per city" and "invalidated per city" reads with one index.
DROP INDEX IF EXISTS push_subscriptions_city_active_idx;
CREATE INDEX push_subscriptions_city_status_idx ON push_subscriptions (city_id, status);
