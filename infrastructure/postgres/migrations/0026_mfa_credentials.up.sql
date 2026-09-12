-- 0026_mfa_credentials.up.sql
-- T17 MFA credential registry. The TOTP secret itself is carried in the
-- verified JWT (stateless — see T17 plan), so this table only tracks:
--   * backup-code hashes (for the /backup-code endpoint)
--   * replay prevention via `last_used_step` (TOTP ±1 window)
--
-- RLS: city-scoped + owner-only. The owner check reads
-- current_setting('app.user_id') which is set by runInTenantTx.
SET search_path = public, quart_security;

CREATE TABLE mfa_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('totp')),
  -- The TOTP secret lives in the JWT (stateless design); the table tracks
  -- backup codes + replay prevention.
  label text NOT NULL,
  backup_codes_hash text[] NOT NULL DEFAULT '{}',
  -- Map of hash -> consumed_at ISO string. Tracks per-code consumption
  -- timestamps so a code can't be replayed.
  backup_codes_used_at jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  -- TOTP step (epoch-ms / 30000) of the most recently consumed code.
  -- Replay check: reject any code whose step == last_used_step.
  last_used_step timestamptz
);

-- Composite unique index serves both the enrollment upsert
-- (Kysely `onConflict((oc) => oc.column('user_id')…)` requires a unique
-- target) AND equality lookups in verify/consume, since Postgres uses a
-- unique index for non-unique scans too. Composite on (user_id, type)
-- reserves room for future non-totp credential types (e.g. webauthn)
-- that share a user_id but a different `type` value.
CREATE UNIQUE INDEX mfa_credentials_user_id_uniq ON mfa_credentials(user_id, type);

-- ============================================================================
-- RLS — city-scoped + owner-only (matches the 0016 pattern).
-- ============================================================================
ALTER TABLE mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_credentials FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_credentials_scope ON mfa_credentials;
CREATE POLICY mfa_credentials_scope ON mfa_credentials FOR ALL TO quart_app
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