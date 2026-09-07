-- 0008_notifications.up.sql
-- Recipient inbox + push subscriptions + per-recipient delivery state.

-- ============================================================================
-- Notifications
-- ============================================================================

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type varchar(64) NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  target_url text CHECK (target_url IS NULL OR length(target_url) <= 2000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Inbox lookup: unread first (NULLS FIRST on read_at), newest within each bucket.
CREATE INDEX notifications_recipient_inbox_idx
  ON notifications (recipient_user_id, read_at NULLS FIRST, created_at DESC);

-- ============================================================================
-- Push subscriptions (Expo tokens per device)
-- ============================================================================

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  locale text NOT NULL,
  app_version text NOT NULL,
  device_platform text NOT NULL CHECK (device_platform IN ('ios','android','web')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ponytail: plan asked for (city_id, status) but the table has no status column;
-- (city_id, revoked_at) covers "filter active subs for a city" (revoked_at IS NULL).
CREATE INDEX push_subscriptions_city_active_idx ON push_subscriptions (city_id, revoked_at);
CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- ============================================================================
-- Notification deliveries (per push attempt)
-- ============================================================================

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  push_subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  error_code text,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz
);

CREATE INDEX notification_deliveries_notification_id_idx ON notification_deliveries (notification_id);
CREATE INDEX notification_deliveries_push_subscription_id_idx ON notification_deliveries (push_subscription_id);
