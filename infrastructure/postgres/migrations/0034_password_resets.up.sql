-- 0034_password_resets.up.sql
-- Single-use password reset tokens. Mirrors 0033_magic_links (citext email +
-- atomic consume via UPDATE-WHERE-RETURNING) but keyed on user_id rather
-- than email — password reset requires looking up the user first so the
-- `forgot` endpoint can return early without leaking whether the address
-- exists.
--
-- `expires_at` defaults to now() + 60min in the service layer (longer than
-- magic-link because users are slower with email → form → submit than with
-- a one-click sign-in link). The TTL is enforced in the UPDATE WHERE
-- clause — a token consumed after its 60min window is treated as missing,
-- same as magic-link.
--
-- RLS stays OFF (same as magic_links): the service layer is the
-- authorization boundary. User-scoped reads go through `users.id` lookups
-- in the service, not via RLS — which the auth flow runs without a tenant
-- context anyway (see gh issue #4 for the audit chain FIXME that T54
-- also tracks).

CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
CREATE INDEX password_resets_expires_at_idx ON password_resets (expires_at);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
-- No policies. Admin-managed (system auth event before tenant exists).
