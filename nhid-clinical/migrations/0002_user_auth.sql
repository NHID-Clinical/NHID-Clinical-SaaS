-- 0002 — human identity, so a review action can carry a name.
--
-- Until this migration there was exactly one credential per organization: an
-- API key, pasted into a browser and shared by a whole compliance team. And
-- `review_events.reviewer` was free text the client supplied, defaulting to the
-- literal string 'unknown'. A product whose purpose is answering "who did this,
-- under whose authority" could not answer it about its own users.
--
-- This adds a human path ALONGSIDE the API key, not instead of it:
--   machine  -> org API key   -> ingest pipelines, scripts, CI
--   human    -> magic link    -> people opening /ops in a browser
--
-- Secrets are hashed at rest, following api_keys.py: the raw token exists only
-- in the email, the raw session id only in the cookie. A database dump yields
-- SHA-256 hashes, and a hash cannot be replayed.

CREATE TABLE IF NOT EXISTS users (
    user_id      TEXT PRIMARY KEY,
    -- Stored as given so it can be displayed the way the person typed it.
    -- Uniqueness and lookup both go through the lower() index below rather
    -- than through CITEXT, which is an extension this schema would then
    -- require of every database it is ever restored into.
    email        TEXT NOT NULL,
    created_at   DOUBLE PRECISION NOT NULL,
    last_seen_at DOUBLE PRECISION
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS org_members (
    org_id     TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    -- Two roles, not an RBAC system. 'owner' may invite and remove members;
    -- 'member' may do everything else the org can do. Anything finer is a
    -- product decision nobody has asked for yet.
    role       TEXT NOT NULL DEFAULT 'member',
    created_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id);

CREATE TABLE IF NOT EXISTS login_tokens (
    token_sha256 TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    expires_at   DOUBLE PRECISION NOT NULL,
    -- Set when redeemed. The row is kept rather than deleted so that a replay
    -- of an already-used link is distinguishable from a link that never
    -- existed, which is what makes a stolen-link incident investigable.
    consumed_at  DOUBLE PRECISION,
    requested_ip TEXT,
    created_at   DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_user ON login_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expiry ON login_tokens (expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_sha256 TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    expires_at     DOUBLE PRECISION NOT NULL,
    created_at     DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);

-- Throttling for the sign-in path, keyed by email or by IP. Same shape and
-- same semantics as `admin_login_attempts`, which auth.py already drives; a
-- separate table because the two surfaces must not share a lockout (an
-- attacker hammering /saas/auth should not lock the operator out of /admin).
CREATE TABLE IF NOT EXISTS login_throttle (
    throttle_key TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL,
    window_start DOUBLE PRECISION NOT NULL,
    locked_until DOUBLE PRECISION
);

-- Attribution as a reference, not a typed string. The existing `reviewer`
-- column stays: it holds real history that predates this migration, and
-- rewriting it to NULL would destroy evidence to tidy a schema.
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS reviewer_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_review_events_user ON review_events (reviewer_user_id);
