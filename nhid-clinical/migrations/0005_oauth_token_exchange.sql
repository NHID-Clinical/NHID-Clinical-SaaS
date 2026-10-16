-- 0005 — OAuth 2.0 Token Exchange (RFC 8693), so an enterprise IdP token can
-- buy a scoped NHID API token.
--
-- Until this migration there was exactly one machine credential per
-- organization: the X-API-Key from 0001, a single long-lived secret pasted
-- into a header. For a vendor running a handful of integrations that is fine.
-- For a health system whose security review requires every machine credential
-- to originate from its own identity provider (Okta, Entra, a custom OIDC
-- server), a static shared key is a finding. This adds a second machine path
-- ALONGSIDE the key, never instead of it:
--
--   static key  -> X-API-Key                         -> as before, unchanged
--   IdP token   -> POST /saas/auth/token (RFC 8693)  -> short-lived Bearer
--
-- Three design decisions are baked into this schema, each stated so a later
-- writer cannot quietly undo it:
--
--   1. The token we ISSUE is opaque, not a JWT. We store only its SHA-256
--      hash, exactly as `orgs.api_key_sha256` and `user_sessions.session_sha256`
--      already do: the raw token exists only in the one response that minted
--      it, and a database dump yields hashes that cannot be replayed. This is
--      why there is no signing-key column and no signing key anywhere — the
--      half that needs cryptography is verifying the IdP's JWT, and that uses
--      the IdP's public keys (its JWKS), which are not secret.
--
--   2. A verified JWT must resolve to EXACTLY ONE organization. That is the
--      UNIQUE (issuer, audience) below, global rather than per-org. Two orgs
--      sharing one IdP tenant must present distinct audiences; the alternative
--      is a token that could mint for either, which is a cross-tenant
--      authorization hole. The uniqueness is enforced by the database, not by
--      application code that a refactor could drop.
--
--   3. An issuer nobody configured is REFUSED, never discovered. There is no
--      OIDC-discovery fallback, no "trust any issuer with a valid signature".
--      This mirrors the delegation trust anchors in the framework repo: we do
--      not vouch for keys the deploying organization did not choose. An empty
--      oauth_issuers table means token exchange is simply off for that org.
--
-- Additive only. The migration system (saas_layer/migrations.py) is
-- forward-only — it has no down/rollback path — so every statement here is
-- CREATE ... IF NOT EXISTS. Recovery from a failed deploy is therefore trivial
-- by construction: code that predates this migration never reads these tables,
-- so a half-applied 0005 leaves nothing the old code trips on.

-- Per-org trust configuration: which issuers this org will accept a subject
-- token from, and how to verify one.
CREATE TABLE IF NOT EXISTS oauth_issuers (
    issuer_id      TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL,
    -- The `iss` claim this configuration verifies against, as an https URL.
    issuer         TEXT NOT NULL,
    -- Where the issuer publishes its signing keys. Public key material, fetched
    -- over HTTPS; never a secret. Validated at write time to be https and to
    -- not point at a private, loopback or link-local address (SSRF guard in
    -- oauth_exchange.configure_issuer).
    jwks_uri       TEXT NOT NULL,
    -- The `aud` claim a presented token must carry. With `issuer`, this is what
    -- pins a token to one organization.
    audience       TEXT NOT NULL,
    -- Which verified claim carries the subject identity we record. Defaults to
    -- the standard `sub`; configurable because some IdPs put the useful
    -- identifier elsewhere.
    subject_claim  TEXT NOT NULL DEFAULT 'sub',
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     DOUBLE PRECISION NOT NULL,
    -- The user_id of the owner who configured this. Attribution, not a secret.
    created_by     TEXT NOT NULL
);

-- Global uniqueness on (issuer, audience): see decision 2 above. This is the
-- constraint that makes a verified JWT resolve to one org and only one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_issuers_iss_aud
    ON oauth_issuers (issuer, audience);
CREATE INDEX IF NOT EXISTS idx_oauth_issuers_org
    ON oauth_issuers (org_id);

-- The opaque Bearer tokens we issue in exchange. Same shape as the other
-- hashed-secret tables: the hash IS the primary key and the lookup index.
CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_sha256  TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    issuer_id     TEXT NOT NULL,
    -- The verified subject from the IdP token, for audit. Not a credential.
    subject       TEXT NOT NULL,
    expires_at    DOUBLE PRECISION NOT NULL,
    created_at    DOUBLE PRECISION NOT NULL
    -- Deliberately NO last_used_at. It would be a write on every authenticated
    -- request for a column nothing reads; resolve_token enforces expiry in the
    -- SELECT instead, so there is no per-request write.
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_org
    ON oauth_tokens (org_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_issuer
    ON oauth_tokens (issuer_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiry
    ON oauth_tokens (expires_at);

-- Who changed the trust configuration, and when. Written in the SAME
-- transaction as the change it records, so there is no state where an issuer
-- was configured and the record of it was not. Kept separate from the
-- hash-chained audit_traces: that chain is the record of CALL events (session
-- id, policy action, input text), and an account-administration event on it
-- would distort what that chain claims to be.
CREATE TABLE IF NOT EXISTS oauth_issuer_audit (
    audit_id       TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL,
    issuer_id      TEXT NOT NULL,
    action         TEXT NOT NULL CHECK (action IN ('configured', 'deactivated')),
    actor_user_id  TEXT NOT NULL,
    -- Before/after snapshots of the row, for a reviewer reconstructing a change.
    before         JSONB,
    after          JSONB,
    at             DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_issuer_audit_org
    ON oauth_issuer_audit (org_id, at);
