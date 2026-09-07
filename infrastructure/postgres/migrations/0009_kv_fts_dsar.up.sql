-- 0009_kv_fts_dsar.up.sql
-- DSAR requests (GDPR Art. 15/17/18), feature flags, app settings (key/value),
-- plus FTS columns + triggers on issues / ideas / comments.
SET search_path = public;

-- ============================================================================
-- DSAR (Data Subject Access Request)
-- ============================================================================

CREATE TYPE dsar_type AS ENUM ('export', 'delete', 'restrict');
CREATE TYPE dsar_status AS ENUM ('pending', 'processing', 'completed', 'rejected');

CREATE TABLE dsar_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type dsar_type NOT NULL,
  status dsar_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX dsar_requests_user_id_idx ON dsar_requests(user_id);
CREATE INDEX dsar_requests_status_idx ON dsar_requests(status, requested_at);

-- ============================================================================
-- Feature flags
-- ============================================================================

CREATE TABLE feature_flags (
  code text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent int NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- App settings (key/value)
-- ============================================================================

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- FTS columns on content tables
-- ============================================================================

ALTER TABLE issues   ADD COLUMN search_tsv tsvector;
ALTER TABLE ideas    ADD COLUMN search_tsv tsvector;
ALTER TABLE comments ADD COLUMN search_tsv tsvector;

CREATE INDEX issues_search_tsv_idx   ON issues   USING GIN (search_tsv);
CREATE INDEX ideas_search_tsv_idx    ON ideas    USING GIN (search_tsv);
CREATE INDEX comments_search_tsv_idx ON comments USING GIN (search_tsv);

-- ============================================================================
-- Triggers: keep search_tsv in sync
-- ============================================================================
-- ponytail: using 'simple' config (no stemming); swap to 'english'/'italian'
-- when locale-aware search matters. Three small functions beat one generic.

CREATE OR REPLACE FUNCTION issues_search_tsv_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv :=
    to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS issues_search_tsv_update ON issues;
CREATE TRIGGER issues_search_tsv_update
  BEFORE INSERT OR UPDATE OF title, description ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_search_tsv_update();

CREATE OR REPLACE FUNCTION ideas_search_tsv_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv :=
    to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.body, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ideas_search_tsv_update ON ideas;
CREATE TRIGGER ideas_search_tsv_update
  BEFORE INSERT OR UPDATE OF title, body ON ideas
  FOR EACH ROW EXECUTE FUNCTION ideas_search_tsv_update();

CREATE OR REPLACE FUNCTION comments_search_tsv_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv :=
    to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comments_search_tsv_update ON comments;
CREATE TRIGGER comments_search_tsv_update
  BEFORE INSERT OR UPDATE OF body ON comments
  FOR EACH ROW EXECUTE FUNCTION comments_search_tsv_update();
