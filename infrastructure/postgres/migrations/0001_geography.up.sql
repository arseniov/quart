-- 0001_geography.up.sql
SET search_path = public;

CREATE TABLE countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code char(2) NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  locale_default text NOT NULL CHECK (locale_default ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  timezone text NOT NULL,
  bounds geography(Polygon, 4326),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, slug)
);

CREATE TABLE city_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  geometry geography(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug)
);

CREATE TABLE neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  area_id uuid REFERENCES city_areas(id) ON DELETE SET NULL,
  slug text NOT NULL,
  name text NOT NULL,
  geometry geography(MultiPolygon, 4326),
  centroid geography(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug)
);

CREATE INDEX neighborhoods_city_id_idx ON neighborhoods(city_id);
CREATE INDEX neighborhoods_centroid_idx ON neighborhoods USING GIST (centroid);
CREATE INDEX city_areas_geometry_idx ON city_areas USING GIST (geometry);

CREATE TABLE user_neighborhoods (
  user_id uuid NOT NULL,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, neighborhood_id)
);
CREATE INDEX user_neighborhoods_city_id_idx ON user_neighborhoods(city_id);
