-- 0003_rbac.up.sql
SET search_path = public;

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_officer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  area_id uuid REFERENCES city_areas(id) ON DELETE SET NULL,
  neighborhood_id uuid REFERENCES neighborhoods(id) ON DELETE SET NULL,
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  expires_at timestamptz,
  PRIMARY KEY (user_id, permission_id, city_id)
);

CREATE TABLE rbac_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  priority int NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX user_roles_user_id_idx ON user_roles(user_id);
CREATE INDEX user_permissions_user_id_idx ON user_permissions(user_id);
