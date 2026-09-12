-- 0027_saved_items_and_perms.up.sql
SET search_path = public;

-- ============================================================================
-- Saved items (per-user bookmarks on polymorphic content)
-- ============================================================================
CREATE TABLE saved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL CHECK (kind IN ('issue', 'idea', 'poll')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, target_id)
);

-- ponytail: per-user list is the only access pattern; (city_id, user_id)
-- supports the tenant-scoped inbox lookup without filtering on city.
CREATE INDEX saved_items_user_idx ON saved_items (user_id, created_at DESC);
CREATE INDEX saved_items_city_user_idx ON saved_items (city_id, user_id);

-- ============================================================================
-- Permission codes for notifications + saved-items + self/profile endpoints.
-- Super-admin bypass in RbacGuard handles cross-city; no role grants needed.
-- ============================================================================
INSERT INTO permissions (code, description) VALUES
  ('notifications.read', 'Read own notifications inbox'),
  ('notifications.write', 'Mark notifications read / push subscriptions'),
  ('saved.read', 'List own saved items'),
  ('saved.write', 'Add / remove own saved items'),
  ('self.read', 'Read own user profile'),
  ('self.write', 'Update own profile, export, delete')
ON CONFLICT (code) DO NOTHING;
