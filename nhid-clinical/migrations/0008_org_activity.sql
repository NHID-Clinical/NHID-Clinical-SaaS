-- 0008 — the organization activity log.
--
-- Key, member and purge actions were written only to server logs, which a
-- customer cannot see. An auditor's first request is "every administrative
-- change in the period", so each such action now leaves a row here that the
-- organization can read and export (GET /saas/orgs/activity) and nobody can
-- edit: there is no update or delete path in the application.
--
-- `actor` is a person's email when a signed-in user acted, or the credential
-- (`api-key:primary` / `api-key:<key_id>`) when a machine did. `detail` holds
-- non-secret context such as a key's scope or a member's role; never a secret.
--
-- Additive and forward-only (migrations/README.md).

CREATE TABLE IF NOT EXISTS org_activity (
    activity_id  TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor        TEXT NOT NULL,
    action       TEXT NOT NULL,
    target       TEXT,
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS org_activity_org_time_idx ON org_activity (org_id, occurred_at DESC);
