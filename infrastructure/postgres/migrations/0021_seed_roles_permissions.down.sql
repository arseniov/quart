-- 0021_seed_roles_permissions.down.sql
SET search_path = public;

-- Delete seeded role → permission grants (cascade handles the join table rows
-- because role_permissions has ON DELETE CASCADE on both FKs).
DELETE FROM role_permissions
WHERE role_id IN (
  SELECT id FROM roles WHERE code IN (
    'citizen',
    'municipality_officer',
    'police_officer',
    'sanitation_officer',
    'moderator',
    'quart_admin',
    'super_admin'
  )
);

-- Delete seeded roles.
DELETE FROM roles WHERE code IN (
  'citizen',
  'municipality_officer',
  'police_officer',
  'sanitation_officer',
  'moderator',
  'quart_admin',
  'super_admin'
);

-- Delete seeded permissions.
DELETE FROM permissions WHERE code IN (
  'content.read',
  'content.create',
  'issues.create',
  'issues.comment',
  'polls.vote',
  'admin.issues.read',
  'admin.issues.assign',
  'admin.issues.status',
  'admin.ideas.moderate',
  'admin.polls.create',
  'admin.polls.publish',
  'admin.users.read',
  'admin.users.role.write',
  'admin.audit.read',
  'admin.audit.verify',
  'admin.taxonomy.write',
  'admin.city.write',
  'super.admin'
);
