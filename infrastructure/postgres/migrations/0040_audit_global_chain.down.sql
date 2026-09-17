-- 0040_audit_global_chain.down.sql
-- Down migration simply re-runs 0038 to restore the per-city + sentinel
-- trigger shape. Existing rows aren't rewritten — only future inserts
-- restore the per-city / global branching behaviour.
\i 0038_audit_system_chain.up.sql
