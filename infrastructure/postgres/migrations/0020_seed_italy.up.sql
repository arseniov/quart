-- 0020_seed_italy.up.sql
SET search_path = public;

-- Seed: Italy + Rome + Milan + their primary admin subdivisions + sample neighborhoods.
-- Real polygons are loaded from ISTAT boundaries (post-POC). Pilot uses approximate bounds.

INSERT INTO countries (id, code, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'IT', 'Italia')
ON CONFLICT DO NOTHING;

-- Rome
INSERT INTO cities (id, slug, name, country_code, locale_default, timezone, status, bounds)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'roma', 'Roma', 'IT', 'it', 'Europe/Rome', 'active',
  ST_GeogFromText('POLYGON((12.35 41.80, 12.65 41.80, 12.65 42.00, 12.35 42.00, 12.35 41.80))')
) ON CONFLICT (id) DO NOTHING;

-- Milan
INSERT INTO cities (id, slug, name, country_code, locale_default, timezone, status, bounds)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'milano', 'Milano', 'IT', 'it', 'Europe/Rome', 'active',
  ST_GeogFromText('POLYGON((9.05 45.35, 9.30 45.35, 9.30 45.55, 9.05 45.55, 9.05 45.35))')
) ON CONFLICT (id) DO NOTHING;
