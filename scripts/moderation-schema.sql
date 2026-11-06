-- Preview moderation: privilege is attached to a user ID, never a username.
CREATE TABLE IF NOT EXISTS community_admins (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS deleted_users (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS moderation_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('delete_user','delete_set')),
 target_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
