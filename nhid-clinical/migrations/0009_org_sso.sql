-- 0009 — enterprise single sign-on (OpenID Connect, authorization code + PKCE).
--
-- `org_sso` holds one identity-provider configuration per organization. The
-- endpoints are configured explicitly rather than discovered at sign-in time,
-- so the server never fetches a URL it was not told about by an owner, and
-- every URL is SSRF-screened when it is saved (oauth_exchange._reject_unsafe_url).
--
-- The client secret is encrypted at rest (Fernet, key derived from
-- HMAC_SECRET) and never returned by the API; `has_client_secret` says whether
-- one is set. A deployment that needs the key in an HSM or KMS has that as
-- open work (framework repo docs/production-readiness.md §1).
--
-- `allowed_domains` is required: an email at any other domain is refused even
-- if the provider vouches for it. New people are added with `default_role`
-- (member or auditor, never owner).
--
-- `sso_login_states` holds one pending sign-in each: the state (hashed), the
-- nonce and PKCE verifier, where to return, and when it expires. A state is
-- consumed atomically, so a replayed callback loses.
--
-- Additive and forward-only (migrations/README.md).

CREATE TABLE IF NOT EXISTS org_sso (
    org_id                  TEXT PRIMARY KEY REFERENCES orgs(org_id) ON DELETE CASCADE,
    issuer                  TEXT NOT NULL,
    client_id               TEXT NOT NULL,
    client_secret_enc       TEXT,
    authorization_endpoint  TEXT NOT NULL,
    token_endpoint          TEXT NOT NULL,
    jwks_uri                TEXT NOT NULL,
    allowed_domains         TEXT[] NOT NULL,
    default_role            TEXT NOT NULL CHECK (default_role IN ('member', 'auditor')),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by              TEXT
);

CREATE TABLE IF NOT EXISTS sso_login_states (
    state_sha256   TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL,
    nonce          TEXT NOT NULL,
    code_verifier  TEXT NOT NULL,
    return_to      TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    consumed_at    TIMESTAMPTZ
);
