-- 0029_audit_anchors.down.sql
ALTER TABLE audit_anchors RENAME COLUMN anchor_hash TO merkle_root;