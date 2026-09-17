-- 0029_audit_anchors.up.sql
-- Rename `merkle_root` -> `anchor_hash` in audit_anchors. The column stores a
-- SHA-256 concatenation of the daily row_hash sequence (cheap terminology fix
-- from plan T35 deviation #1), not a Merkle tree root. The chain of row_hash
-- columns in audit_log already provides tamper evidence.
ALTER TABLE audit_anchors RENAME COLUMN merkle_root TO anchor_hash;