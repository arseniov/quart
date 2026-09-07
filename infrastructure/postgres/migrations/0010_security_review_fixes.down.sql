-- 0010_security_review_fixes.down.sql
SET search_path = public;

ALTER TABLE issues
  DROP CONSTRAINT IF EXISTS issues_neighborhood_id_required;