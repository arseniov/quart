-- 0035_admin_dashboard_dlq_permissions.down.sql
SET search_path = public;

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE code IN ('admin.dashboard.read', 'admin.dlq.read')
);

DELETE FROM permissions
WHERE code IN ('admin.dashboard.read', 'admin.dlq.read');
