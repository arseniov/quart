-- 0010_security_review_fixes.up.sql
SET search_path = public;

-- Security review H5: enforce neighborhood on issues
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'issues_neighborhood_id_required'
      AND conrelid = 'issues'::regclass
  ) THEN
    ALTER TABLE issues
      ADD CONSTRAINT issues_neighborhood_id_required CHECK (neighborhood_id IS NOT NULL);
  END IF;
END $$;