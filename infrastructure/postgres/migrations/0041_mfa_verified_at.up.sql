-- 0041_mfa_verified_at.up.sql
-- GH #45 follow-up: GH #45 removed JWT claim minting, so `mfaSecret` /
-- `mfaEnrolledAt` / `mfaVerifiedAt` no longer ride the bearer. The
-- secret moves to the /verify request body (mobile keeps it locally
-- from /enroll's response), and the verifiedAt freshness window is now
-- server-side state.
--
-- Adds `verified_at` to mfa_credentials so /verify can stamp the last
-- successful TOTP check and BaAuthGuard can read it back on every
-- request to populate `user.mfaVerifiedAt` for MfaGuard's 5-min window.
--
-- Nullable on purpose:
--   * Rows written before this migration have no verified_at (NULL).
--   * /enroll does NOT set verified_at — the user hasn't verified yet.
--   * /verify stamps it on success.
--
-- The secret itself stays on the user device — we deliberately do NOT
-- add a `totp_secret` column. See migration 0026 for the design.

SET search_path = public, quart_security;

ALTER TABLE mfa_credentials
  ADD COLUMN verified_at timestamptz;
