# Threat model: NHID-Clinical hosted platform

> **Status: an internal threat model, self-prepared.** It is not a penetration
> test, a third-party assessment or an attestation. It records what we think
> can go wrong, what stops it, and what does not. Last reviewed 2026-11-06,
> against the code on that date.

**Method.** STRIDE: spoofing, tampering, repudiation, information disclosure,
denial of service and elevation of privilege. It is applied per trust boundary.
Each mitigation names the code that implements it, so a reviewer can check
rather than trust.

## 1. What we protect

| Asset | Why it matters |
| :-- | :-- |
| Interaction transcripts (`interactions.transcript`) | May contain PHI: member IDs, names, dates of birth, claim details |
| Findings and review decisions | The product's evidence. Altering them defeats its purpose. |
| Audit chain and activity log | Prove what happened and who did it |
| Organization credentials | API keys, session cookies, SSO client secrets |
| Tenant separation | One organization's data must never reach another |

**Not ingested:** call audio. There is no audio column, upload path or media
bucket.

## 2. Trust boundaries

```
Browser ──(1)── Static app (Render static)
Browser ──(2)── API (FastAPI, Render)  ──(4)── Postgres (managed)
Pipeline ─(3)── API                    ──(5)── Identity provider (OIDC), email provider, Stripe
Operator ─(6)── Admin console on the API
```

## 3. Threats and mitigations

### Boundary 2–3: callers of the API

| STRIDE | Threat | Mitigation | Evidence |
| :-- | :-- | :-- | :-- |
| S | A stolen API key used from anywhere | Keys are hashed at rest. Scoped keys expire (1–365 days) and can be revoked at once. Ingest keys cannot read. Last use is recorded. | `auth.validate_api_key`, `gateway.enforce_key_scope`, `tests/test_scoped_keys.py` |
| S | A forged SSO sign-in | PKCE (S256). Single-use, expiring state. Nonce. Algorithm allowlist. JWKS signature, issuer, audience, expiry, verified email and allowed domains are all checked. | `saas_layer/sso.py`, `tests/test_sso.py` (29 tests, one per attack) |
| S | Account enumeration through sign-in | Same `202` and body for known and unknown addresses | `gateway` request-link route |
| S | Brute force | Throttles: 5 failures per 15 minutes per IP (operator) and per bucket (customer, token exchange) | `user_auth.record_attempt`, `auth.ADMIN_LOGIN_LOCKOUT_SECONDS` |
| T | Altering findings or audit records | HMAC-SHA256 hash chain over audit events. Review actions are attributed server-side; the request body has no reviewer field. | `saas_layer/audit.py`, ENTERPRISE-SECURITY-REVIEW §4 |
| T | Altering the activity log | The application has no route that updates or deletes an entry | `tests/test_activity_log.py::test_nobody_can_edit_the_log` |
| R | "I didn't resolve that finding" | Decisions carry the session's user, and machine actions are labelled as such. Key, member, purge and SSO actions are in the activity log. | `monitoring.update_finding`, `saas_layer/activity.py` |
| I | Reading another organization's data | Every org-scoped query takes `org_id` from the credential, never the request | `tests/test_workspace_isolation.py` |
| I | PHI cached by a browser or proxy | `Cache-Control: no-store` on every `/saas/` response | `gateway._security_headers`, `tests/test_security_headers.py` |
| I | Secrets in logs | Log redaction filter on `api_key`, `token`, `secret` and `password`. The SSO client secret is encrypted at rest and never returned. | `log_redaction.py`, `tests/test_sso.py` |
| I | Open redirect after sign-in | Only same-app paths are accepted (`//host` and absolute URLs refused); redirect targets come from configuration, never the Host header | `sso.safe_return_path`, `gateway._app_base_url` |
| D | Oversized uploads | Ingest bounded to 500 interactions and 10 MiB; body size cap | `gateway` ingest limits, `tests/test_deployment_config.py` |
| E | A machine key performing owner actions | Minting or revoking keys, members, purges and SSO configuration need an owner's session as well as the key | `gateway._require_owner` |
| E | An auditor changing data | A signed-in auditor is refused every non-read request | `gateway._enforce_auditor_read_only` |
| E | A scoped key escalating | It cannot rotate the primary key, mint keys (that is POST, refused for `read`), or read data (`ingest`) | `tests/test_scoped_keys.py` |

### Boundary 1: the browser

| STRIDE | Threat | Mitigation | Evidence |
| :-- | :-- | :-- | :-- |
| T/I | XSS in the console | CSP `script-src 'self'` on the static app; React escapes output; no inline scripts in the build | `render.yaml`, `tests/test_security_headers.py` |
| T | Clickjacking | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` (API and app) | same |
| S | CSRF on cookie-authenticated routes | `SameSite=Lax` session cookie, exact-match CORS allowlist, JSON bodies, and the org API key required alongside the session | `gateway.set_session_cookie`, CORS config |
| I | Downgrade to HTTP | HSTS (two years, subdomains) on the API and the app | same |

### Boundaries 4–5: data stores and third parties

| STRIDE | Threat | Mitigation | Status |
| :-- | :-- | :-- | :-- |
| I | Database dump | Keys, sessions and tokens are hashed. The SSO secret is encrypted. **Transcripts are plaintext in the database**; encryption at rest is the platform's. | **Residual risk.** Field-level encryption of transcripts with a KMS key is open. |
| I | SSRF through configured URLs | SSO and issuer URLs must be https and are screened against private, loopback and link-local IP literals | `oauth_exchange._reject_unsafe_url`. **DNS rebinding is not covered** (stated in code). |
| T | A vulnerable dependency | `pip-audit` and `pnpm audit --prod` in CI (fail on high); Bandit; SBOM per build | CI `security` job |
| S | A compromised identity provider | Out of scope to prevent; limited by allowed domains and a default role that is never owner | `sso.configure` |

### Boundary 6: the operator console

| STRIDE | Threat | Mitigation |
| :-- | :-- | :-- |
| S | Operator password guessed | scrypt (n=2^15), constant-time compare, database-backed lockout checked before the comparison, and a lockout bucket separate from customer sign-in |
| E | Operator reads customer data | **Residual risk.** The operator console is cross-tenant by design. Operator actions are not yet in a customer-visible log. |

## 4. Residual risks, stated

1. **No third-party penetration test.** The automated ZAP scan in CI (`dast.yml`) is not one.
2. **Transcripts are not field-encrypted.** Encryption at rest is the hosting platform's.
3. **Key custody.** `HMAC_SECRET` derives the SSO secret encryption key, and it lives in an environment variable, not a KMS or HSM.
4. **Operator access is cross-tenant**, and operator actions are not in the customer's activity log.
5. **DNS rebinding** is not defended in the SSRF screen.
6. **Revocation of NHID-Auth delegations** does not cross organizations (framework repo, `docs/production-readiness.md` §2).
7. **One region, one instance** on the free plan. Availability is not engineered.

Each is a candidate for the next round of work. None is hidden.
