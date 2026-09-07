-- 0007_pii.up.sql
-- PII envelope encryption infra: column registry, per-city DEK versions, and the
-- quart_security helper functions used by the API's encrypt/decrypt paths.
--
-- Key hierarchy: KMS master key -> KEK (quart_security.kek_versions.key_encrypted,
-- KMS-wrapped) -> per-city DEK (pii_key_versions.dek_encrypted, KEK-wrapped).
-- Postgres cannot call KMS, so the application unwraps the KEK once per connection
-- and hands it to the session as `app.kek_material` (SET LOCAL, never logged).

SET search_path = public;

CREATE TYPE quart_security.pii_encryption_mode AS ENUM ('pgp_sym', 'app_envelope');

-- Registry of which (table, column) pairs hold PII and how they are protected.
CREATE TABLE pii_columns (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  encryption_mode quart_security.pii_encryption_mode NOT NULL,
  kek_id uuid NOT NULL REFERENCES quart_security.kek_versions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, column_name)
);

-- Per-city DEK versions. `dek_encrypted` is the DEK wrapped with the KEK in `kek_id`.
CREATE TABLE pii_key_versions (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  version int NOT NULL,
  status quart_security.key_status NOT NULL,
  dek_encrypted bytea NOT NULL,
  kek_id uuid NOT NULL REFERENCES quart_security.kek_versions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  PRIMARY KEY (city_id, version)
);

-- One active DEK per city at a time; retiring versions stay readable for re-encryption.
CREATE UNIQUE INDEX pii_key_versions_one_active_per_city_idx
  ON pii_key_versions (city_id)
  WHERE status = 'active';

-- Returns the plaintext DEK for a city. `p_version` NULL => current active version.
CREATE FUNCTION quart_security.pii_dek(p_city_id uuid, p_version int DEFAULT NULL)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kek text := nullif(current_setting('app.kek_material', true), '');
  v_wrapped bytea;
BEGIN
  IF v_kek IS NULL THEN
    RAISE EXCEPTION 'app.kek_material is not set: the application must unwrap the KEK via KMS and SET LOCAL it for this session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT k.dek_encrypted INTO v_wrapped
  FROM pii_key_versions k
  WHERE k.city_id = p_city_id
    AND (
      (p_version IS NULL AND k.status = 'active')
      OR k.version = p_version
    );

  IF v_wrapped IS NULL THEN
    RAISE EXCEPTION 'no PII key version for city % (version %)', p_city_id, p_version
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN pgp_sym_decrypt_bytea(v_wrapped, v_kek);
END;
$$;

CREATE FUNCTION quart_security.pgp_sym_encrypt_for_column(
  p_plaintext text,
  p_table_name text,
  p_column_name text,
  p_city_id uuid
)
RETURNS bytea
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode quart_security.pii_encryption_mode;
BEGIN
  SELECT c.encryption_mode INTO v_mode
  FROM pii_columns c
  WHERE c.table_name = p_table_name
    AND c.column_name = p_column_name;

  IF v_mode IS NULL THEN
    RAISE EXCEPTION '%.% is not registered in pii_columns', p_table_name, p_column_name
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_mode <> 'pgp_sym' THEN
    RAISE EXCEPTION '%.% uses encryption_mode % and must be encrypted by the application',
      p_table_name, p_column_name, v_mode
      USING ERRCODE = 'feature_not_supported';
  END IF;

  RETURN pgp_sym_encrypt(
    p_plaintext,
    encode(quart_security.pii_dek(p_city_id), 'base64'),
    'compress-algo=1, cipher-algo=aes256'
  );
END;
$$;

-- Tries the active DEK first, then non-retired older versions, so reads keep working
-- mid-rotation without the caller tracking which version wrote the row.
CREATE FUNCTION quart_security.pgp_sym_decrypt_for_column(
  p_cipher bytea,
  p_table_name text,
  p_column_name text,
  p_city_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version int;
BEGIN
  PERFORM 1
  FROM pii_columns c
  WHERE c.table_name = p_table_name
    AND c.column_name = p_column_name
    AND c.encryption_mode = 'pgp_sym';

  IF NOT FOUND THEN
    RAISE EXCEPTION '%.% is not a pgp_sym PII column', p_table_name, p_column_name
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ponytail: linear scan over key versions (at most a handful per city during
  -- rotation). Store the version alongside the ciphertext if that ever hurts.
  FOR v_version IN
    SELECT k.version
    FROM pii_key_versions k
    WHERE k.city_id = p_city_id
      AND k.status <> 'retired'
    ORDER BY (k.status = 'active') DESC, k.version DESC
  LOOP
    BEGIN
      RETURN pgp_sym_decrypt(
        p_cipher,
        encode(quart_security.pii_dek(p_city_id, v_version), 'base64')
      );
    EXCEPTION
      WHEN external_routine_invocation_exception OR data_exception THEN
        CONTINUE;
    END;
  END LOOP;

  RAISE EXCEPTION 'no usable PII key version decrypts this value for city %', p_city_id
    USING ERRCODE = 'no_data_found';
END;
$$;
