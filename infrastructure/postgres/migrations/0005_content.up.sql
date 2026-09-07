-- 0005_content.up.sql
SET search_path = public;

-- ============================================================================
-- Issues (civic reports)
-- ============================================================================

CREATE TABLE issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  neighborhood_id uuid NOT NULL REFERENCES neighborhoods(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES issue_categories(id) ON DELETE SET NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 10000),
  location geography(Point, 4326) NOT NULL,
  address_hint text CHECK (length(address_hint) <= 500),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','in_progress','resolved','closed','rejected')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  assigned_officer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sla_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX issues_city_id_idx ON issues(city_id);
CREATE INDEX issues_neighborhood_id_idx ON issues(neighborhood_id);
CREATE INDEX issues_category_id_idx ON issues(category_id);
CREATE INDEX issues_author_user_id_idx ON issues(author_user_id);
CREATE INDEX issues_assigned_officer_id_idx ON issues(assigned_officer_id);
CREATE INDEX issues_location_idx ON issues USING GIST (location);
CREATE INDEX issues_open_idx ON issues(city_id, created_at DESC) WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX issues_sla_idx ON issues(sla_due_at) WHERE sla_due_at IS NOT NULL AND status NOT IN ('resolved','closed','rejected');

-- ============================================================================
-- Issue photos
-- ============================================================================

CREATE TABLE issue_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX issue_photos_issue_id_idx ON issue_photos(issue_id);

-- ============================================================================
-- Issue events (status changes, assignments, comments)
-- ============================================================================

CREATE TABLE issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('created','status_changed','assigned','commented','photo_added')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX issue_events_issue_id_idx ON issue_events(issue_id);
CREATE INDEX issue_events_actor_user_id_idx ON issue_events(actor_user_id);
CREATE INDEX issue_events_created_at_idx ON issue_events(created_at DESC);

-- ============================================================================
-- Ideas
-- ============================================================================

CREATE TABLE ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  neighborhood_id uuid REFERENCES neighborhoods(id) ON DELETE SET NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','hidden','rejected')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX ideas_city_id_idx ON ideas(city_id);
CREATE INDEX ideas_neighborhood_id_idx ON ideas(neighborhood_id);
CREATE INDEX ideas_author_user_id_idx ON ideas(author_user_id);
CREATE INDEX ideas_status_idx ON ideas(city_id, status, created_at DESC);

-- ============================================================================
-- Idea votes
-- ============================================================================

CREATE TABLE idea_votes (
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);

CREATE INDEX idea_votes_city_id_idx ON idea_votes(city_id);
CREATE INDEX idea_votes_user_id_idx ON idea_votes(user_id);

-- ============================================================================
-- Polls
-- ============================================================================

CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  neighborhood_id uuid REFERENCES neighborhoods(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text CHECK (length(body) <= 10000),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','closed','cancelled')),
  results_visibility text NOT NULL DEFAULT 'after_close'
    CHECK (results_visibility IN ('always','after_close','never')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE INDEX polls_city_id_idx ON polls(city_id);
CREATE INDEX polls_neighborhood_id_idx ON polls(neighborhood_id);
CREATE INDEX polls_status_idx ON polls(city_id, status, closes_at);

-- ============================================================================
-- Poll options
-- ============================================================================

CREATE TABLE poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX poll_options_poll_id_idx ON poll_options(poll_id);

-- ============================================================================
-- Poll votes (one vote per user per poll)
-- ============================================================================

CREATE TABLE poll_votes (
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX poll_votes_option_id_idx ON poll_votes(option_id);
CREATE INDEX poll_votes_city_id_idx ON poll_votes(city_id);

-- ============================================================================
-- Comments (polymorphic on idea/issue/poll)
-- ============================================================================

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  parent_type text NOT NULL CHECK (parent_type IN ('idea','issue','poll')),
  parent_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX comments_city_id_idx ON comments(city_id);
CREATE INDEX comments_parent_id_idx ON comments(parent_id);
CREATE INDEX comments_author_user_id_idx ON comments(author_user_id);
CREATE INDEX comments_parent_idx ON comments(parent_type, parent_id, created_at DESC);

-- ============================================================================
-- Comment reactions (up/down, multiple reactions per user allowed by type)
-- ============================================================================

CREATE TABLE comment_reactions (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('up','down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, reaction)
);

CREATE INDEX comment_reactions_user_id_idx ON comment_reactions(user_id);