-- 0009_kv_fts_dsar.down.sql
-- Reverse-FK: triggers → columns/indexes → tables (children first).

-- ============================================================================
-- Triggers
-- ============================================================================

DROP TRIGGER IF EXISTS comments_search_tsv_update ON comments;
DROP TRIGGER IF EXISTS ideas_search_tsv_update    ON ideas;
DROP TRIGGER IF EXISTS issues_search_tsv_update   ON issues;

DROP FUNCTION IF EXISTS comments_search_tsv_update();
DROP FUNCTION IF EXISTS ideas_search_tsv_update();
DROP FUNCTION IF EXISTS issues_search_tsv_update();

-- ============================================================================
-- FTS columns (dropping the column drops the dependent GIN index too,
-- but be explicit so the order is obvious).
-- ============================================================================

DROP INDEX IF EXISTS comments_search_tsv_idx;
DROP INDEX IF EXISTS ideas_search_tsv_idx;
DROP INDEX IF EXISTS issues_search_tsv_idx;

ALTER TABLE comments DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE ideas    DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE issues   DROP COLUMN IF EXISTS search_tsv;

-- ============================================================================
-- Tables (reverse FK order: children of `users` before the standalone kv table)
-- ============================================================================

DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS dsar_requests;

DROP TYPE IF EXISTS dsar_status;
DROP TYPE IF EXISTS dsar_type;
