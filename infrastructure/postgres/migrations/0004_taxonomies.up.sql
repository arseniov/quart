-- 0004_taxonomies.up.sql
SET search_path = public;

CREATE TABLE topic_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_i18n jsonb NOT NULL,
  parent_id uuid REFERENCES topic_categories(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, code)
);

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES topic_categories(id) ON DELETE RESTRICT,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_i18n jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, code)
);

CREATE TABLE issue_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_i18n jsonb NOT NULL,
  default_sla_hours int,
  default_assignee_role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  icon_name text,
  color_hex text CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9a-fA-F]{6}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, code)
);

CREATE TABLE topic_user_subscriptions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

CREATE INDEX topic_categories_city_status_idx ON topic_categories(city_id, status);
CREATE INDEX topics_city_status_idx ON topics(city_id, status);
CREATE INDEX issue_categories_city_status_idx ON issue_categories(city_id, status);
CREATE INDEX topic_user_subscriptions_city_id_idx ON topic_user_subscriptions(city_id); -- ponytail: plan asked for (city_id, status) but the table has no status column; plain (city_id) covers the per-city subscription lookup.