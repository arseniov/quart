-- 0028_i18n_permission.up.sql
-- T30: i18n write access. Stored translations live in `app_settings` with a
-- `i18n:mobile:{locale}` key; writes (PUT/DELETE) on those rows are
-- privileged and require `admin.i18n.write`.
SET search_path = public;

INSERT INTO permissions (code, description) VALUES
  ('admin.i18n.write', 'Edit mobile UI translations (app_settings keys i18n:mobile:*)')
ON CONFLICT (code) DO NOTHING;

-- Grant to roles that already own platform-wide settings edits. Mirrors
-- the `super_admin` → super.admin bypass in RbacGuard by also granting the
-- code itself, so audit log rows for the same operation are uniform.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE (r.code, p.code) IN (
  ('super_admin', 'admin.i18n.write'),
  ('quart_admin', 'admin.i18n.write')
)
ON CONFLICT DO NOTHING;