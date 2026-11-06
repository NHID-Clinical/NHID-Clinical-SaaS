-- 0007 — scoped, expiring organization API keys, and the auditor role.
--
-- Until now an organization had exactly one API key, held on the `orgs` row:
-- org-wide, every route, no expiry. A key handed to an ingest pipeline could
-- read every finding, and a key copied onto an auditor's laptop could resolve
-- findings, and both lived forever. A payer security review flags that first.
--
-- `org_api_keys` holds additional keys, each with:
--
--   * a scope:  'ingest' — write evidence (ingest, trace, voice events) only;
--               'read'   — GET requests only;
--               'full'   — everything the primary key can do;
--   * an expiry, always set (1–365 days), so a forgotten key stops working;
--   * a revocation stamp, so revoking is provable rather than a missing row;
--   * who created it, and when it was last used.
--
-- The primary key on `orgs` is unchanged: still full scope, still rotatable.
-- Secrets are hashed at rest exactly as `orgs.api_key_sha256` (api_keys.py).
--
-- The `auditor` role needs no schema change: `org_members.role` is plain TEXT
-- and the allowed values are enforced in `user_auth.ROLES`.
--
-- Additive and forward-only (migrations/README.md).

CREATE TABLE IF NOT EXISTS org_api_keys (
    key_id          TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    key_sha256      TEXT NOT NULL UNIQUE,
    key_prefix      TEXT NOT NULL,
    scope           TEXT NOT NULL CHECK (scope IN ('ingest', 'read', 'full')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_by      TEXT,
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS org_api_keys_org_idx ON org_api_keys (org_id);
