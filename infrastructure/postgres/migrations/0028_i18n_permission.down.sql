-- 0028_i18n_permission.down.sql
SET search_path = public;

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'admin.i18n.write');

DELETE FROM permissions WHERE code = 'admin.i18n.write';