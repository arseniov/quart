-- 0033_magic_links.up.sql
-- Single-use email sign-in links. The token is opaque to clients; it's
-- 64 hex chars of CSPRNG randomness + a UUID prefix (see magic-link.service.ts).
-- A successful verify marks `consumed_at` so any subsequent request with the
-- same token is rejected (single-use semantics).
--
-- Admin-managed only — no tenant scoping. The user signs IN via this link
-- *before* a tenant context exists, so RLS would otherwise force us to
-- disable it per-row; keeping the policy off globally is the simpler
-- invariant. Writes happen through DbService.kysely (super-admin path
-- in runInTenantTx callers) or service-layer admin auth.

CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX magic_links_email_idx ON magic_links (email);
CREATE INDEX magic_links_expires_at_idx ON magic_links (expires_at);

ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. The table is admin-managed; user-scoped
-- reads happen via service-layer email lookup, not via RLS.
