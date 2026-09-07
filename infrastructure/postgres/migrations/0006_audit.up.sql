-- 0006_audit.up.sql
-- Audit chain: tamper-evident append-only log with HMAC-SHA256 hash chain,
-- plus RFC 3161 TSA anchors and key-version tables in the quart_security schema.

CREATE SCHEMA IF NOT EXISTS quart_security;

CREATE TYPE quart_security.key_status AS ENUM ('active', 'retiring', 'retired');

-- KEK (Key Encryption Key) versions: the master keys used to wrap HMAC keys + DEKs.
CREATE TABLE quart_security.kek_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  status quart_security.key_status NOT NULL,
  key_encrypted bytea NOT NULL,
  provider varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- HMAC key versions for the audit chain.
CREATE TABLE quart_security.audit_key_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  status quart_security.key_status NOT NULL,
  kek_id uuid NOT NULL REFERENCES quart_security.kek_versions(id) ON DELETE RESTRICT,
  hmac_key_encrypted bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz
);

-- Append-only audit log. Insert-only enforcement comes via REVOKE (Task 26).
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  on_behalf_of_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  impersonation_session_id uuid,
  action varchar(64) NOT NULL,
  target_type varchar(64) NOT NULL,
  target_id varchar(64) NOT NULL,
  request_id uuid,
  ip inet,
  user_agent text,
  payload_canonical_sha256 char(64) NOT NULL CHECK (payload_canonical_sha256 ~ '^[0-9a-f]{64}$'),
  payload_redacted jsonb NOT NULL,
  payload_raw_encrypted bytea,
  prev_hash char(64) NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash char(64) NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  key_version_id uuid NOT NULL REFERENCES quart_security.audit_key_versions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  pii_redacted_at timestamptz
);

-- TSA anchors: periodic Merkle roots notarized via RFC 3161.
CREATE TABLE audit_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merkle_root char(64) NOT NULL CHECK (merkle_root ~ '^[0-9a-f]{64}$'),
  row_range_start bigint NOT NULL,
  row_range_end bigint NOT NULL,
  tsa_response bytea NOT NULL,
  tsa_url text NOT NULL,
  tsa_cert_sha256 char(64) NOT NULL CHECK (tsa_cert_sha256 ~ '^[0-9a-f]{64}$'),
  anchored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_city_id_created_at_idx ON audit_log (city_id, created_at DESC);
CREATE INDEX audit_log_id_desc_idx ON audit_log (id DESC);
CREATE INDEX audit_anchors_anchored_at_idx ON audit_anchors (anchored_at);