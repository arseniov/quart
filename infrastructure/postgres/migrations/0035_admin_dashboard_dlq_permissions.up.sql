-- 0035_admin_dashboard_dlq_permissions.up.sql
-- T57 follow-up: the controllers on `feat/shared-api` reference
-- `admin.dashboard.read` and `admin.dlq.read` but those rows were never
-- seeded. Without them `RbacGuard`'s `IN (...)` lookup returns zero grants
-- and every non-super-admin caller of `/admin/dashboard` or `/admin/dlq`
-- gets a 403.
SET search_path = public;

INSERT INTO permissions (code, description) VALUES
  ('admin.dashboard.read', 'Read admin dashboard KPI aggregates'),
  ('admin.dlq.read', 'Read failed BullMQ jobs from the DLQ viewer')
ON CONFLICT (code) DO NOTHING;

-- Mirror the `0028_i18n_permission.up.sql` grant pattern: `super_admin`
-- already bypasses via `super.admin` in RbacGuard but we mirror the row so
-- audit log entries are uniform across operators.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE (r.code, p.code) IN (
  ('super_admin', 'admin.dashboard.read'),
  ('super_admin', 'admin.dlq.read'),
  ('quart_admin', 'admin.dashboard.read'),
  ('quart_admin', 'admin.dlq.read')
)
ON CONFLICT DO NOTHING;
