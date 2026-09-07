-- 0022_seed_default_taxonomies.up.sql
SET search_path = public;

-- Default topic categories (global; city_id NULL means available to all cities).
INSERT INTO topic_categories (id, code, name_i18n, sort_order, status) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', 'mobility',  '{"it":"Mobilità","en":"Mobility"}', 1, 'active'),
  ('aaaaaaa1-0000-0000-0000-000000000002', 'environment','{"it":"Ambiente","en":"Environment"}', 2, 'active'),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'safety',    '{"it":"Sicurezza","en":"Safety"}', 3, 'active'),
  ('aaaaaaa1-0000-0000-0000-000000000004', 'culture',   '{"it":"Cultura","en":"Culture"}', 4, 'active')
ON CONFLICT (id) DO NOTHING;

-- Top-level topics (seeded for Roma; tenants can clone/relabel for other cities)
INSERT INTO topics (id, city_id, category_id, code, name_i18n, status) VALUES
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-0000-0000-000000000001', 'roads',
   '{"it":"Strade","en":"Roads"}', 'active'),
  ('bbbbbbb1-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-0000-0000-000000000001', 'public_transport',
   '{"it":"Trasporto pubblico","en":"Public transport"}', 'active'),
  ('bbbbbbb1-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-0000-0000-000000000002', 'air_quality',
   '{"it":"Qualità dell''aria","en":"Air quality"}', 'active'),
  ('bbbbbbb1-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-0000-0000-000000000003', 'road_safety',
   '{"it":"Sicurezza stradale","en":"Road safety"}', 'active')
ON CONFLICT (id) DO NOTHING;

-- Default issue categories (city-scoped; here seeded for Rome + Milan)
INSERT INTO issue_categories (id, city_id, code, name_i18n, default_sla_hours, icon_name, color_hex, status) VALUES
  ('ccccccc1-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'pothole',
   '{"it":"Buca stradale","en":"Pothole"}', 168, 'pothole', '#d97706', 'active'),
  ('ccccccc1-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'streetlight',
   '{"it":"Lampione rotto","en":"Broken streetlight"}', 72, 'streetlight', '#0ea5e9', 'active'),
  ('ccccccc1-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222', 'illegal_dump',
   '{"it":"Discarica abusiva","en":"Illegal dumping"}', 96, 'trash', '#16a34a', 'active'),
  ('ccccccc1-0000-0000-0000-000000000010',
   '33333333-3333-3333-3333-333333333333', 'pothole',
   '{"it":"Buca stradale","en":"Pothole"}', 168, 'pothole', '#d97706', 'active'),
  ('ccccccc1-0000-0000-0000-000000000011',
   '33333333-3333-3333-3333-333333333333', 'streetlight',
   '{"it":"Lampione rotto","en":"Broken streetlight"}', 72, 'streetlight', '#0ea5e9', 'active')
ON CONFLICT (id) DO NOTHING;