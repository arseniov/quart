-- 0023_seed_initial_audit_key.up.sql
-- Seed: dev-only KEK v1 + audit HMAC key v1.
-- Keys are generated at migration time via pgcrypto gen_random_bytes(32) — never
-- hardcoded, so every environment (and every fresh volume) gets distinct keys and
-- no key material lives in git.
-- Provider is 'local-dev': prod keys come from the KMS-backed rotation worker,
-- which supersedes version 1 (status -> 'retiring'/'retired') on first rotation.

SET search_path = public;

INSERT INTO quart_security.kek_versions (version, status, key_encrypted, provider)
VALUES (1, 'active', gen_random_bytes(32), 'local-dev')
ON CONFLICT (version) DO NOTHING;

INSERT INTO quart_security.audit_key_versions
  (version, status, kek_id, hmac_key_encrypted, activated_at)
SELECT 1, 'active', k.id, gen_random_bytes(32), now()
FROM quart_security.kek_versions k
WHERE k.version = 1
ON CONFLICT (version) DO NOTHING;
