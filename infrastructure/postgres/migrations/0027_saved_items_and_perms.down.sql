-- 0027_saved_items_and_perms.down.sql
SET search_path = public;

DROP TABLE IF EXISTS saved_items;

DELETE FROM permissions WHERE code IN (
  'notifications.read',
  'notifications.write',
  'saved.read',
  'saved.write',
  'self.read',
  'self.write'
);
