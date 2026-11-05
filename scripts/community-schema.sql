CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS shared_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quizlet_id text UNIQUE,
 fingerprint text NOT NULL UNIQUE,
 title text NOT NULL,
 creator_name text,
 creator_url text,
 source_url text,
 created_by text REFERENCES "user"(id) ON DELETE SET NULL,
 cards jsonb NOT NULL,
 term_count integer NOT NULL CHECK (term_count BETWEEN 2 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now(),
 search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || coalesce(creator_name,''))) STORED
);
CREATE INDEX IF NOT EXISTS sets_search ON shared_sets USING gin(search_document);
CREATE INDEX IF NOT EXISTS sets_title_trgm ON shared_sets USING gin(lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sets_recent ON shared_sets(created_at DESC,id);
CREATE TABLE IF NOT EXISTS game_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES shared_sets(id) ON DELETE CASCADE,
 mode text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 score integer,
 level integer
);
CREATE INDEX IF NOT EXISTS runs_owner ON game_runs(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS high_scores (
 set_id uuid NOT NULL REFERENCES shared_sets(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 score integer NOT NULL CHECK(score>=0),
 level integer NOT NULL,
 mode text NOT NULL,
 achieved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(set_id,user_id)
);
CREATE INDEX IF NOT EXISTS scoreboard ON high_scores(set_id,score DESC,achieved_at,user_id);
CREATE TABLE IF NOT EXISTS api_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS native_handoffs (
 code_hash text PRIMARY KEY,
 challenge text NOT NULL,
 encrypted_token text NOT NULL,
 expires_at timestamptz NOT NULL
);

-- Public URLs use Quizlet's numeric-ID/title-flash-cards structure.
-- A separate high numeric range prevents custom sets colliding with imported IDs.
CREATE SEQUENCE IF NOT EXISTS shared_set_public_ids START WITH 1000000000000000;
ALTER TABLE shared_sets ADD COLUMN IF NOT EXISTS public_id text;
UPDATE shared_sets SET public_id=coalesce(quizlet_id,nextval('shared_set_public_ids')::text) WHERE public_id IS NULL;
ALTER TABLE shared_sets ALTER COLUMN public_id SET DEFAULT nextval('shared_set_public_ids')::text;
ALTER TABLE shared_sets ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sets_public_id ON shared_sets(public_id);
