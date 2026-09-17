-- 0030_audit_anchors_unique.up.sql
-- Enforce single row per anchor_hash so a BullMQ retry of runAuditAnchor
-- (or a backfill re-run with the same audit_log state) is idempotent.
-- The Kysely insert adds `.onConflict().column('anchor_hash').doNothing()`,
-- so this constraint turns that "do nothing" into a real guard instead of an
-- innocent promise.
ALTER TABLE audit_anchors ADD CONSTRAINT audit_anchors_anchor_hash_uniq UNIQUE (anchor_hash);
