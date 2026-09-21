-- 0042_devices.up.sql
-- GH #51: per-device push registration. Mobile sends POST /me/devices on
-- login (or push permission grant) with an Expo push token; we upsert
-- on (user_id, device_id) so re-logins don't duplicate rows. The DELETE
-- /me/devices/:id endpoint removes a row when the user toggles push off
-- (GH #38).
--
-- Companion to `push_subscriptions` (0008): push_subscriptions still
-- drives notification fan-out; `devices` is the device-keyed registry
-- the mobile app already POSTs to (currently 404s — GH #51 closes that
-- loop). A future worker will project `devices` rows into
-- `push_subscriptions` rows on first send; out of scope here.
--
-- ponytail: city_id is denormalised onto the row so a single RLS
-- policy (city scope + owner scope) matches the existing 0008 +
-- 0026 patterns. The mobile doesn't yet know its city when the
-- toggle fires (the request is per-session, not per-city); BaAuthGuard
-- populates `req.tenant.cityId` from `users.default_city_id` (GH #47),
-- so the controller can stamp the row from the tenant context.
SET search_path = public, quart_security;

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  -- Client-generated UUID minted once per install. Stable across
  -- re-logins so re-POSTing the same (user_id, device_id) is an
  -- upsert, not a duplicate row. Mobile doesn't send this yet —
  -- the controller derives it from sha256(expo_push_token) when
  -- absent, so existing callers dedupe on token.
  device_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  expo_push_token text NOT NULL,
  app_version text NOT NULL,
  locale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX devices_user_id_idx ON devices (user_id);
CREATE INDEX devices_city_id_idx ON devices (city_id);

-- ============================================================================
-- RLS — city-scoped + owner-only (mirrors mfa_credentials in 0026).
-- ============================================================================
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devices_scope ON devices;
CREATE POLICY devices_scope ON devices FOR ALL TO quart_app
  USING (
        current_setting('app.is_super_admin', true) = 'true'
    OR (
           city_id::text = current_setting('app.city_id', true)
       AND user_id::text = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
    OR (
           city_id::text = current_setting('app.city_id', true)
       AND user_id::text = current_setting('app.user_id', true)
    )
  );