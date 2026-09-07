-- 0021_seed_roles_permissions.up.sql
SET search_path = public;

-- Permissions catalog (all codes from master spec § "Roles").
INSERT INTO permissions (code, description) VALUES
  ('content.read', 'Read public content'),
  ('content.create', 'Create ideas, comments'),
  ('issues.create', 'Submit a flag-issue'),
  ('issues.comment', 'Comment on issues'),
  ('polls.vote', 'Vote on polls'),
  ('admin.issues.read', 'Triage queue'),
  ('admin.issues.assign', 'Assign officer to issue'),
  ('admin.issues.status', 'Change issue status'),
  ('admin.ideas.moderate', 'Approve/hide ideas'),
  ('admin.polls.create', 'Create polls'),
  ('admin.polls.publish', 'Publish polls'),
  ('admin.users.read', 'View user profiles'),
  ('admin.users.role.write', 'Change user roles'),
  ('admin.audit.read', 'View audit log'),
  ('admin.audit.verify', 'Run audit chain verification'),
  ('admin.taxonomy.write', 'Edit taxonomies'),
  ('admin.city.write', 'Edit city metadata'),
  ('super.admin', 'Cross-city powers')
ON CONFLICT (code) DO NOTHING;

-- Roles
INSERT INTO roles (code, name, description, is_officer) VALUES
  ('citizen', 'Cittadino', 'Default role for any registered user', false),
  ('municipality_officer', 'Operatore comunale', 'Handles flag-issues in assigned area', true),
  ('police_officer', 'Operatore polizia', 'Routes traffic/safety issues', true),
  ('sanitation_officer', 'Operatore igiene urbana', 'Handles sanitation issues', true),
  ('moderator', 'Moderatore', 'Approves/hides ideas and comments', true),
  ('quart_admin', 'Quart Admin', 'City-scoped admin powers', true),
  ('super_admin', 'Super Admin', 'Cross-city platform staff', true)
ON CONFLICT (code) DO NOTHING;

-- Role → permission grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE (r.code, p.code) IN (
  ('citizen', 'content.read'), ('citizen', 'content.create'),
  ('citizen', 'issues.create'), ('citizen', 'issues.comment'),
  ('citizen', 'polls.vote'),

  ('municipality_officer', 'content.read'),
  ('municipality_officer', 'admin.issues.read'),
  ('municipality_officer', 'admin.issues.assign'),
  ('municipality_officer', 'admin.issues.status'),

  ('police_officer', 'content.read'),
  ('police_officer', 'admin.issues.read'),
  ('police_officer', 'admin.issues.assign'),
  ('police_officer', 'admin.issues.status'),

  ('sanitation_officer', 'content.read'),
  ('sanitation_officer', 'admin.issues.read'),
  ('sanitation_officer', 'admin.issues.assign'),
  ('sanitation_officer', 'admin.issues.status'),

  ('moderator', 'content.read'),
  ('moderator', 'admin.ideas.moderate'),

  ('quart_admin', 'content.read'),
  ('quart_admin', 'admin.issues.read'),
  ('quart_admin', 'admin.issues.assign'),
  ('quart_admin', 'admin.issues.status'),
  ('quart_admin', 'admin.ideas.moderate'),
  ('quart_admin', 'admin.polls.create'),
  ('quart_admin', 'admin.polls.publish'),
  ('quart_admin', 'admin.users.read'),
  ('quart_admin', 'admin.audit.read'),
  ('quart_admin', 'admin.taxonomy.write'),
  ('quart_admin', 'admin.city.write'),

  ('super_admin', 'super.admin')
)
ON CONFLICT DO NOTHING;
