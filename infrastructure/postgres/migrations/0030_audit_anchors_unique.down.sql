-- 0030_audit_anchors_unique.down.sql
ALTER TABLE audit_anchors DROP CONSTRAINT audit_anchors_anchor_hash_uniq;
